import { promises as fs } from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import type {
  ProjectScanResult,
  ScannedModule,
  ServiceCandidate
} from '@microlight/shared'

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

  const moduleRelativePaths = normalizeArray(rootProject.modules?.module)
  const modulePaths = [normalizedRootPath]

  for (const moduleRelativePath of moduleRelativePaths) {
    modulePaths.push(path.resolve(normalizedRootPath, moduleRelativePath))
  }

  const modules = await Promise.all(modulePaths.map((modulePath) => scanModule(modulePath)))

  return {
    rootPath: normalizedRootPath,
    artifactId: rootProject.artifactId ?? path.basename(normalizedRootPath),
    packaging: rootProject.packaging ?? 'jar',
    moduleCount: modules.length,
    modules
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
  const javaFiles = await collectJavaFiles(javaSourcePath)
  const serviceCandidates = await Promise.all(
    javaFiles.map((javaFilePath) => parseServiceCandidate(javaFilePath, modulePath, defaultPort))
  )

  return {
    moduleName: project.name ?? path.basename(modulePath),
    modulePath,
    artifactId: project.artifactId ?? path.basename(modulePath),
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
    defaultPort
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
