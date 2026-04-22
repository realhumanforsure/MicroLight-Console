import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type {
  BuildToolKind,
  RuntimeCompatibilityMatrixRow,
  RuntimeDetectionResult,
  ToolSupportLevel,
  ToolAvailability
} from '@microlight/shared'

export async function detectRuntimeTools(rootPath: string): Promise<RuntimeDetectionResult> {
  const normalizedRootPath = path.resolve(rootPath)
  const mavenWrapperCommand = await resolveMavenWrapperCommand(normalizedRootPath)

  const [java, mavenWrapper, maven, mvnd] = await Promise.all([
    detectCommand('java', ['-version'], 'java'),
    mavenWrapperCommand
      ? detectCommand(mavenWrapperCommand, ['-v'], 'mvnw')
      : unavailableTool('mvnw', defaultWrapperCommand()),
    detectCommand('mvn', ['-version'], 'mvn'),
    detectCommand('mvnd', ['-v'], 'mvnd')
  ])
  const recommendedBuildTool = resolveRecommendedBuildTool(mavenWrapper, mvnd, maven)

  return {
    rootPath: normalizedRootPath,
    java,
    mavenWrapper,
    maven,
    mvnd,
    recommendedBuildTool,
    compatibilityMatrix: createCompatibilityMatrix({
      mavenWrapper,
      maven,
      mvnd,
      recommendedBuildTool
    })
  }
}

export async function resolveBuildCommand(
  rootPath: string,
  preferredTool: BuildToolKind | 'auto'
): Promise<{ kind: BuildToolKind; command: string }> {
  const tools = await detectRuntimeTools(rootPath)

  const selectedTool =
    preferredTool === 'auto'
      ? tools.recommendedBuildTool
      : preferredTool

  if (selectedTool === null) {
    throw new Error('No available Maven build command was detected.')
  }

  if (selectedTool === 'mvnw') {
    const wrapperCommand = await resolveMavenWrapperCommand(rootPath)

    if (!wrapperCommand) {
      throw new Error('Maven Wrapper was selected but no mvnw command exists in the project root.')
    }

    return {
      kind: 'mvnw',
      command: wrapperCommand
    }
  }

  return {
    kind: selectedTool,
    command: selectedTool
  }
}

async function resolveMavenWrapperCommand(rootPath: string): Promise<string | null> {
  const wrapperName = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'
  const wrapperPath = path.join(rootPath, wrapperName)

  try {
    await fs.access(wrapperPath)
    return wrapperPath
  } catch {
    return null
  }
}

function defaultWrapperCommand() {
  return process.platform === 'win32' ? 'mvnw.cmd' : './mvnw'
}

async function detectCommand(
  command: string,
  args: string[],
  kind: ToolAvailability['kind']
): Promise<ToolAvailability> {
  try {
    const result = await execCommand(command, args, process.cwd())
    const output = `${result.stdout}\n${result.stderr}`.trim()

    return {
      kind,
      available: result.exitCode === 0,
      command,
      version: extractVersionLine(output),
      parsedVersion: extractParsedVersion(output, kind),
      majorVersion: extractMajorVersion(output, kind),
      supportLevel: resolveSupportLevel(output, kind),
      supportDetail: resolveSupportDetail(output, kind),
      linkedMavenMajor: resolveLinkedMavenMajor(output, kind),
      detail: output || null
    }
  } catch (error) {
    return {
      kind,
      available: false,
      command,
      version: null,
      parsedVersion: null,
      majorVersion: null,
      supportLevel: 'unknown',
      supportDetail: null,
      linkedMavenMajor: null,
      detail: error instanceof Error ? error.message : 'Command detection failed'
    }
  }
}

function unavailableTool(
  kind: ToolAvailability['kind'],
  command: string
): ToolAvailability {
  return {
    kind,
    available: false,
    command,
    version: null,
    parsedVersion: null,
    majorVersion: null,
    supportLevel: 'unknown',
    supportDetail: null,
    linkedMavenMajor: null,
    detail: null
  }
}

function resolveRecommendedBuildTool(
  mavenWrapper: ToolAvailability,
  mvnd: ToolAvailability,
  maven: ToolAvailability
): BuildToolKind | null {
  if (mavenWrapper.available) {
    return 'mvnw'
  }

  if (mvnd.available) {
    return 'mvnd'
  }

  if (maven.available) {
    return 'mvn'
  }

  return null
}

function extractVersionLine(output: string): string | null {
  const versionLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return versionLine ?? null
}

export function extractParsedVersion(
  output: string,
  kind: ToolAvailability['kind']
) {
  const versionMatch =
    kind === 'java'
      ? output.match(/version\s+"([^"]+)"/i)
      : kind === 'mvnd'
        ? output.match(/(?:mvnd\)\s*|mvnd\s+)(\d+(?:\.\d+)*(?:[-+][\w.-]+)?)/i)
        : output.match(/Apache Maven\s+(\d+(?:\.\d+)*(?:[-+][\w.-]+)?)/i)

  return versionMatch?.[1] ?? null
}

export function extractMajorVersion(
  output: string,
  kind: ToolAvailability['kind']
) {
  const parsedVersion = extractParsedVersion(output, kind)
  const majorValue = parsedVersion?.match(/^(\d+)/)?.[1]
  return majorValue ? Number(majorValue) : null
}

function resolveLinkedMavenMajor(
  output: string,
  kind: ToolAvailability['kind']
) {
  if (kind !== 'mvnd') {
    return null
  }

  const majorVersion = extractMajorVersion(output, kind)

  if (majorVersion === 1) {
    return 3
  }

  if (majorVersion === 2) {
    return 4
  }

  return null
}

function resolveSupportLevel(
  output: string,
  kind: ToolAvailability['kind']
): ToolSupportLevel {
  const majorVersion = extractMajorVersion(output, kind)

  if (majorVersion === null) {
    return kind === 'java' ? 'stable' : 'unknown'
  }

  if (kind === 'java') {
    return 'stable'
  }

  if (kind === 'mvnd') {
    if (majorVersion === 1) {
      return 'stable'
    }

    if (majorVersion === 2) {
      return 'experimental'
    }

    return 'unsupported'
  }

  if (majorVersion === 3) {
    return 'stable'
  }

  if (majorVersion === 4) {
    return 'experimental'
  }

  return 'unsupported'
}

function resolveSupportDetail(
  output: string,
  kind: ToolAvailability['kind']
) {
  const parsedVersion = extractParsedVersion(output, kind)
  const majorVersion = extractMajorVersion(output, kind)
  const linkedMavenMajor = resolveLinkedMavenMajor(output, kind)

  if (kind === 'java') {
    return parsedVersion ? `Java ${parsedVersion}` : 'Java runtime detected.'
  }

  if (majorVersion === null) {
    return null
  }

  if (kind === 'mvnd') {
    if (majorVersion === 1) {
      return `mvnd ${parsedVersion ?? majorVersion} targets Maven 3.x and is in the stable support line.`
    }

    if (majorVersion === 2) {
      return `mvnd ${parsedVersion ?? majorVersion} targets Maven ${linkedMavenMajor ?? 4}.x and is treated as experimental support.`
    }

    return `mvnd ${parsedVersion ?? majorVersion} is outside the planned compatibility range.`
  }

  if (majorVersion === 3) {
    return `Apache Maven ${parsedVersion ?? majorVersion} is in the stable support range.`
  }

  if (majorVersion === 4) {
    return `Apache Maven ${parsedVersion ?? majorVersion} is treated as experimental support.`
  }

  return `Apache Maven ${parsedVersion ?? majorVersion} is outside the planned compatibility range.`
}

function createCompatibilityMatrix(input: {
  mavenWrapper: ToolAvailability
  maven: ToolAvailability
  mvnd: ToolAvailability
  recommendedBuildTool: BuildToolKind | null
}): RuntimeCompatibilityMatrixRow[] {
  return [
    createCompatibilityMatrixRow({
      id: 'maven3',
      label: 'Maven 3.x',
      versionRange: '3.x',
      targetMaven: 'Maven 3.x',
      supportLevel: 'stable',
      matchingTools: [input.mavenWrapper, input.maven].filter(
        (tool) => tool.available && tool.majorVersion === 3
      ),
      recommendedBuildTool: input.recommendedBuildTool,
      detail: 'Stable baseline for current MVP build execution.'
    }),
    createCompatibilityMatrixRow({
      id: 'maven4',
      label: 'Maven 4.x',
      versionRange: '4.x',
      targetMaven: 'Maven 4.x',
      supportLevel: 'experimental',
      matchingTools: [input.mavenWrapper, input.maven].filter(
        (tool) => tool.available && tool.majorVersion === 4
      ),
      recommendedBuildTool: input.recommendedBuildTool,
      detail: 'Experimental path for Maven 4 projects.'
    }),
    createCompatibilityMatrixRow({
      id: 'mvnd1',
      label: 'mvnd 1.x',
      versionRange: '1.x',
      targetMaven: 'Maven 3.x',
      supportLevel: 'stable',
      matchingTools: [input.mvnd].filter((tool) => tool.available && tool.majorVersion === 1),
      recommendedBuildTool: input.recommendedBuildTool,
      detail: 'Stable daemon line for Maven 3.x acceleration.'
    }),
    createCompatibilityMatrixRow({
      id: 'mvnd2',
      label: 'mvnd 2.x',
      versionRange: '2.x',
      targetMaven: 'Maven 4.x',
      supportLevel: 'experimental',
      matchingTools: [input.mvnd].filter((tool) => tool.available && tool.majorVersion === 2),
      recommendedBuildTool: input.recommendedBuildTool,
      detail: 'Experimental daemon line for Maven 4.x acceleration.'
    })
  ]
}

function createCompatibilityMatrixRow(input: {
  id: RuntimeCompatibilityMatrixRow['id']
  label: string
  versionRange: string
  targetMaven: string
  supportLevel: ToolSupportLevel
  matchingTools: ToolAvailability[]
  recommendedBuildTool: BuildToolKind | null
  detail: string
}): RuntimeCompatibilityMatrixRow {
  const detectedTools = input.matchingTools.map((tool) => `${tool.kind} ${tool.parsedVersion ?? tool.version ?? 'unknown'}`)
  const matchState =
    input.recommendedBuildTool !== null &&
    input.matchingTools.some((tool) => tool.kind === input.recommendedBuildTool)
      ? 'recommended'
      : detectedTools.length > 0
        ? 'detected'
        : 'not_detected'

  return {
    id: input.id,
    label: input.label,
    versionRange: input.versionRange,
    targetMaven: input.targetMaven,
    supportLevel: input.supportLevel,
    matchState,
    detectedTools,
    detail: input.detail
  }
}

export function execCommand(command: string, args: string[], cwd: string) {
  return runStreamingCommand(command, args, cwd, undefined, {
    timeoutMs: 8000
  })
}

export function runStreamingCommand(
  command: string,
  args: string[],
  cwd: string,
  onOutput?: (chunk: string, source: 'stdout' | 'stderr') => void,
  options: { timeoutMs?: number } = {}
) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'pipe'
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return
          }

          settled = true
          child.kill('SIGKILL')
          reject(new Error(`${command} ${args.join(' ')} timed out after ${options.timeoutMs}ms`))
        }, options.timeoutMs)
      : null

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      onOutput?.(text, 'stdout')
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      onOutput?.(text, 'stderr')
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0
      })
    })
  })
}
