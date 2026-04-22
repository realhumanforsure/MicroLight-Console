import { promises as fs } from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import {
  DEFAULT_BUILD_TOOL_PREFERENCE,
  DEFAULT_HEALTH_CHECK_PATH,
  DEFAULT_JVM_ARGS,
  DEFAULT_MAVEN_THREADS,
  DEFAULT_PROGRAM_ARGS,
  DEFAULT_SKIP_TESTS,
  DEFAULT_SPRING_PROFILES,
  type BuildToolPreference,
  type ProjectScanResult,
  type ScannedModule,
  type ServiceCandidate
} from '@microlight/shared'
import { createServiceId } from './service-runtime.js'
import { persistenceService } from './persistence.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true
})

interface PomProject {
  name?: string
  artifactId?: string
  packaging?: string
  version?: string
  parent?: {
    version?: string
  }
  modules?: {
    module?: string | string[]
  }
}

interface PomFile {
  project?: PomProject
}

export async function scanProject(rootPath: string): Promise<ProjectScanResult> {
  const normalizedRootPath = path.resolve(rootPath)
  const rootPomPath = path.join(normalizedRootPath, 'pom.xml')
  const rootPom = await readPom(rootPomPath)
  const rootProject = rootPom.project

  if (!rootProject) {
    throw new Error('Unable to parse root pom.xml')
  }

  const modulePaths = await collectModulePaths(normalizedRootPath)
  const modules = await Promise.all(modulePaths.map((modulePath) => scanModule(modulePath)))

  return {
    rootPath: normalizedRootPath,
    artifactId: rootProject.artifactId ?? path.basename(normalizedRootPath),
    packaging: rootProject.packaging ?? 'jar',
    moduleCount: modules.length,
    modules,
    savedLastSelectedServiceId:
      persistenceService.getProjectPreference(normalizedRootPath)?.lastSelectedServiceId ?? null
  }
}

async function collectModulePaths(rootPath: string) {
  const visited = new Set<string>()
  const modulePaths: string[] = []

  await visitModule(rootPath, visited, modulePaths)

  return modulePaths
}

async function visitModule(modulePath: string, visited: Set<string>, modulePaths: string[]) {
  const normalizedModulePath = path.resolve(modulePath)

  if (visited.has(normalizedModulePath)) {
    return
  }

  visited.add(normalizedModulePath)
  modulePaths.push(normalizedModulePath)

  const pom = await readPom(path.join(normalizedModulePath, 'pom.xml'))
  const project = pom.project

  if (!project) {
    throw new Error(`Unable to parse pom.xml in ${normalizedModulePath}`)
  }

  const childModules = normalizeArray(project.modules?.module)

  for (const childModule of childModules) {
    await visitModule(path.resolve(normalizedModulePath, childModule), visited, modulePaths)
  }
}

async function scanModule(modulePath: string): Promise<ScannedModule> {
  const pomPath = path.join(modulePath, 'pom.xml')
  const pom = await readPom(pomPath)
  const project = pom.project

  if (!project) {
    throw new Error(`Unable to parse pom.xml in ${modulePath}`)
  }

  const javaSourcePath = path.join(modulePath, 'src', 'main', 'java')
  const defaultPort = await resolveDefaultPort(modulePath)
  const artifactId = project.artifactId ?? path.basename(modulePath)
  const javaFiles = await collectJavaFiles(javaSourcePath)
  const serviceCandidates = await Promise.all(
    javaFiles.map((javaFilePath) =>
      parseServiceCandidate(javaFilePath, modulePath, artifactId, defaultPort)
    )
  )

  return {
    moduleName: project.name ?? path.basename(modulePath),
    modulePath,
    artifactId,
    packaging: project.packaging ?? 'jar',
    bootVersion: project.parent?.version ?? project.version ?? null,
    serviceCandidates: serviceCandidates.filter(
      (candidate): candidate is ServiceCandidate => candidate !== null
    )
  }
}

async function readPom(pomPath: string): Promise<PomFile> {
  const pomXml = await fs.readFile(pomPath, 'utf8')
  return xmlParser.parse(pomXml) as PomFile
}

async function collectJavaFiles(rootPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true })
    const nestedFiles = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(rootPath, entry.name)

        if (entry.isDirectory()) {
          return collectJavaFiles(entryPath)
        }

        if (entry.isFile() && entry.name.endsWith('.java')) {
          return [entryPath]
        }

        return []
      })
    )

    return nestedFiles.flat()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function parseServiceCandidate(
  javaFilePath: string,
  modulePath: string,
  artifactId: string,
  defaultPort: number | null
): Promise<ServiceCandidate | null> {
  const source = await fs.readFile(javaFilePath, 'utf8')

  const hasBootAnnotation = /@SpringBootApplication\b/.test(source)
  const hasMainMethod = /public\s+static\s+void\s+main\s*\(\s*String\[\]\s+\w+\s*\)/.test(source)
  const hasSpringApplicationRun = /SpringApplication\.run\s*\(/.test(source)

  if (!hasBootAnnotation || !hasMainMethod || !hasSpringApplicationRun) {
    return null
  }

  const packageMatch = source.match(/package\s+([\w.]+)\s*;/)
  const classMatch = source.match(/public\s+class\s+(\w+)/)
  const className = classMatch?.[1] ?? path.basename(javaFilePath, '.java')
  const packageName = packageMatch?.[1] ?? ''

  return {
    className,
    packageName,
    mainClass: packageName ? `${packageName}.${className}` : className,
    javaFilePath,
    modulePath,
    defaultPort,
    ...resolveSavedPreference(artifactId, className, packageName)
  }
}

async function resolveDefaultPort(modulePath: string) {
  const resourcesPath = path.join(modulePath, 'src', 'main', 'resources')
  const candidateFiles = [
    path.join(resourcesPath, 'application.properties'),
    path.join(resourcesPath, 'application.yml'),
    path.join(resourcesPath, 'application.yaml')
  ]

  for (const candidatePath of candidateFiles) {
    try {
      const content = await fs.readFile(candidatePath, 'utf8')
      const detectedPort = extractPort(content, path.extname(candidatePath))

      if (detectedPort !== null) {
        return detectedPort
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  return 8080
}

function extractPort(content: string, extension: string) {
  if (extension === '.properties') {
    const match = content.match(/^\s*server\.port\s*=\s*(\d+)\s*$/m)
    return match ? Number(match[1]) : null
  }

  const nestedYamlMatch = content.match(/^\s*server\s*:\s*[\r\n]+(?:[ \t]+.*[\r\n]+)*?[ \t]+port\s*:\s*(\d+)\s*$/m)
  if (nestedYamlMatch) {
    return Number(nestedYamlMatch[1])
  }

  const flatYamlMatch = content.match(/^\s*server\.port\s*:\s*(\d+)\s*$/m)
  return flatYamlMatch ? Number(flatYamlMatch[1]) : null
}

function normalizeArray(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function resolveSavedPreference(artifactId: string, className: string, packageName: string) {
  const mainClass = packageName ? `${packageName}.${className}` : className
  const serviceId = createServiceId(artifactId, mainClass)
  const preference = persistenceService.getServicePreference(serviceId)

  return {
    savedBuildToolPreference:
      preference?.buildToolPreference ?? (DEFAULT_BUILD_TOOL_PREFERENCE as BuildToolPreference),
    savedSkipTests: preference?.skipTests ?? DEFAULT_SKIP_TESTS,
    savedJvmArgs: preference?.jvmArgs ?? DEFAULT_JVM_ARGS,
    savedProgramArgs: preference?.programArgs ?? DEFAULT_PROGRAM_ARGS,
    savedSpringProfiles: preference?.springProfiles ?? DEFAULT_SPRING_PROFILES,
    savedHealthCheckPath: preference?.healthCheckPath ?? DEFAULT_HEALTH_CHECK_PATH,
    savedMavenThreads: preference?.mavenThreads ?? DEFAULT_MAVEN_THREADS
  }
}
