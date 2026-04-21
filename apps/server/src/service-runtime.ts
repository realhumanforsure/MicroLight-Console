import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  BuildToolKind,
  ServiceInstanceState,
  ServiceLaunchRequest,
  ServiceStatus
} from '@microlight/shared'
import { execCommand, resolveBuildCommand } from './runtime-tools.js'

const MAX_LOG_LINES = 200

interface ManagedServiceInstance {
  state: ServiceInstanceState
  process: ChildProcessWithoutNullStreams | null
}

class ServiceRuntimeManager {
  private readonly instances = new Map<string, ManagedServiceInstance>()

  getInstances() {
    return Array.from(this.instances.values()).map((instance) => instance.state)
  }

  async launchService(request: ServiceLaunchRequest) {
    const serviceId = createServiceId(request.artifactId, request.mainClass)
    const existing = this.instances.get(serviceId)

    if (existing?.process) {
      await this.stopService(serviceId)
    }

    const state = existing?.state ?? createInitialState(serviceId, request)
    this.instances.set(serviceId, {
      state,
      process: null
    })

    state.status = 'building'
    state.lastUpdatedAt = new Date().toISOString()
    appendLog(state, `[build] Starting build for ${request.artifactId}`)

    const buildCommand = await resolveBuildCommand(request.rootPath, request.buildToolPreference)
    state.buildTool = buildCommand.kind

    const buildArgs = createBuildArgs(request, buildCommand.kind)
    const buildResult = await execCommand(buildCommand.command, buildArgs, request.rootPath)
    appendProcessOutput(state, '[build]', buildResult.stdout, buildResult.stderr)

    if (buildResult.exitCode !== 0) {
      state.status = 'failed'
      state.lastExitCode = buildResult.exitCode
      state.lastUpdatedAt = new Date().toISOString()
      throw new Error(`Build failed with exit code ${buildResult.exitCode}`)
    }

    const jarPath = await resolveRunnableJar(request.modulePath)
    state.jarPath = jarPath

    appendLog(state, `[runtime] Launching java -jar ${jarPath}`)

    const serviceProcess = spawn('java', ['-jar', jarPath], {
      cwd: request.modulePath,
      env: process.env,
      stdio: 'pipe'
    })

    const managed = this.instances.get(serviceId)

    if (!managed) {
      throw new Error('Service state disappeared before launch.')
    }

    managed.process = serviceProcess
    state.pid = serviceProcess.pid ?? null
    state.status = 'running'
    state.startedAt = new Date().toISOString()
    state.lastExitCode = null
    state.lastUpdatedAt = new Date().toISOString()

    serviceProcess.stdout.on('data', (chunk) => {
      appendLog(state, chunk.toString())
    })

    serviceProcess.stderr.on('data', (chunk) => {
      appendLog(state, chunk.toString())
    })

    serviceProcess.on('exit', (code) => {
      state.pid = null
      state.lastExitCode = code ?? null
      state.status = code === 0 ? 'stopped' : 'failed'
      state.lastUpdatedAt = new Date().toISOString()
      managed.process = null
      appendLog(state, `[runtime] Process exited with code ${code ?? 'null'}`)
    })

    serviceProcess.on('error', (error) => {
      state.status = 'failed'
      state.lastUpdatedAt = new Date().toISOString()
      appendLog(state, `[runtime] ${error.message}`)
    })

    await delay(1500)

    return state
  }

  async stopService(serviceId: string) {
    const instance = this.instances.get(serviceId)

    if (!instance) {
      throw new Error(`Service ${serviceId} was not found.`)
    }

    if (!instance.process) {
      instance.state.status = 'stopped'
      instance.state.lastUpdatedAt = new Date().toISOString()
      return instance.state
    }

    instance.process.kill('SIGTERM')
    appendLog(instance.state, '[runtime] Stop signal sent')
    instance.state.status = 'stopped'
    instance.state.pid = null
    instance.state.lastUpdatedAt = new Date().toISOString()
    instance.process = null
    return instance.state
  }
}

export const serviceRuntimeManager = new ServiceRuntimeManager()

function createInitialState(serviceId: string, request: ServiceLaunchRequest): ServiceInstanceState {
  return {
    serviceId,
    artifactId: request.artifactId,
    mainClass: request.mainClass,
    modulePath: request.modulePath,
    status: 'idle',
    pid: null,
    buildTool: null,
    jarPath: null,
    startedAt: null,
    lastUpdatedAt: new Date().toISOString(),
    lastExitCode: null,
    logLines: []
  }
}

function createBuildArgs(
  request: ServiceLaunchRequest,
  buildTool: BuildToolKind
) {
  const args: string[] = []
  const relativeModulePath = normalizeModuleSelector(request.rootPath, request.modulePath)

  if (buildTool === 'mvnd') {
    args.push('-T1')
  }

  if (relativeModulePath !== null) {
    args.push('-pl', relativeModulePath, '-am')
  }

  if (request.skipTests) {
    args.push('-DskipTests')
  }

  args.push('package')
  return args
}

function normalizeModuleSelector(rootPath: string, modulePath: string) {
  const normalizedRootPath = path.resolve(rootPath)
  const normalizedModulePath = path.resolve(modulePath)

  if (normalizedRootPath === normalizedModulePath) {
    return null
  }

  return path.relative(normalizedRootPath, normalizedModulePath).replace(/\\/g, '/')
}

async function resolveRunnableJar(modulePath: string) {
  const targetPath = path.join(modulePath, 'target')
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  const jarCandidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jar'))
      .filter((entry) => !entry.name.startsWith('original-'))
      .filter((entry) => !entry.name.endsWith('-sources.jar'))
      .filter((entry) => !entry.name.endsWith('-javadoc.jar'))
      .map(async (entry) => {
        const fullPath = path.join(targetPath, entry.name)
        const stat = await fs.stat(fullPath)
        return {
          fullPath,
          mtimeMs: stat.mtimeMs
        }
      })
  )

  if (jarCandidates.length === 0) {
    throw new Error('No runnable jar was found in the module target directory.')
  }

  jarCandidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return jarCandidates[0].fullPath
}

function appendProcessOutput(
  state: ServiceInstanceState,
  prefix: string,
  stdout: string,
  stderr: string
) {
  for (const part of [stdout, stderr]) {
    if (!part.trim()) {
      continue
    }

    appendLog(state, `${prefix} ${part}`)
  }
}

function appendLog(state: ServiceInstanceState, content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return
  }

  state.logLines.push(...lines)

  if (state.logLines.length > MAX_LOG_LINES) {
    state.logLines.splice(0, state.logLines.length - MAX_LOG_LINES)
  }

  state.lastUpdatedAt = new Date().toISOString()
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createServiceId(artifactId: string, mainClass: string) {
  return `${artifactId}:${mainClass}`
}
