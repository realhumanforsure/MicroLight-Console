import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type {
  BuildToolKind,
  RuntimeDetectionResult,
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

  return {
    rootPath: normalizedRootPath,
    java,
    mavenWrapper,
    maven,
    mvnd,
    recommendedBuildTool: resolveRecommendedBuildTool(mavenWrapper, mvnd, maven)
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
      detail: output || null
    }
  } catch (error) {
    return {
      kind,
      available: false,
      command,
      version: null,
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

export function execCommand(command: string, args: string[], cwd: string) {
  return runStreamingCommand(command, args, cwd)
}

export function runStreamingCommand(
  command: string,
  args: string[],
  cwd: string,
  onOutput?: (chunk: string, source: 'stdout' | 'stderr') => void
) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'pipe'
    })

    let stdout = ''
    let stderr = ''

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

    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0
      })
    })
  })
}
