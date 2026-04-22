import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import pidusage from 'pidusage'
import { DEFAULT_HEALTH_CHECK_PATH, DEFAULT_MAVEN_THREADS } from '@microlight/shared'
import type {
  BuildToolKind,
  ServiceLogContentResponse,
  ServiceLogHistoryEntry,
  ServiceHealthStatus,
  ServiceInstanceState,
  ServiceLaunchRequest,
  ServiceStatus
} from '@microlight/shared'
import { resolveBuildCommand, runStreamingCommand } from './runtime-tools.js'

const MAX_LOG_LINES = 200
const MAX_HISTORY_LOG_LINES = 400

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

  async getLogHistory(serviceId: string) {
    return listServiceLogHistory(serviceId, this.instances.get(serviceId)?.state.logFilePath ?? null)
  }

  async readLogHistory(serviceId: string, entryId: string) {
    const entries = await this.getLogHistory(serviceId)
    const entry = entries.find((item) => item.id === entryId)

    if (!entry) {
      throw new Error(`Log entry ${entryId} was not found for service ${serviceId}.`)
    }

    return readServiceLogHistoryEntry(serviceId, entry)
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
    state.healthStatus = 'unknown'
    state.healthUrl = null
    state.healthDetail = null
    state.lastHealthCheckAt = null
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
    this.appendLog(state, `[build] Running command: ${buildCommand.command} ${buildArgs.join(' ')}`)
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
      throw new Error(createBuildFailureMessage(buildResult, request))
    }

    const jarPath = await resolveRunnableJar(request.modulePath)
    state.jarPath = jarPath

    const launchArgs = createLaunchArgs(request, jarPath)

    this.appendLog(state, `[runtime] Launching java ${launchArgs.join(' ')}`)

    const serviceProcess = spawn('java', launchArgs, {
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
    instance.state.healthStatus = 'unknown'
    instance.state.healthUrl = null
    instance.state.healthDetail = null
    instance.state.lastHealthCheckAt = null
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
        const health = await checkServiceHealth(
          instance.state.runtimePort,
          instance.state.portReachable,
          instance.lastLaunchRequest?.healthCheckPath
        )
        instance.state.healthStatus = health.status
        instance.state.healthUrl = health.url
        instance.state.healthDetail = health.detail
        instance.state.lastHealthCheckAt = new Date().toISOString()
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
    healthStatus: 'unknown',
    healthUrl: null,
    healthDetail: null,
    lastHealthCheckAt: null,
    cpuPercent: null,
    memoryRssBytes: null,
    logFilePath: null,
    logLines: []
  }
}

export function createBuildArgs(
  request: ServiceLaunchRequest,
  buildTool: BuildToolKind
) {
  const args: string[] = []
  const relativeModulePath = normalizeModuleSelector(request.rootPath, request.modulePath)
  const mavenThreads = normalizeMavenThreads(request.mavenThreads)

  if (mavenThreads !== null && (buildTool === 'mvnd' || (request.mavenThreads ?? '').trim().length > 0)) {
    args.push(`-T${mavenThreads}`)
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

function normalizeMavenThreads(input: string | undefined) {
  const trimmedInput = input?.trim() ?? ''

  if (trimmedInput.length === 0) {
    return DEFAULT_MAVEN_THREADS
  }

  const normalizedInput = trimmedInput.toUpperCase()

  if (!/^(?:[1-9]\d*|[1-9]\d*(?:\.\d+)?C|0?\.\d+C)$/.test(normalizedInput)) {
    return DEFAULT_MAVEN_THREADS
  }

  return normalizedInput
}

function createLaunchArgs(request: ServiceLaunchRequest, jarPath: string) {
  const jvmArgs = parseCommandLineArguments(request.jvmArgs)
  const programArgs = parseCommandLineArguments(request.programArgs)
  const runtimePortArgs =
    request.runtimePort === null ? [] : [`--server.port=${String(request.runtimePort)}`]
  const normalizedProfiles = normalizeProfiles(request.springProfiles)
  const profileArgs =
    normalizedProfiles.length > 0
      ? [`--spring.profiles.active=${normalizedProfiles.join(',')}`]
      : []

  return [...jvmArgs, '-jar', jarPath, ...programArgs, ...runtimePortArgs, ...profileArgs]
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
    throw new Error(
      '未在目标模块的 target 目录中找到可运行的 jar。请确认该模块的 packaging 为 jar，且 spring-boot-maven-plugin 已正确执行 repackage。'
    )
  }

  jarCandidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return jarCandidates[0].fullPath
}

function createBuildFailureMessage(
  buildResult: { stdout: string; stderr: string; exitCode: number },
  request: ServiceLaunchRequest
) {
  const combinedOutput = `${buildResult.stdout}\n${buildResult.stderr}`
  const normalizedOutput = combinedOutput.replace(/\r/g, '')
  const hint = inferBuildFailureHint(normalizedOutput, request, buildResult.exitCode)
  const summaryLine = extractBuildSummaryLine(normalizedOutput)

  return [hint, summaryLine].filter((part) => part && part.length > 0).join(' ')
}

function inferBuildFailureHint(output: string, request: ServiceLaunchRequest, exitCode: number) {
  const relativeModulePath = normalizeModuleSelector(request.rootPath, request.modulePath)

  if (/Could not find the selected project in the reactor/i.test(output)) {
    const selectorHint =
      relativeModulePath === null
        ? '当前构建针对根模块执行。'
        : `当前使用的模块选择器是 ${relativeModulePath}。`

    return `多模块构建失败：Maven 没有在 reactor 中找到目标模块。请检查父 pom 的 modules 配置、模块目录层级和聚合结构。${selectorHint}`
  }

  if (/Non-resolvable parent POM/i.test(output)) {
    return '构建失败：父 POM 无法解析。请确认父模块版本、相对路径或仓库访问配置是否正确。'
  }

  if (/Could not resolve dependencies|Failed to collect dependencies/i.test(output)) {
    return '构建失败：依赖解析没有通过。请检查仓库网络、私服权限以及依赖版本是否可用。'
  }

  if (/COMPILATION ERROR|maven-compiler-plugin/i.test(output)) {
    return '构建失败：Java 编译没有通过。请检查源码报错、JDK 版本和注解处理器配置。'
  }

  if (/There are test failures|SurefireBooterForkException|Failed tests/i.test(output)) {
    return '构建失败：测试阶段没有通过。可以先启用“跳过测试”确认是否为测试用例阻塞。'
  }

  if (/spring-boot-maven-plugin:.*repackage/i.test(output)) {
    return '构建失败：Spring Boot 重打包阶段没有通过。请检查该模块是否为可启动服务模块，以及插件配置是否正确。'
  }

  if (/The goal you specified requires a project to execute but there is no POM in this directory/i.test(output)) {
    return '构建失败：当前工作目录没有找到可执行的 pom.xml。请确认打开的是 Maven 项目根目录。'
  }

  return `构建失败，退出码 ${exitCode}。请查看最近日志中的 Maven 错误详情。`
}

function extractBuildSummaryLine(output: string) {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const preferredLine =
    lines.find((line) => /^\[ERROR\]\s+Failed to execute goal/i.test(line)) ??
    lines.find((line) => /^\[ERROR\]\s+/i.test(line)) ??
    lines.find((line) => /BUILD FAILURE/i.test(line))

  if (!preferredLine) {
    return ''
  }

  return `摘要：${preferredLine.replace(/^\[ERROR\]\s*/i, '')}`
}

function parseCommandLineArguments(input: string) {
  const trimmedInput = input.trim()

  if (trimmedInput.length === 0) {
    return []
  }

  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const character of trimmedInput) {
    if (escaping) {
      current += character
      escaping = false
      continue
    }

    if (character === '\\' && quote !== "'") {
      escaping = true
      continue
    }

    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        current += character
      }

      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }

      continue
    }

    current += character
  }

  if (escaping) {
    current += '\\'
  }

  if (quote !== null) {
    throw new Error('Launch arguments contain an unterminated quoted string.')
  }

  if (current.length > 0) {
    args.push(current)
  }

  return args
}

function normalizeProfiles(input: string) {
  return input
    .split(',')
    .map((profile) => profile.trim())
    .filter((profile) => profile.length > 0)
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
  const logsDirectory = resolveLogsDirectory()
  await fs.mkdir(logsDirectory, { recursive: true })
  const safeServiceId = toSafeServiceId(serviceId)
  const logFilePath = path.join(logsDirectory, `${safeServiceId}-${Date.now()}.log`)

  return {
    logFilePath,
    stream: createWriteStream(logFilePath, { flags: 'a' })
  }
}

async function listServiceLogHistory(
  serviceId: string,
  activeLogFilePath: string | null
): Promise<ServiceLogHistoryEntry[]> {
  const logsDirectory = resolveLogsDirectory()
  const safeServiceId = toSafeServiceId(serviceId)

  try {
    const entries = await fs.readdir(logsDirectory, { withFileTypes: true })
    const logEntries = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(`${safeServiceId}-`) && entry.name.endsWith('.log'))
        .map(async (entry) => {
          const filePath = path.join(logsDirectory, entry.name)
          const stat = await fs.stat(filePath)

          return {
            id: entry.name,
            serviceId,
            fileName: entry.name,
            filePath,
            createdAt: stat.birthtime.toISOString(),
            sizeBytes: stat.size,
            isActive: activeLogFilePath === filePath
          } satisfies ServiceLogHistoryEntry
        })
    )

    return logEntries.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function readServiceLogHistoryEntry(
  serviceId: string,
  entry: ServiceLogHistoryEntry
): Promise<ServiceLogContentResponse> {
  const fileContent = await fs.readFile(entry.filePath, 'utf8')
  const lines = fileContent
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  const truncated = lines.length > MAX_HISTORY_LOG_LINES

  return {
    serviceId,
    entry,
    lines: truncated ? lines.slice(-MAX_HISTORY_LOG_LINES) : lines,
    totalLines: lines.length,
    truncated
  }
}

function resolveLogsDirectory() {
  return path.join(os.tmpdir(), 'microlight-console', 'logs')
}

function toSafeServiceId(serviceId: string) {
  return serviceId.replace(/[^\w.-]+/g, '_')
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

export async function checkServiceHealth(
  port: number | null,
  portReachable: boolean,
  healthCheckPath = DEFAULT_HEALTH_CHECK_PATH
) {
  if (port === null) {
    return createHealthResult('unknown', null, 'No runtime port is configured.')
  }

  if (!portReachable) {
    return createHealthResult('unhealthy', null, `Port ${port} is not reachable.`)
  }

  const normalizedHealthPath = normalizeHealthCheckPath(healthCheckPath)
  const healthUrl = `http://127.0.0.1:${port}${normalizedHealthPath}`

  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(1000)
    })

    if (response.status === 404) {
      return createHealthResult('unknown', healthUrl, 'Health endpoint was not found, but the port is reachable.')
    }

    if (!response.ok) {
      return createHealthResult('unhealthy', healthUrl, `Health endpoint returned HTTP ${response.status}.`)
    }

    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { status?: string }

      if (payload.status && payload.status.toUpperCase() !== 'UP') {
        return createHealthResult('unhealthy', healthUrl, `Health status is ${payload.status}.`)
      }
    }

    return createHealthResult('healthy', healthUrl, 'Health endpoint responded successfully.')
  } catch (error) {
    return createHealthResult(
      'unhealthy',
      healthUrl,
      error instanceof Error ? error.message : 'Health endpoint request failed.'
    )
  }
}

function createHealthResult(status: ServiceHealthStatus, url: string | null, detail: string) {
  return {
    status,
    url,
    detail
  }
}

function normalizeHealthCheckPath(input: string) {
  const trimmedInput = input.trim()

  if (trimmedInput.length === 0) {
    return DEFAULT_HEALTH_CHECK_PATH
  }

  return trimmedInput.startsWith('/') ? trimmedInput : `/${trimmedInput}`
}
