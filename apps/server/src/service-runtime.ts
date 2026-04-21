import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import pidusage from 'pidusage'
import type {
  BuildToolKind,
  ServiceInstanceState,
  ServiceLaunchRequest,
  ServiceStatus
} from '@microlight/shared'
import { resolveBuildCommand, runStreamingCommand } from './runtime-tools.js'

const MAX_LOG_LINES = 200

interface ManagedServiceInstance {
  state: ServiceInstanceState
  process: ChildProcessWithoutNullStreams | null
  lastLaunchRequest: ServiceLaunchRequest | null
  stopRequested: boolean
  logStream: WriteStream | null
}

class ServiceRuntimeManager {
  private readonly instances = new Map<string, ManagedServiceInstance>()
  private readonly events = new EventEmitter()
  private readonly metricsTimer: NodeJS.Timeout

  constructor() {
    this.metricsTimer = setInterval(() => {
      void this.refreshRuntimeMetrics()
    }, 2000)
  }

  getInstances() {
    return Array.from(this.instances.values()).map((instance) => instance.state)
  }

  getInstance(serviceId: string) {
    return this.instances.get(serviceId)?.state ?? null
  }

  subscribe(serviceId: string, listener: (state: ServiceInstanceState) => void) {
    const eventName = this.getEventName(serviceId)
    this.events.on(eventName, listener)

    return () => {
      this.events.off(eventName, listener)
    }
  }

  async launchService(request: ServiceLaunchRequest) {
    const serviceId = createServiceId(request.artifactId, request.mainClass)
    const existing = this.instances.get(serviceId)

    if (existing?.process) {
      await this.stopService(serviceId)
    }

    if (existing?.logStream) {
      await closeManagedLogStream(existing)
    }

    const state = existing?.state ?? createInitialState(serviceId, request)
    const logStream = await createServiceLogStream(serviceId)
    state.logLines = []
    state.logFilePath = logStream.logFilePath
    state.cpuPercent = null
    state.memoryRssBytes = null
    state.runtimePort = request.runtimePort
    state.portReachable = false
    this.instances.set(serviceId, {
      state,
      process: null,
      lastLaunchRequest: request,
      stopRequested: false,
      logStream: logStream.stream
    })

    state.status = 'building'
    state.lastUpdatedAt = new Date().toISOString()
    this.emitState(state)
    this.appendLog(state, `[build] Starting build for ${request.artifactId}`)

    const buildCommand = await resolveBuildCommand(request.rootPath, request.buildToolPreference)
    state.buildTool = buildCommand.kind
    this.emitState(state)

    const buildArgs = createBuildArgs(request, buildCommand.kind)
    const buildResult = await runStreamingCommand(
      buildCommand.command,
      buildArgs,
      request.rootPath,
      (chunk, source) => {
        const prefix = source === 'stderr' ? '[build][stderr]' : '[build]'
        this.appendLog(state, `${prefix} ${chunk}`)
      }
    )

    if (buildResult.exitCode !== 0) {
      state.status = 'failed'
      state.lastExitCode = buildResult.exitCode
      state.lastUpdatedAt = new Date().toISOString()
      this.emitState(state)
      throw new Error(`Build failed with exit code ${buildResult.exitCode}`)
    }

    const jarPath = await resolveRunnableJar(request.modulePath)
    state.jarPath = jarPath

    this.appendLog(state, `[runtime] Launching java -jar ${jarPath}`)

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
    managed.stopRequested = false
    managed.lastLaunchRequest = request
    state.pid = serviceProcess.pid ?? null
    state.status = 'running'
    state.startedAt = new Date().toISOString()
    state.lastExitCode = null
    state.lastUpdatedAt = new Date().toISOString()
    this.emitState(state)

    serviceProcess.stdout.on('data', (chunk) => {
      this.appendLog(state, chunk.toString())
    })

    serviceProcess.stderr.on('data', (chunk) => {
      this.appendLog(state, chunk.toString())
    })

    serviceProcess.on('exit', (code) => {
      state.pid = null
      state.lastExitCode = code ?? null
      state.status = managed.stopRequested || code === 0 ? 'stopped' : 'failed'
      state.lastUpdatedAt = new Date().toISOString()
      managed.process = null
      managed.stopRequested = false
      this.appendLog(state, `[runtime] Process exited with code ${code ?? 'null'}`)
      void closeManagedLogStream(managed)
    })

    serviceProcess.on('error', (error) => {
      state.status = 'failed'
      state.lastUpdatedAt = new Date().toISOString()
      this.appendLog(state, `[runtime] ${error.message}`)
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
      this.emitState(instance.state)
      return instance.state
    }

    instance.stopRequested = true
    this.appendLog(instance.state, '[runtime] Stop signal sent')

    await new Promise<void>((resolve) => {
      const runningProcess = instance.process

      if (!runningProcess) {
        resolve()
        return
      }

      const timeout = setTimeout(() => {
        resolve()
      }, 5000)

      runningProcess.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })

      runningProcess.kill('SIGTERM')
    })

    instance.state.status = 'stopped'
    instance.state.pid = null
    instance.state.cpuPercent = null
    instance.state.memoryRssBytes = null
    instance.state.portReachable = false
    instance.state.lastUpdatedAt = new Date().toISOString()
    this.emitState(instance.state)
    return instance.state
  }

  async restartService(serviceId: string) {
    const instance = this.instances.get(serviceId)

    if (!instance || !instance.lastLaunchRequest) {
      throw new Error(`Service ${serviceId} cannot be restarted because no previous launch config exists.`)
    }

    if (instance.process) {
      await this.stopService(serviceId)
    }

    return this.launchService(instance.lastLaunchRequest)
  }

  private appendLog(state: ServiceInstanceState, content: string) {
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
    this.writeLogFile(state.serviceId, lines)
    this.emitState(state)
  }

  private emitState(state: ServiceInstanceState) {
    this.events.emit(this.getEventName(state.serviceId), {
      ...state,
      logLines: [...state.logLines]
    } satisfies ServiceInstanceState)
  }

  private getEventName(serviceId: string) {
    return `service:${serviceId}`
  }

  private writeLogFile(serviceId: string, lines: string[]) {
    const managed = this.instances.get(serviceId)

    if (!managed?.logStream) {
      return
    }

    for (const line of lines) {
      managed.logStream.write(`${line}\n`)
    }
  }

  private async refreshRuntimeMetrics() {
    const runningInstances = Array.from(this.instances.values()).filter(
      (instance) => instance.process && instance.state.pid !== null
    )

    await Promise.all(
      runningInstances.map(async (instance) => {
        const pid = instance.state.pid

        if (pid === null) {
          return
        }

        try {
          const usage = await pidusage(pid)
          instance.state.cpuPercent = usage.cpu
          instance.state.memoryRssBytes = usage.memory
        } catch {
          instance.state.cpuPercent = null
          instance.state.memoryRssBytes = null
        }

        instance.state.portReachable = await checkPortReachable(instance.state.runtimePort)
        instance.state.lastUpdatedAt = new Date().toISOString()
        this.emitState(instance.state)
      })
    )
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
    runtimePort: request.runtimePort,
    portReachable: false,
    cpuPercent: null,
    memoryRssBytes: null,
    logFilePath: null,
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

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createServiceId(artifactId: string, mainClass: string) {
  return `${artifactId}:${mainClass}`
}

async function createServiceLogStream(serviceId: string) {
  const logsDirectory = path.join(os.tmpdir(), 'microlight-console', 'logs')
  await fs.mkdir(logsDirectory, { recursive: true })
  const safeServiceId = serviceId.replace(/[^\w.-]+/g, '_')
  const logFilePath = path.join(logsDirectory, `${safeServiceId}-${Date.now()}.log`)

  return {
    logFilePath,
    stream: createWriteStream(logFilePath, { flags: 'a' })
  }
}

async function closeManagedLogStream(instance: ManagedServiceInstance) {
  if (!instance.logStream) {
    return
  }

  await new Promise<void>((resolve) => {
    instance.logStream?.end(() => {
      resolve()
    })
  })

  instance.logStream = null
}

async function checkPortReachable(port: number | null) {
  if (port === null) {
    return false
  }

  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket()

    socket.setTimeout(800)

    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })

    socket.connect(port, '127.0.0.1')
  })
}
