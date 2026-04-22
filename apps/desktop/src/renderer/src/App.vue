<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import {
  APP_NAME,
  DEFAULT_BUILD_TOOL_PREFERENCE,
  DEFAULT_CLOSE_ACTION,
  DEFAULT_HEALTH_CHECK_PATH,
  DEFAULT_MAVEN_THREADS,
  DEFAULT_SERVER_URL,
  DEFAULT_SKIP_TESTS,
  DEFAULT_TRAY_ENABLED,
  type AppSettings,
  type AppSettingsUpdateRequest,
  type AppStateResponse,
  type BuildToolPreference,
  type DesktopRuntimeInfo,
  type DesktopCloseAction,
  type HealthResponse,
  type PreflightCheckStatus,
  type ProjectPreflightReport,
  type ProjectPreflightRequest,
  type ProjectPreferenceUpdateRequest,
  type ProjectScanRequest,
  type ProjectScanResult,
  type ReleaseReadinessResponse,
  type RecentProject,
  type RuntimeDetectionRequest,
  type RuntimeDetectionResult,
  type SavedServiceGroup,
  type SavedServiceGroupsResponse,
  type ServiceCandidate,
  type ServiceGroupInstance,
  type ServiceGroupLaunchRequest,
  type ServiceGroupSaveRequest,
  type ServiceLogContentResponse,
  type ServiceLogHistoryEntry,
  type ServiceInstanceState,
  type ServiceLaunchRequest,
  type ServiceStreamEvent,
  type ToolAvailability,
  type ToolSupportLevel
} from '@microlight/shared'
import { DEFAULT_LOCALE, messages, type Locale } from './locales'

interface ServiceLaunchConfig {
  runtimePort: string
  buildToolPreference: BuildToolPreference
  skipTests: boolean
  jvmArgs: string
  programArgs: string
  springProfiles: string
  healthCheckPath: string
  mavenThreads: string
  dependsOnServiceIds: string[]
}

type LogLevelFilter = 'all' | 'info' | 'warn' | 'error' | 'debug'
type RenderedLogLevel = 'default' | 'info' | 'warn' | 'error' | 'debug'

interface LogLineView {
  lineNumber: number
  text: string
  level: RenderedLogLevel
  isDiagnostic: boolean
}

interface LogContextView {
  centerLine: LogLineView
  contextLines: LogLineView[]
  startLineNumber: number
  endLineNumber: number
}

const runtimeInfo = ref<DesktopRuntimeInfo | null>(null)
const health = ref<HealthResponse | null>(null)
const preflightReport = ref<ProjectPreflightReport | null>(null)
const releaseReadiness = ref<ReleaseReadinessResponse | null>(null)
const selectedProjectPath = ref('')
const projectScan = ref<ProjectScanResult | null>(null)
const runtimeDetection = ref<RuntimeDetectionResult | null>(null)
const serviceInstances = ref<Record<string, ServiceInstanceState>>({})
const serviceGroups = ref<ServiceGroupInstance[]>([])
const savedServiceGroups = ref<SavedServiceGroup[]>([])
const serviceLaunchConfigs = ref<Record<string, ServiceLaunchConfig>>({})
const locale = ref<Locale>(DEFAULT_LOCALE)
const appSettings = ref<AppSettings>({
  locale: DEFAULT_LOCALE,
  defaultBuildToolPreference: DEFAULT_BUILD_TOOL_PREFERENCE,
  defaultSkipTests: DEFAULT_SKIP_TESTS,
  lastProjectPath: null,
  trayEnabled: DEFAULT_TRAY_ENABLED,
  closeAction: DEFAULT_CLOSE_ACTION
})
const recentProjects = ref<RecentProject[]>([])
const selectedLogServiceId = ref('')
const logHistoryEntries = ref<ServiceLogHistoryEntry[]>([])
const selectedLogHistoryId = ref('')
const activeLogHistory = ref<ServiceLogContentResponse | null>(null)
const loading = ref(true)
const preflightLoading = ref(false)
const releaseLoading = ref(false)
const scanning = ref(false)
const detecting = ref(false)
const logHistoryLoading = ref(false)
const liveLogSearchKeyword = ref('')
const liveLogLevelFilter = ref<LogLevelFilter>('all')
const liveLogFollowEnabled = ref(true)
const historyLogSearchKeyword = ref('')
const historyLogLevelFilter = ref<LogLevelFilter>('all')
const errorMessage = ref('')
const scanErrorMessage = ref('')
const runtimeErrorMessage = ref('')
const settingsMessage = ref('')
const serviceGroupMessage = ref('')
const logWorkspaceMessage = ref('')
const serviceActionState = ref<Record<string, boolean>>({})
const serviceGroupActionRunning = ref(false)
const serviceGroupStartupIntervalSeconds = ref('5')
const liveLogPanelRef = ref<HTMLElement | null>(null)
const historyLogPanelRef = ref<HTMLElement | null>(null)
const selectedLiveDiagnosticLineNumber = ref<number | null>(null)
const selectedHistoryDiagnosticLineNumber = ref<number | null>(null)
const text = computed(() => messages[locale.value])
const logStreams = new Map<string, EventSource>()
let refreshTimer: number | null = null

onMounted(() => {
  void initializeApp()
  refreshTimer = window.setInterval(() => {
    void refreshInstances()
  }, 3000)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }

  for (const stream of logStreams.values()) {
    stream.close()
  }

  logStreams.clear()
})

watchEffect(() => {
  document.title = text.value.appTitle
})

watch(
  serviceInstances,
  (instances) => {
    const activeIds = new Set(
      Object.values(instances)
        .filter((instance) => instance.status === 'building' || instance.status === 'running')
        .map((instance) => instance.serviceId)
    )

    for (const serviceId of activeIds) {
      ensureLogStream(serviceId)
    }

    for (const [serviceId, stream] of logStreams.entries()) {
      if (!activeIds.has(serviceId)) {
        stream.close()
        logStreams.delete(serviceId)
      }
    }
  },
  { deep: true }
)

watch(projectScan, (scanResult) => {
  if (!scanResult) {
    serviceLaunchConfigs.value = {}
    savedServiceGroups.value = []
    return
  }

  const nextConfigs: Record<string, ServiceLaunchConfig> = {}

  for (const module of scanResult.modules) {
    for (const candidate of module.serviceCandidates) {
      const serviceId = getServiceId(module.artifactId, candidate.mainClass)
      nextConfigs[serviceId] = createLaunchConfig(candidate)
    }
  }

  serviceLaunchConfigs.value = nextConfigs
  selectedLogServiceId.value = scanResult.savedLastSelectedServiceId ?? ''
})

watch(selectedLogServiceId, (serviceId) => {
  if (!selectedProjectPath.value) {
    return
  }

  logWorkspaceMessage.value = ''
  liveLogSearchKeyword.value = ''
  liveLogLevelFilter.value = 'all'
  liveLogFollowEnabled.value = true
  selectedLiveDiagnosticLineNumber.value = null
  historyLogSearchKeyword.value = ''
  historyLogLevelFilter.value = 'all'
  selectedHistoryDiagnosticLineNumber.value = null

  if (!serviceId) {
    logHistoryEntries.value = []
    selectedLogHistoryId.value = ''
    activeLogHistory.value = null
  } else {
    void loadLogHistory(serviceId)
  }

  void saveProjectPreference(serviceId || null)
})

async function initializeApp() {
  loading.value = true
  errorMessage.value = ''

  try {
    runtimeInfo.value = await window.microlight.getRuntimeInfo()
    await Promise.all([loadHealth(), loadAppState(), loadReleaseReadiness()])
    await refreshPreflight()

    if (appSettings.value.lastProjectPath) {
      selectedProjectPath.value = appSettings.value.lastProjectPath
      await scanProject()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unknown error'
  } finally {
    loading.value = false
  }
}

async function loadHealth() {
  const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/health`)

  if (!response.ok) {
    throw new Error(`Health request failed with ${response.status}`)
  }

  health.value = (await response.json()) as HealthResponse
}

async function refreshPreflight() {
  preflightLoading.value = true

  try {
    const payload: ProjectPreflightRequest = {
      rootPath: selectedProjectPath.value.trim() || null
    }

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/projects/preflight`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const body = (await response.json()) as { message?: string }
      throw new Error(body.message ?? `Preflight failed: ${response.status}`)
    }

    preflightReport.value = (await response.json()) as ProjectPreflightReport
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown preflight error'
    preflightReport.value = null
  } finally {
    preflightLoading.value = false
  }
}

async function loadReleaseReadiness() {
  releaseLoading.value = true

  try {
    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/release/readiness`)

    if (!response.ok) {
      throw new Error(`Release readiness failed: ${response.status}`)
    }

    releaseReadiness.value = (await response.json()) as ReleaseReadinessResponse
  } catch {
    releaseReadiness.value = null
  } finally {
    releaseLoading.value = false
  }
}

async function loadAppState() {
  const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/app-state`)

  if (!response.ok) {
    throw new Error(`App state request failed with ${response.status}`)
  }

  const appState = (await response.json()) as AppStateResponse
  appSettings.value = appState.settings
  recentProjects.value = appState.recentProjects
  locale.value = appState.settings.locale
  await applyDesktopSettings()
}

function setLocale(nextLocale: Locale) {
  locale.value = nextLocale
  appSettings.value = {
    ...appSettings.value,
    locale: nextLocale
  }
}

async function saveSettings() {
  settingsMessage.value = ''
  runtimeErrorMessage.value = ''

  try {
    const payload: AppSettingsUpdateRequest = {
      locale: appSettings.value.locale,
      defaultBuildToolPreference: appSettings.value.defaultBuildToolPreference,
      defaultSkipTests: appSettings.value.defaultSkipTests,
      lastProjectPath: selectedProjectPath.value || appSettings.value.lastProjectPath,
      trayEnabled: appSettings.value.trayEnabled,
      closeAction: appSettings.value.closeAction
    }

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const body = (await response.json()) as { message?: string }
      throw new Error(body.message ?? `Settings save failed: ${response.status}`)
    }

    appSettings.value = (await response.json()) as AppSettings
    locale.value = appSettings.value.locale
    await applyDesktopSettings()
    settingsMessage.value = text.value.settingsSaved
    await loadAppState()
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown settings error'
  }
}

async function applyDesktopSettings() {
  await window.microlight.applyDesktopSettings({
    trayEnabled: appSettings.value.trayEnabled,
    closeAction: appSettings.value.closeAction
  })
}

async function saveProjectPreference(lastSelectedServiceId: string | null) {
  const projectPath = selectedProjectPath.value.trim()

  if (!projectPath) {
    return
  }

  const payload: ProjectPreferenceUpdateRequest = {
    rootPath: projectPath,
    lastSelectedServiceId
  }

  try {
    await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/projects/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
  } catch {
    // Ignore project preference persistence failures in the initial implementation.
  }
}

async function selectProjectDirectory() {
  const selectedPath = await window.microlight.selectProjectDirectory()

  if (selectedPath) {
    selectedProjectPath.value = selectedPath
  }
}

async function restoreRecentProject(rootPath: string) {
  selectedProjectPath.value = rootPath
  await scanProject()
}

async function scanProject() {
  if (!selectedProjectPath.value) {
    scanErrorMessage.value = text.value.selectProjectFirst
    return
  }

  scanning.value = true
  scanErrorMessage.value = ''

  try {
    const requestBody: ProjectScanRequest = {
      rootPath: selectedProjectPath.value
    }

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/projects/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `${text.value.scanFailedPrefix}: ${response.status}`)
    }

    projectScan.value = (await response.json()) as ProjectScanResult
    runtimeDetection.value = null
    runtimeErrorMessage.value = ''
    settingsMessage.value = ''
    await loadAppState()
    await refreshPreflight()
    await loadSavedServiceGroups()
  } catch (error) {
    scanErrorMessage.value = error instanceof Error ? error.message : 'Unknown scan error'
    projectScan.value = null
  } finally {
    scanning.value = false
  }
}

async function detectRuntime() {
  if (!selectedProjectPath.value) {
    runtimeErrorMessage.value = text.value.runtimeDetectFirst
    return
  }

  detecting.value = true
  runtimeErrorMessage.value = ''

  try {
    const requestBody: RuntimeDetectionRequest = {
      rootPath: selectedProjectPath.value
    }

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/runtime/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Runtime detection failed: ${response.status}`)
    }

    runtimeDetection.value = (await response.json()) as RuntimeDetectionResult
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown runtime error'
  } finally {
    detecting.value = false
  }
}

function getServiceId(artifactId: string, mainClass: string) {
  return `${artifactId}:${mainClass}`
}

function createLaunchConfig(candidate: ServiceCandidate): ServiceLaunchConfig {
  return {
    runtimePort: candidate.defaultPort === null ? '' : String(candidate.defaultPort),
    buildToolPreference: candidate.savedBuildToolPreference,
    skipTests: candidate.savedSkipTests,
    jvmArgs: candidate.savedJvmArgs,
    programArgs: candidate.savedProgramArgs,
    springProfiles: candidate.savedSpringProfiles,
    healthCheckPath: candidate.savedHealthCheckPath,
    mavenThreads: candidate.savedMavenThreads,
    dependsOnServiceIds: []
  }
}

function getLaunchConfig(artifactId: string, candidate: ServiceCandidate) {
  const serviceId = getServiceId(artifactId, candidate.mainClass)
  const existing = serviceLaunchConfigs.value[serviceId]

  if (existing) {
    return existing
  }

  const nextConfig = createLaunchConfig(candidate)
  serviceLaunchConfigs.value = {
    ...serviceLaunchConfigs.value,
    [serviceId]: nextConfig
  }

  return nextConfig
}

function normalizeRuntimePort(value: string) {
  const trimmedValue = value.trim()

  if (trimmedValue.length === 0) {
    return null
  }

  const parsed = Number(trimmedValue)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(text.value.serviceConfigPortInvalid)
  }

  return parsed
}

function normalizeServiceGroupStartupIntervalMs() {
  const trimmedValue = serviceGroupStartupIntervalSeconds.value.trim()
  const parsed = trimmedValue.length === 0 ? 0 : Number(trimmedValue)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 600) {
    throw new Error(text.value.serviceGroupStartupIntervalInvalid)
  }

  return Math.trunc(parsed * 1000)
}

function normalizeProfiles(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(',')
}

function normalizeHealthCheckPath(value: string) {
  const trimmedValue = value.trim()

  if (trimmedValue.length === 0) {
    return DEFAULT_HEALTH_CHECK_PATH
  }

  return trimmedValue.startsWith('/') ? trimmedValue : `/${trimmedValue}`
}

function normalizeMavenThreads(value: string) {
  const trimmedValue = value.trim()

  if (trimmedValue.length === 0) {
    return DEFAULT_MAVEN_THREADS
  }

  const normalizedValue = trimmedValue.toUpperCase()

  if (!/^(?:[1-9]\d*|[1-9]\d*(?:\.\d+)?C|0?\.\d+C)$/.test(normalizedValue)) {
    throw new Error(text.value.serviceConfigMavenThreadsInvalid)
  }

  return normalizedValue
}

function normalizeDependencyIds(serviceId: string, dependsOnServiceIds: string[]) {
  return Array.from(new Set(dependsOnServiceIds.filter((dependencyId) => dependencyId !== serviceId)))
}

function getCloseActionLabel(closeAction: DesktopCloseAction, trayEnabled: boolean) {
  if (!trayEnabled) {
    return text.value.settingsCloseActionQuit
  }

  return closeAction === 'hide' ? text.value.settingsCloseActionHide : text.value.settingsCloseActionQuit
}

function getPreflightStatusLabel(status: PreflightCheckStatus) {
  if (status === 'pass') {
    return text.value.preflightPass
  }

  if (status === 'warn') {
    return text.value.preflightWarn
  }

  return text.value.preflightFail
}

function getReleaseArtifactLabel(id: string) {
  if (id === 'windows-installer') {
    return text.value.releaseInstallerArtifact
  }

  if (id === 'unpacked-executable') {
    return text.value.releaseUnpackedArtifact
  }

  return id
}

function getEnvironmentToolLabel(tool: ToolAvailability) {
  switch (tool.kind) {
    case 'java':
      return text.value.environmentJava
    case 'mvnw':
      return text.value.environmentMavenWrapper
    case 'mvn':
      return text.value.environmentMaven
    default:
      return text.value.environmentMvnd
  }
}

function getToolSupportLabel(level: ToolSupportLevel) {
  switch (level) {
    case 'stable':
      return text.value.environmentSupportStable
    case 'experimental':
      return text.value.environmentSupportExperimental
    case 'unsupported':
      return text.value.environmentSupportUnsupported
    default:
      return text.value.environmentSupportUnknown
  }
}

function getToolSupportDetail(tool: ToolAvailability) {
  if (!tool.available) {
    return tool.detail ?? text.value.runtimePending
  }

  if (tool.kind === 'java') {
    return text.value.environmentDetailJava
  }

  if (tool.kind === 'mvnd') {
    if (tool.supportLevel === 'stable') {
      return text.value.environmentDetailMvndStable
    }

    if (tool.supportLevel === 'experimental') {
      return text.value.environmentDetailMvndExperimental
    }

    if (tool.supportLevel === 'unsupported') {
      return text.value.environmentDetailMvndUnsupported
    }

    return tool.detail ?? text.value.runtimePending
  }

  if (tool.supportLevel === 'stable') {
    return text.value.environmentDetailMavenStable
  }

  if (tool.supportLevel === 'experimental') {
    return text.value.environmentDetailMavenExperimental
  }

  if (tool.supportLevel === 'unsupported') {
    return text.value.environmentDetailMavenUnsupported
  }

  return tool.detail ?? text.value.runtimePending
}

function getCompatibilityMatchStateLabel(
  matchState: RuntimeDetectionResult['compatibilityMatrix'][number]['matchState']
) {
  switch (matchState) {
    case 'recommended':
      return text.value.compatibilityMatrixRecommended
    case 'detected':
      return text.value.compatibilityMatrixDetected
    default:
      return text.value.compatibilityMatrixNotDetected
  }
}

function getServiceStatusLabel(status: ServiceInstanceState['status']) {
  switch (status) {
    case 'building':
      return text.value.serviceBuilding
    case 'running':
      return text.value.serviceRunning
    case 'stopped':
      return text.value.serviceStopped
    case 'failed':
      return text.value.serviceFailed
    default:
      return text.value.serviceIdle
  }
}

function getServiceGroupStatusLabel(status: ServiceGroupInstance['status']) {
  switch (status) {
    case 'running':
      return text.value.serviceGroupRunning
    case 'completed':
      return text.value.serviceGroupCompleted
    case 'failed':
      return text.value.serviceGroupFailed
    case 'stopping':
      return text.value.serviceGroupStopping
    default:
      return text.value.serviceGroupStopped
  }
}

function getServiceGroupItemStatusLabel(status: ServiceGroupInstance['services'][number]['status']) {
  switch (status) {
    case 'pending':
      return text.value.serviceGroupItemPending
    case 'running':
      return text.value.serviceGroupRunning
    case 'completed':
      return text.value.serviceGroupCompleted
    case 'failed':
      return text.value.serviceGroupFailed
    default:
      return text.value.serviceGroupStopped
  }
}

function getServiceHealthLabel(status: ServiceInstanceState['healthStatus']) {
  switch (status) {
    case 'healthy':
      return text.value.serviceHealthHealthy
    case 'unhealthy':
      return text.value.serviceHealthUnhealthy
    default:
      return text.value.serviceHealthUnknown
  }
}

function formatCpu(cpuPercent: number | null) {
  return cpuPercent === null ? text.value.runtimePending : `${cpuPercent.toFixed(1)}%`
}

function formatMemory(memoryRssBytes: number | null) {
  return memoryRssBytes === null ? text.value.runtimePending : `${(memoryRssBytes / 1024 / 1024).toFixed(1)} MB`
}

function formatPort(port: number | null) {
  return port === null ? text.value.runtimePending : String(port)
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

function formatExportTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function toSafeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-')
}

function getRenderedLogLevel(line: string): RenderedLogLevel {
  if (/\berror\b/i.test(line) || /\bexception\b/i.test(line) || /\bcaused by\b/i.test(line)) {
    return 'error'
  }

  if (/\bwarn(?:ing)?\b/i.test(line)) {
    return 'warn'
  }

  if (/\binfo\b/i.test(line) || /\bstarted\b/i.test(line) || /\bstartup\b/i.test(line)) {
    return 'info'
  }

  if (/\bdebug\b/i.test(line) || /\btrace\b/i.test(line)) {
    return 'debug'
  }

  return 'default'
}

function isDiagnosticLogLine(line: string) {
  return /\berror\b/i.test(line) || /\bexception\b/i.test(line) || /\bcaused by\b/i.test(line) || /\bfailed\b/i.test(line)
}

function matchesLogLevel(line: string, level: LogLevelFilter) {
  if (level === 'all') {
    return true
  }

  switch (level) {
    case 'info':
      return /\binfo\b/i.test(line)
    case 'warn':
      return /\bwarn(?:ing)?\b/i.test(line)
    case 'error':
      return /\berror\b/i.test(line) || /\bexception\b/i.test(line)
    case 'debug':
      return /\bdebug\b/i.test(line) || /\btrace\b/i.test(line)
    default:
      return true
  }
}

function buildLogLineViews(lines: string[], keyword: string, level: LogLevelFilter) {
  const normalizedKeyword = keyword.trim().toLowerCase()

  return lines.flatMap((line, index) => {
    if (!matchesLogLevel(line, level)) {
      return []
    }

    if (normalizedKeyword && !line.toLowerCase().includes(normalizedKeyword)) {
      return []
    }

    return [
      {
        lineNumber: index + 1,
        text: line,
        level: getRenderedLogLevel(line),
        isDiagnostic: isDiagnosticLogLine(line)
      } satisfies LogLineView
    ]
  })
}

function buildContextLineViews(lines: string[], centerLineNumber: number, radius = 3): LogContextView | null {
  if (centerLineNumber <= 0 || centerLineNumber > lines.length) {
    return null
  }

  const startIndex = Math.max(0, centerLineNumber - radius - 1)
  const endIndex = Math.min(lines.length - 1, centerLineNumber + radius - 1)
  const contextLines = lines.slice(startIndex, endIndex + 1).map((line, index) => {
    const lineNumber = startIndex + index + 1

    return {
      lineNumber,
      text: line,
      level: getRenderedLogLevel(line),
      isDiagnostic: isDiagnosticLogLine(line)
    } satisfies LogLineView
  })

  return {
    centerLine: contextLines.find((line) => line.lineNumber === centerLineNumber) ?? contextLines[0],
    contextLines,
    startLineNumber: startIndex + 1,
    endLineNumber: endIndex + 1
  }
}

async function scrollToLogLine(panel: HTMLElement | null, lineNumber: number) {
  await nextTick()

  const target = panel?.querySelector<HTMLElement>(`[data-line-number="${lineNumber}"]`)

  if (!target) {
    return
  }

  target.scrollIntoView({
    block: 'center',
    behavior: 'smooth'
  })
}

async function syncLiveLogScroll(force = false) {
  if (!force && !liveLogFollowEnabled.value) {
    return
  }

  await nextTick()

  if (!liveLogPanelRef.value) {
    return
  }

  liveLogPanelRef.value.scrollTop = liveLogPanelRef.value.scrollHeight
}

function toggleLiveLogFollow() {
  liveLogFollowEnabled.value = !liveLogFollowEnabled.value

  if (liveLogFollowEnabled.value) {
    void syncLiveLogScroll(true)
  }
}

function buildLogExportContent(title: string, sourcePath: string | null, lines: string[]) {
  const header = [
    `${title}`,
    `generatedAt=${new Date().toISOString()}`,
    `projectPath=${selectedProjectPath.value || 'unknown'}`,
    sourcePath ? `sourcePath=${sourcePath}` : null,
    ''
  ].filter((line): line is string => Boolean(line))

  return [...header, ...lines].join('\n')
}

async function copyLogs(title: string, lineViews: LogLineView[]) {
  if (lineViews.length === 0) {
    logWorkspaceMessage.value = text.value.serviceLogActionEmpty
    return
  }

  await window.microlight.copyText(lineViews.map((line) => line.text).join('\n'))
  logWorkspaceMessage.value = `${title}${text.value.serviceLogCopiedSuffix}`
}

async function exportLogs(title: string, sourcePath: string | null, fileNameBase: string, lineViews: LogLineView[]) {
  if (lineViews.length === 0) {
    logWorkspaceMessage.value = text.value.serviceLogActionEmpty
    return
  }

  const result = await window.microlight.saveTextFile({
    title: `${title} · ${text.value.serviceLogExport}`,
    defaultFileName: `${toSafeFileName(fileNameBase)}-${formatExportTimestamp()}.log`,
    content: buildLogExportContent(title, sourcePath, lineViews.map((line) => line.text))
  })

  if (result.canceled) {
    return
  }

  logWorkspaceMessage.value = `${text.value.serviceLogExportedPrefix}${result.filePath ?? ''}`
}

async function copyLiveLogs() {
  try {
    runtimeErrorMessage.value = ''
    await copyLogs(text.value.serviceLogs, filteredActiveLogLineViews.value)
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown log copy error'
  }
}

async function exportLiveLogs() {
  if (!activeLogInstance.value) {
    return
  }

  try {
    runtimeErrorMessage.value = ''
    await exportLogs(
      `${activeLogInstance.value.artifactId} ${text.value.serviceLogs}`,
      activeLogInstance.value.logFilePath,
      `${activeLogInstance.value.artifactId}-live-log`,
      filteredActiveLogLineViews.value
    )
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown log export error'
  }
}

async function copyHistoryLogs() {
  try {
    runtimeErrorMessage.value = ''
    await copyLogs(text.value.serviceLogHistoryTitle, filteredHistoryLogLineViews.value)
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown log copy error'
  }
}

async function exportHistoryLogs() {
  if (!activeLogHistory.value) {
    return
  }

  try {
    runtimeErrorMessage.value = ''
    await exportLogs(
      `${activeLogHistory.value.entry.fileName} ${text.value.serviceLogHistoryTitle}`,
      activeLogHistory.value.entry.filePath,
      activeLogHistory.value.entry.fileName.replace(/\.log$/i, ''),
      filteredHistoryLogLineViews.value
    )
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown log export error'
  }
}

async function copyDiagnosticContext(title: string, context: LogContextView | null) {
  try {
    runtimeErrorMessage.value = ''

    if (!context) {
      logWorkspaceMessage.value = text.value.serviceLogDiagnosticEmpty
      return
    }

    await copyLogs(title, context.contextLines)
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown log copy error'
  }
}

async function exportDiagnosticContext(
  title: string,
  sourcePath: string | null,
  fileNameBase: string,
  context: LogContextView | null
) {
  try {
    runtimeErrorMessage.value = ''

    if (!context) {
      logWorkspaceMessage.value = text.value.serviceLogDiagnosticEmpty
      return
    }

    await exportLogs(title, sourcePath, fileNameBase, context.contextLines)
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown log export error'
  }
}

async function focusLiveDiagnostic(lineNumber: number) {
  liveLogFollowEnabled.value = false
  selectedLiveDiagnosticLineNumber.value = lineNumber
  await scrollToLogLine(liveLogPanelRef.value, lineNumber)
}

async function focusHistoryDiagnostic(lineNumber: number) {
  selectedHistoryDiagnosticLineNumber.value = lineNumber
  await scrollToLogLine(historyLogPanelRef.value, lineNumber)
}

async function copyLiveDiagnosticContext() {
  await copyDiagnosticContext(text.value.serviceLogContextTitle, liveDiagnosticContext.value)
}

async function exportLiveDiagnosticContext() {
  await exportDiagnosticContext(
    text.value.serviceLogContextTitle,
    activeLogInstance.value?.logFilePath ?? null,
    `${activeLogInstance.value?.artifactId ?? 'service'}-diagnostic-context`,
    liveDiagnosticContext.value
  )
}

async function copyHistoryDiagnosticContext() {
  await copyDiagnosticContext(text.value.serviceLogContextTitle, historyDiagnosticContext.value)
}

async function exportHistoryDiagnosticContext() {
  await exportDiagnosticContext(
    text.value.serviceLogContextTitle,
    activeLogHistory.value?.entry.filePath ?? null,
    `${activeLogHistory.value?.entry.fileName.replace(/\.log$/i, '') ?? 'history'}-diagnostic-context`,
    historyDiagnosticContext.value
  )
}

function createServiceLaunchRequest(modulePath: string, artifactId: string, candidate: ServiceCandidate) {
  const launchConfig = getLaunchConfig(artifactId, candidate)
  const serviceId = getServiceId(artifactId, candidate.mainClass)

  return {
    rootPath: selectedProjectPath.value,
    modulePath,
    artifactId,
    mainClass: candidate.mainClass,
    runtimePort: normalizeRuntimePort(launchConfig.runtimePort),
    buildToolPreference: launchConfig.buildToolPreference,
    skipTests: launchConfig.skipTests,
    jvmArgs: launchConfig.jvmArgs.trim(),
    programArgs: launchConfig.programArgs.trim(),
    springProfiles: normalizeProfiles(launchConfig.springProfiles),
    healthCheckPath: normalizeHealthCheckPath(launchConfig.healthCheckPath),
    mavenThreads: normalizeMavenThreads(launchConfig.mavenThreads),
    dependsOnServiceIds: normalizeDependencyIds(serviceId, launchConfig.dependsOnServiceIds)
  } satisfies ServiceLaunchRequest
}

function getDependencyOptions(artifactId: string, candidate: ServiceCandidate) {
  if (!projectScan.value) {
    return []
  }

  const currentServiceId = getServiceId(artifactId, candidate.mainClass)

  return projectScan.value.modules.flatMap((module) =>
    module.serviceCandidates
      .map((serviceCandidate) => {
        const serviceId = getServiceId(module.artifactId, serviceCandidate.mainClass)

        return {
          serviceId,
          label: `${module.artifactId} · ${serviceCandidate.className}`
        }
      })
      .filter((option) => option.serviceId !== currentServiceId)
  )
}

function createScannedServiceLaunchRequests() {
  if (!projectScan.value) {
    return []
  }

  return projectScan.value.modules.flatMap((module) =>
    module.serviceCandidates.map((candidate) =>
      createServiceLaunchRequest(module.modulePath, module.artifactId, candidate)
    )
  )
}

async function launchService(modulePath: string, artifactId: string, candidate: ServiceCandidate) {
  const serviceId = getServiceId(artifactId, candidate.mainClass)
  serviceActionState.value[serviceId] = true
  runtimeErrorMessage.value = ''

  try {
    const requestBody = createServiceLaunchRequest(modulePath, artifactId, candidate)

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/services/launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Launch failed: ${response.status}`)
    }

    const instance = (await response.json()) as ServiceInstanceState
    serviceInstances.value = {
      ...serviceInstances.value,
      [instance.serviceId]: instance
    }
    selectedLogServiceId.value = instance.serviceId
    await loadLogHistory(instance.serviceId)
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown launch error'
  } finally {
    serviceActionState.value[serviceId] = false
    await refreshInstances()
  }
}

async function launchScannedServiceGroup() {
  if (!projectScan.value || scannedServiceCount.value === 0) {
    runtimeErrorMessage.value = text.value.serviceGroupEmpty
    return
  }

  serviceGroupActionRunning.value = true
  runtimeErrorMessage.value = ''

  try {
    const services = createScannedServiceLaunchRequests()
    const requestBody: ServiceGroupLaunchRequest = {
      groupName: projectScan.value.artifactId,
      services,
      stopOnFailure: true,
      startupIntervalMs: normalizeServiceGroupStartupIntervalMs()
    }

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/service-groups/launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Service group launch failed: ${response.status}`)
    }

    const group = (await response.json()) as ServiceGroupInstance
    serviceGroups.value = [group, ...serviceGroups.value.filter((item) => item.groupId !== group.groupId)]
    selectedLogServiceId.value = group.services.find((service) => service.instance)?.serviceId ?? selectedLogServiceId.value
    await refreshInstances()

    if (selectedLogServiceId.value) {
      await loadLogHistory(selectedLogServiceId.value)
    }
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown service group error'
  } finally {
    serviceGroupActionRunning.value = false
  }
}

async function saveScannedServiceGroup() {
  if (!projectScan.value || scannedServiceCount.value === 0) {
    runtimeErrorMessage.value = text.value.serviceGroupEmpty
    return
  }

  serviceGroupActionRunning.value = true
  runtimeErrorMessage.value = ''
  serviceGroupMessage.value = ''

  try {
    const requestBody: ServiceGroupSaveRequest = {
      groupName: projectScan.value.artifactId,
      rootPath: selectedProjectPath.value,
      services: createScannedServiceLaunchRequests(),
      stopOnFailure: true,
      startupIntervalMs: normalizeServiceGroupStartupIntervalMs()
    }

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/service-groups/saved`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Service group save failed: ${response.status}`)
    }

    const savedGroup = (await response.json()) as SavedServiceGroup
    savedServiceGroups.value = [
      savedGroup,
      ...savedServiceGroups.value.filter((group) => group.groupId !== savedGroup.groupId)
    ]
    serviceGroupMessage.value = text.value.serviceGroupSavedMessage
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown service group error'
  } finally {
    serviceGroupActionRunning.value = false
  }
}

async function launchSavedServiceGroup(group: SavedServiceGroup) {
  serviceGroupActionRunning.value = true
  runtimeErrorMessage.value = ''
  serviceGroupMessage.value = ''

  try {
    const requestBody: ServiceGroupLaunchRequest = {
      groupName: group.groupName,
      services: group.services,
      stopOnFailure: group.stopOnFailure,
      startupIntervalMs: group.startupIntervalMs
    }

    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/service-groups/launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Saved service group launch failed: ${response.status}`)
    }

    const launchedGroup = (await response.json()) as ServiceGroupInstance
    serviceGroups.value = [
      launchedGroup,
      ...serviceGroups.value.filter((item) => item.groupId !== launchedGroup.groupId)
    ]
    selectedLogServiceId.value =
      launchedGroup.services.find((service) => service.instance)?.serviceId ?? selectedLogServiceId.value
    await refreshInstances()

    if (selectedLogServiceId.value) {
      await loadLogHistory(selectedLogServiceId.value)
    }
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown service group error'
  } finally {
    serviceGroupActionRunning.value = false
  }
}

async function deleteSavedServiceGroup(groupId: string) {
  serviceGroupActionRunning.value = true
  runtimeErrorMessage.value = ''
  serviceGroupMessage.value = ''

  try {
    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/service-groups/saved/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ groupId })
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Saved service group delete failed: ${response.status}`)
    }

    savedServiceGroups.value = savedServiceGroups.value.filter((group) => group.groupId !== groupId)
    serviceGroupMessage.value = text.value.serviceGroupDeletedMessage
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown service group error'
  } finally {
    serviceGroupActionRunning.value = false
  }
}

async function loadSavedServiceGroups() {
  const rootPath = selectedProjectPath.value.trim()

  if (!rootPath) {
    savedServiceGroups.value = []
    return
  }

  const response = await fetch(
    `${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/service-groups/saved?rootPath=${encodeURIComponent(rootPath)}`
  )

  if (!response.ok) {
    return
  }

  const payload = (await response.json()) as SavedServiceGroupsResponse
  savedServiceGroups.value = payload.groups
}

async function stopLastServiceGroup() {
  const group = lastServiceGroup.value

  if (!group) {
    runtimeErrorMessage.value = text.value.serviceGroupNoActive
    return
  }

  serviceGroupActionRunning.value = true
  runtimeErrorMessage.value = ''

  try {
    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/service-groups/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ groupId: group.groupId })
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Service group stop failed: ${response.status}`)
    }

    const stoppedGroup = (await response.json()) as ServiceGroupInstance
    serviceGroups.value = [
      stoppedGroup,
      ...serviceGroups.value.filter((item) => item.groupId !== stoppedGroup.groupId)
    ]
    await refreshInstances()
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown service group error'
  } finally {
    serviceGroupActionRunning.value = false
  }
}

async function stopService(serviceId: string) {
  serviceActionState.value[serviceId] = true

  try {
    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/services/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ serviceId })
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Stop failed: ${response.status}`)
    }

    const instance = (await response.json()) as ServiceInstanceState
    serviceInstances.value = {
      ...serviceInstances.value,
      [instance.serviceId]: instance
    }
    selectedLogServiceId.value = instance.serviceId
    await loadLogHistory(instance.serviceId)
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown stop error'
  } finally {
    serviceActionState.value[serviceId] = false
    await refreshInstances()
  }
}

async function restartService(serviceId: string) {
  serviceActionState.value[serviceId] = true

  try {
    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/services/restart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ serviceId })
    })

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Restart failed: ${response.status}`)
    }

    const instance = (await response.json()) as ServiceInstanceState
    serviceInstances.value = {
      ...serviceInstances.value,
      [instance.serviceId]: instance
    }
    await loadLogHistory(instance.serviceId)
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown restart error'
  } finally {
    serviceActionState.value[serviceId] = false
    await refreshInstances()
  }
}

async function refreshInstances() {
  try {
    const response = await fetch(`${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/services/instances`)

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as { instances: ServiceInstanceState[] }
    serviceInstances.value = Object.fromEntries(
      payload.instances.map((instance) => [instance.serviceId, instance])
    )
  } catch {
    // Ignore background refresh failures in the initial implementation.
  }
}

async function loadLogHistory(serviceId: string) {
  logHistoryLoading.value = true

  try {
    const response = await fetch(
      `${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/services/${encodeURIComponent(serviceId)}/logs/history`
    )

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string }
      throw new Error(payload.message ?? `Log history failed: ${response.status}`)
    }

    const payload = (await response.json()) as { entries: ServiceLogHistoryEntry[] }
    logHistoryEntries.value = payload.entries

    const nextEntryId =
      payload.entries.find((entry) => entry.id === selectedLogHistoryId.value)?.id ??
      payload.entries[0]?.id ??
      ''

    selectedLogHistoryId.value = nextEntryId

    if (nextEntryId) {
      await loadLogHistoryContent(serviceId, nextEntryId)
    } else {
      activeLogHistory.value = null
    }
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown log history error'
    logHistoryEntries.value = []
    selectedLogHistoryId.value = ''
    activeLogHistory.value = null
  } finally {
    logHistoryLoading.value = false
  }
}

async function loadLogHistoryContent(serviceId: string, entryId: string) {
  if (!entryId) {
    activeLogHistory.value = null
    return
  }

  const response = await fetch(
    `${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/services/${encodeURIComponent(serviceId)}/logs/history/${encodeURIComponent(entryId)}`
  )

  if (!response.ok) {
    const payload = (await response.json()) as { message?: string }
    throw new Error(payload.message ?? `Log content failed: ${response.status}`)
  }

  activeLogHistory.value = (await response.json()) as ServiceLogContentResponse
}

function selectLogHistoryEntry(serviceId: string, entryId: string) {
  selectedLogHistoryId.value = entryId
  logWorkspaceMessage.value = ''
  historyLogSearchKeyword.value = ''
  historyLogLevelFilter.value = 'all'
  selectedHistoryDiagnosticLineNumber.value = null
  void loadLogHistoryContent(serviceId, entryId)
}

function ensureLogStream(serviceId: string) {
  if (logStreams.has(serviceId)) {
    return
  }

  const source = new EventSource(
    `${runtimeInfo.value?.serverUrl ?? DEFAULT_SERVER_URL}/api/services/${encodeURIComponent(serviceId)}/logs/stream`
  )

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as ServiceStreamEvent
      serviceInstances.value = {
        ...serviceInstances.value,
        [payload.instance.serviceId]: payload.instance
      }

      if (!selectedLogServiceId.value) {
        selectedLogServiceId.value = payload.instance.serviceId
      }
    } catch {
      // Ignore malformed stream payloads in the initial implementation.
    }
  }

  source.onerror = () => {
    source.close()
    logStreams.delete(serviceId)
  }

  logStreams.set(serviceId, source)
}

const activeLogInstance = computed(() => {
  if (!selectedLogServiceId.value) {
    return null
  }

  return serviceInstances.value[selectedLogServiceId.value] ?? null
})

const activeLogHistoryEntry = computed(() =>
  logHistoryEntries.value.find((entry) => entry.id === selectedLogHistoryId.value) ?? null
)

const logLevelOptions = computed(() => [
  { value: 'all' satisfies LogLevelFilter, label: text.value.serviceLogLevelAll },
  { value: 'info' satisfies LogLevelFilter, label: text.value.serviceLogLevelInfo },
  { value: 'warn' satisfies LogLevelFilter, label: text.value.serviceLogLevelWarn },
  { value: 'error' satisfies LogLevelFilter, label: text.value.serviceLogLevelError },
  { value: 'debug' satisfies LogLevelFilter, label: text.value.serviceLogLevelDebug }
])

const filteredActiveLogLineViews = computed(() =>
  buildLogLineViews(activeLogInstance.value?.logLines ?? [], liveLogSearchKeyword.value, liveLogLevelFilter.value)
)

const filteredHistoryLogLineViews = computed(() =>
  buildLogLineViews(activeLogHistory.value?.lines ?? [], historyLogSearchKeyword.value, historyLogLevelFilter.value)
)

const liveDiagnosticLineViews = computed(() =>
  filteredActiveLogLineViews.value.filter((line) => line.isDiagnostic).slice(-12)
)

const historyDiagnosticLineViews = computed(() =>
  filteredHistoryLogLineViews.value.filter((line) => line.isDiagnostic).slice(-12)
)

const selectedLiveDiagnosticLineView = computed(
  () =>
    liveDiagnosticLineViews.value.find((line) => line.lineNumber === selectedLiveDiagnosticLineNumber.value) ??
    liveDiagnosticLineViews.value.at(-1) ??
    null
)

const selectedHistoryDiagnosticLineView = computed(
  () =>
    historyDiagnosticLineViews.value.find((line) => line.lineNumber === selectedHistoryDiagnosticLineNumber.value) ??
    historyDiagnosticLineViews.value.at(-1) ??
    null
)

const liveDiagnosticContext = computed(() =>
  buildContextLineViews(activeLogInstance.value?.logLines ?? [], selectedLiveDiagnosticLineView.value?.lineNumber ?? 0)
)

const historyDiagnosticContext = computed(() =>
  buildContextLineViews(activeLogHistory.value?.lines ?? [], selectedHistoryDiagnosticLineView.value?.lineNumber ?? 0)
)

watch(filteredActiveLogLineViews, (lineViews) => {
  if (selectedLiveDiagnosticLineNumber.value === null) {
    return
  }

  if (!lineViews.some((line) => line.lineNumber === selectedLiveDiagnosticLineNumber.value)) {
    selectedLiveDiagnosticLineNumber.value = null
  }
})

watch(filteredHistoryLogLineViews, (lineViews) => {
  if (selectedHistoryDiagnosticLineNumber.value === null) {
    return
  }

  if (!lineViews.some((line) => line.lineNumber === selectedHistoryDiagnosticLineNumber.value)) {
    selectedHistoryDiagnosticLineNumber.value = null
  }
})

watch(liveDiagnosticLineViews, (lineViews) => {
  if (lineViews.length === 0) {
    selectedLiveDiagnosticLineNumber.value = null
    return
  }

  if (selectedLiveDiagnosticLineNumber.value === null) {
    selectedLiveDiagnosticLineNumber.value = lineViews.at(-1)?.lineNumber ?? null
  }
})

watch(historyDiagnosticLineViews, (lineViews) => {
  if (lineViews.length === 0) {
    selectedHistoryDiagnosticLineNumber.value = null
    return
  }

  if (selectedHistoryDiagnosticLineNumber.value === null) {
    selectedHistoryDiagnosticLineNumber.value = lineViews.at(-1)?.lineNumber ?? null
  }
})

watch(
  () =>
    [
      selectedLogServiceId.value,
      activeLogInstance.value?.logLines.length ?? 0,
      filteredActiveLogLineViews.value.length,
      liveLogFollowEnabled.value
    ] as const,
  async ([serviceId, totalLines, visibleLines, followEnabled], previousState) => {
    const previousServiceId = previousState?.[0] ?? ''
    const previousFollowEnabled = previousState?.[3] ?? false

    if (!serviceId) {
      return
    }

    const force = serviceId !== previousServiceId || (followEnabled && !previousFollowEnabled)

    if (!followEnabled && !force) {
      return
    }

    if (!force && totalLines === 0 && visibleLines === 0) {
      return
    }

    await syncLiveLogScroll(force)
  }
)

const logWorkspaceServices = computed(() =>
  Object.values(serviceInstances.value).sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId, 'zh-CN')
  )
)

const scannedServiceCount = computed(() => {
  if (!projectScan.value) {
    return 0
  }

  return projectScan.value.modules.reduce(
    (count, module) => count + module.serviceCandidates.length,
    0
  )
})

const lastServiceGroup = computed(() => serviceGroups.value[0] ?? null)
const runtimeTools = computed(() =>
  runtimeDetection.value
    ? [
        runtimeDetection.value.java,
        runtimeDetection.value.mavenWrapper,
        runtimeDetection.value.maven,
        runtimeDetection.value.mvnd
      ]
    : []
)
const runtimeCompatibilityMatrix = computed(() => runtimeDetection.value?.compatibilityMatrix ?? [])

const buildToolOptions = computed(() => [
  { value: 'auto', label: text.value.settingsAuto },
  { value: 'mvnw', label: text.value.settingsMavenWrapper },
  { value: 'mvn', label: text.value.settingsMaven },
  { value: 'mvnd', label: text.value.settingsMvnd }
])

const closeActionOptions = computed(() => [
  { value: 'hide' satisfies DesktopCloseAction, label: text.value.settingsCloseActionHide },
  { value: 'quit' satisfies DesktopCloseAction, label: text.value.settingsCloseActionQuit }
])
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">{{ text.heroEyebrow }}</p>
        <h1>{{ text.heroTitle }}</h1>
        <p class="lede">
          {{ text.heroDescription }}
        </p>
      </div>

      <div class="hero-actions">
        <div class="language-switch">
          <button
            class="secondary-button"
            type="button"
            :disabled="locale === 'zh-CN'"
            @click="setLocale('zh-CN')"
          >
            {{ text.switchToChinese }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="locale === 'en-US'"
            @click="setLocale('en-US')"
          >
            {{ text.switchToEnglish }}
          </button>
        </div>

        <button
          class="refresh-button"
          type="button"
          @click="initializeApp"
        >
          {{ text.refreshHealth }}
        </button>
      </div>
    </section>

    <section class="panel-grid">
      <article class="panel">
        <h2>{{ text.runtimeTitle }}</h2>
        <dl>
          <div class="row">
            <dt>{{ text.runtimeApp }}</dt>
            <dd>{{ runtimeInfo?.appName ?? APP_NAME }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimeVersion }}</dt>
            <dd>{{ runtimeInfo?.appVersion ?? health?.version ?? text.runtimePending }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimeBackendUrl }}</dt>
            <dd>{{ runtimeInfo?.serverUrl ?? DEFAULT_SERVER_URL }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimeBackendPid }}</dt>
            <dd>{{ runtimeInfo?.backendPid ?? text.runtimePending }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimeMode }}</dt>
            <dd>{{
              runtimeInfo
                ? runtimeInfo.isPackaged
                  ? text.runtimeModePackaged
                  : text.runtimeModeDev
                : text.runtimePending
            }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimePlatform }}</dt>
            <dd>{{ runtimeInfo?.platform ?? text.runtimePending }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimeExePath }}</dt>
            <dd>{{ runtimeInfo?.exePath ?? text.runtimePending }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimeUserDataPath }}</dt>
            <dd>{{ runtimeInfo?.userDataPath ?? text.runtimePending }}</dd>
          </div>
        </dl>
      </article>

      <article class="panel">
        <h2>{{ text.settingsTitle }}</h2>
        <div class="settings-stack">
          <section class="settings-section">
            <div class="settings-section__header">
              <h3>{{ text.settingsGeneralTitle }}</h3>
              <p>{{ text.settingsGeneralDescription }}</p>
            </div>

            <div class="settings-grid">
              <label class="settings-field">
                <span>{{ text.settingsLocale }}</span>
                <select
                  v-model="appSettings.locale"
                  @change="setLocale(appSettings.locale)"
                >
                  <option value="zh-CN">{{ text.switchToChinese }}</option>
                  <option value="en-US">{{ text.switchToEnglish }}</option>
                </select>
              </label>

              <label class="settings-field">
                <span>{{ text.settingsDefaultBuildTool }}</span>
                <select v-model="appSettings.defaultBuildToolPreference">
                  <option
                    v-for="option in buildToolOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="settings-toggle">
                <input
                  v-model="appSettings.defaultSkipTests"
                  type="checkbox"
                />
                <span>{{ text.settingsSkipTests }}</span>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section__header">
              <h3>{{ text.settingsDesktopTitle }}</h3>
              <p>{{ text.settingsDesktopDescription }}</p>
            </div>

            <div class="settings-grid">
              <label class="settings-toggle">
                <input
                  v-model="appSettings.trayEnabled"
                  type="checkbox"
                />
                <span>{{ text.settingsTrayEnabled }}</span>
              </label>

              <label class="settings-field">
                <span>{{ text.settingsCloseAction }}</span>
                <select v-model="appSettings.closeAction">
                  <option
                    v-for="option in closeActionOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <p class="muted">
              {{ text.settingsCloseActionSummary }} {{ getCloseActionLabel(appSettings.closeAction, appSettings.trayEnabled) }}
            </p>
          </section>

          <button
            class="refresh-button"
            type="button"
            @click="saveSettings"
          >
            {{ text.settingsSave }}
          </button>
        </div>

        <p
          v-if="settingsMessage"
          class="muted"
        >
          {{ settingsMessage }}
        </p>

        <div class="recent-projects">
          <div class="project-panel__subheader">
            <h3>{{ text.settingsRecentProjects }}</h3>
          </div>

          <template v-if="recentProjects.length === 0">
            <p class="muted">{{ text.settingsNoRecentProjects }}</p>
          </template>
          <template v-else>
            <button
              v-for="project in recentProjects"
              :key="project.rootPath"
              class="recent-project-button"
              type="button"
              @click="restoreRecentProject(project.rootPath)"
            >
              <strong>{{ project.displayName }}</strong>
              <span>{{ project.rootPath }}</span>
            </button>
          </template>
        </div>
      </article>
    </section>

    <section class="panel-grid">
      <article class="panel">
        <h2>{{ text.healthTitle }}</h2>
        <template v-if="loading">
          <p class="muted">{{ text.healthChecking }}</p>
        </template>
        <template v-else-if="errorMessage">
          <p class="error">{{ errorMessage }}</p>
        </template>
        <template v-else>
          <dl>
            <div class="row">
              <dt>{{ text.healthStatus }}</dt>
              <dd>{{ health?.ok ? text.healthHealthy : text.healthUnknown }}</dd>
            </div>
            <div class="row">
              <dt>{{ text.healthVersion }}</dt>
              <dd>{{ health?.version }}</dd>
            </div>
            <div class="row">
              <dt>{{ text.healthTimestamp }}</dt>
              <dd>{{ health?.timestamp }}</dd>
            </div>
          </dl>
        </template>
      </article>

      <article class="panel">
        <div class="project-panel__subheader">
          <h2>{{ text.preflightTitle }}</h2>
          <button
            class="secondary-button"
            type="button"
            @click="refreshPreflight"
          >
            {{ preflightLoading ? text.preflightChecking : text.preflightRefresh }}
          </button>
        </div>

        <p class="muted">{{ text.preflightDescription }}</p>

        <template v-if="preflightLoading">
          <p class="muted">{{ text.preflightChecking }}</p>
        </template>
        <template v-else-if="preflightReport">
          <div class="scan-meta">
            <div class="pill">
              {{ text.preflightPass }}: {{ preflightReport.summary.passCount }}
            </div>
            <div class="pill ghost">
              {{ text.preflightWarn }}: {{ preflightReport.summary.warnCount }}
            </div>
            <div class="pill ghost">
              {{ text.preflightFail }}: {{ preflightReport.summary.failCount }}
            </div>
          </div>

          <div class="workspace-meta">
            <span>{{ text.preflightGeneratedAt }}</span>
            <strong>{{ preflightReport.generatedAt }}</strong>
          </div>

          <div class="preflight-list">
            <article
              v-for="check in preflightReport.checks"
              :key="check.id"
              class="preflight-item"
            >
              <div class="project-panel__subheader">
                <strong>{{ check.label }}</strong>
                <span
                  class="pill"
                  :class="{
                    ghost: check.status === 'warn',
                    'pill--danger': check.status === 'fail'
                  }"
                >
                  {{ getPreflightStatusLabel(check.status) }}
                </span>
              </div>
              <p>{{ check.detail }}</p>
            </article>
          </div>
        </template>
        <template v-else>
          <p class="muted">{{ text.preflightEmpty }}</p>
        </template>
      </article>
    </section>

    <section class="project-panel release-panel">
      <div class="project-panel__header">
        <div>
          <p class="eyebrow">{{ text.releaseEyebrow }}</p>
          <h2>{{ text.releaseTitle }}</h2>
        </div>

        <button
          class="secondary-button"
          type="button"
          @click="loadReleaseReadiness"
        >
          {{ releaseLoading ? text.releaseChecking : text.releaseRefresh }}
        </button>
      </div>

      <p class="muted">{{ text.releaseDescription }}</p>

      <template v-if="releaseLoading">
        <p class="muted">{{ text.releaseChecking }}</p>
      </template>
      <template v-else-if="releaseReadiness">
        <div class="workspace-meta">
          <span>{{ text.releaseGeneratedAt }}</span>
          <strong>{{ releaseReadiness.generatedAt }}</strong>
        </div>

        <div class="release-grid">
          <article
            v-for="artifact in releaseReadiness.artifacts"
            :key="artifact.id"
            class="release-card"
          >
            <div class="project-panel__subheader">
              <strong>{{ getReleaseArtifactLabel(artifact.id) }}</strong>
              <span
                class="pill"
                :class="{ 'pill--danger': !artifact.available }"
              >
                {{ artifact.available ? text.releaseAvailable : text.releaseMissing }}
              </span>
            </div>
            <p>{{ artifact.path }}</p>
          </article>
        </div>

        <div class="release-guide-grid">
          <article class="release-guide">
            <h3>{{ text.releaseInstallStepsTitle }}</h3>
            <ol>
              <li
                v-for="step in text.releaseInstallSteps"
                :key="step.title"
              >
                <strong>{{ step.title }}</strong>
                <span>{{ step.detail }}</span>
              </li>
            </ol>
          </article>

          <article class="release-guide">
            <h3>{{ text.releaseVerifyStepsTitle }}</h3>
            <ol>
              <li
                v-for="step in text.releaseVerifySteps"
                :key="step.title"
              >
                <strong>{{ step.title }}</strong>
                <span>{{ step.detail }}</span>
              </li>
            </ol>
          </article>
        </div>
      </template>
      <template v-else>
        <p class="muted">{{ text.releaseEmpty }}</p>
      </template>
    </section>

    <section class="project-panel">
      <div class="project-panel__header">
        <div>
          <p class="eyebrow">{{ text.scannerEyebrow }}</p>
          <h2>{{ text.scannerTitle }}</h2>
        </div>

        <div class="actions">
          <button
            class="secondary-button"
            type="button"
            @click="detectRuntime"
          >
            {{ detecting ? text.servicePreparing : text.detectEnvironment }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="serviceGroupActionRunning || scannedServiceCount === 0"
            @click="launchScannedServiceGroup"
          >
            {{ serviceGroupActionRunning ? text.servicePreparing : text.serviceGroupLaunchAll }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="serviceGroupActionRunning || scannedServiceCount === 0"
            @click="saveScannedServiceGroup"
          >
            {{ text.serviceGroupSaveCurrent }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="serviceGroupActionRunning || !lastServiceGroup"
            @click="stopLastServiceGroup"
          >
            {{ text.serviceGroupStopAll }}
          </button>
          <button
            class="secondary-button"
            type="button"
            @click="selectProjectDirectory"
          >
            {{ text.selectProject }}
          </button>
          <button
            class="refresh-button"
            type="button"
            @click="scanProject"
          >
            {{ scanning ? text.scanning : text.scanProject }}
          </button>
        </div>
      </div>

      <div class="project-path">
        <span>{{ text.selectedPath }}</span>
        <strong>{{ selectedProjectPath || text.noProjectSelected }}</strong>
      </div>

      <div class="service-group-panel service-group-panel--compact">
        <label class="settings-field service-group-interval-field">
          <span>{{ text.serviceGroupStartupInterval }}</span>
          <input
            v-model="serviceGroupStartupIntervalSeconds"
            type="number"
            min="0"
            max="600"
          />
        </label>
        <p class="muted">{{ text.serviceGroupStartupIntervalHint }}</p>
      </div>

      <div
        v-if="savedServiceGroups.length > 0 || serviceGroupMessage"
        class="service-group-panel"
      >
        <div class="project-panel__subheader">
          <h3>{{ text.serviceGroupSavedTitle }}</h3>
          <span class="pill ghost">
            {{ text.serviceGroupServiceCount }}: {{ savedServiceGroups.length }}
          </span>
        </div>

        <p
          v-if="serviceGroupMessage"
          class="muted"
        >
          {{ serviceGroupMessage }}
        </p>

        <div
          v-if="savedServiceGroups.length > 0"
          class="service-group-list"
        >
          <article
            v-for="group in savedServiceGroups"
            :key="group.groupId"
            class="service-group-item service-group-item--saved"
          >
            <strong>{{ group.groupName }}</strong>
            <span>
              {{ text.serviceGroupServiceCount }}: {{ group.services.length }} ·
              {{ text.serviceGroupStartupInterval }}: {{ group.startupIntervalMs / 1000 }}s
            </span>
            <div class="actions">
              <button
                class="secondary-button"
                type="button"
                :disabled="serviceGroupActionRunning"
                @click="launchSavedServiceGroup(group)"
              >
                {{ text.serviceGroupLaunchSaved }}
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="serviceGroupActionRunning"
                @click="deleteSavedServiceGroup(group.groupId)"
              >
                {{ text.serviceGroupDeleteSaved }}
              </button>
            </div>
          </article>
        </div>
      </div>

      <div
        v-if="lastServiceGroup"
        class="service-group-panel"
      >
        <div class="project-panel__subheader">
          <h3>{{ text.serviceGroupTitle }}</h3>
          <span
            class="pill"
            :class="{ 'pill--danger': lastServiceGroup.status === 'failed' }"
          >
            {{ getServiceGroupStatusLabel(lastServiceGroup.status) }}
          </span>
        </div>

        <div class="scan-meta">
          <div class="pill ghost">
            {{ text.serviceGroupName }}: {{ lastServiceGroup.groupName }}
          </div>
          <div class="pill ghost">
            {{ text.serviceGroupServiceCount }}: {{ lastServiceGroup.services.length }}
          </div>
          <div class="pill ghost">
            {{ text.serviceGroupUpdatedAt }}: {{ lastServiceGroup.lastUpdatedAt }}
          </div>
        </div>

        <div class="service-group-list">
          <article
            v-for="service in lastServiceGroup.services"
            :key="service.serviceId"
            class="service-group-item"
          >
            <strong>{{ service.artifactId }}</strong>
            <span>{{ service.mainClass }}</span>
            <em>
              {{ getServiceGroupItemStatusLabel(service.status) }}
              {{ service.status === 'failed' && service.message ? ` · ${service.message}` : '' }}
            </em>
          </article>
        </div>
      </div>

      <p
        v-if="scanErrorMessage"
        class="error"
      >
        {{ scanErrorMessage }}
      </p>

      <div
        v-if="runtimeDetection"
        class="scan-result"
      >
        <div class="project-panel__subheader">
          <h3>{{ text.environmentTitle }}</h3>
          <span class="pill">
            {{ text.environmentRecommendedTool }}:
            {{ runtimeDetection.recommendedBuildTool ?? text.environmentUnavailable }}
          </span>
        </div>

        <div class="preflight-list">
          <article
            v-for="tool in runtimeTools"
            :key="tool.kind"
            class="preflight-item"
          >
            <div class="project-panel__subheader">
              <strong>{{ getEnvironmentToolLabel(tool) }}</strong>
              <span
                class="pill ghost"
                :class="{
                  'pill--danger': tool.available && tool.supportLevel === 'unsupported',
                  'pill--warn': tool.available && tool.supportLevel === 'experimental'
                }"
              >
                {{ tool.available ? text.environmentAvailable : text.environmentUnavailable }}
              </span>
            </div>
            <p>{{ text.environmentVersion }}: {{ tool.parsedVersion ?? tool.version ?? text.runtimePending }}</p>
            <p>{{ text.environmentSupport }}: {{ getToolSupportLabel(tool.supportLevel) }}</p>
            <p v-if="tool.linkedMavenMajor !== null">
              {{ text.environmentTargets }}: Maven {{ tool.linkedMavenMajor }}.x
            </p>
            <p>{{ getToolSupportDetail(tool) }}</p>
          </article>
        </div>

        <div
          v-if="runtimeCompatibilityMatrix.length > 0"
          class="service-group-panel service-group-panel--compact"
        >
          <div class="project-panel__subheader">
            <h3>{{ text.compatibilityMatrixTitle }}</h3>
            <span class="pill ghost">
              {{ runtimeCompatibilityMatrix.length }}
            </span>
          </div>

          <div class="preflight-list">
            <article
              v-for="row in runtimeCompatibilityMatrix"
              :key="row.id"
              class="preflight-item"
            >
              <div class="project-panel__subheader">
                <strong>{{ row.label }}</strong>
                <span
                  class="pill ghost"
                  :class="{
                    'pill--warn': row.matchState === 'recommended' || row.supportLevel === 'experimental'
                  }"
                >
                  {{ getCompatibilityMatchStateLabel(row.matchState) }}
                </span>
              </div>
              <p>{{ text.compatibilityMatrixVersionRange }}: {{ row.versionRange }}</p>
              <p>{{ text.compatibilityMatrixTargets }}: {{ row.targetMaven }}</p>
              <p>{{ text.environmentSupport }}: {{ getToolSupportLabel(row.supportLevel) }}</p>
              <p>
                {{ text.compatibilityMatrixDetectedTools }}:
                {{ row.detectedTools.length > 0 ? row.detectedTools.join(' / ') : text.compatibilityMatrixNone }}
              </p>
            </article>
          </div>
        </div>
      </div>

      <p
        v-if="runtimeErrorMessage"
        class="error"
      >
        {{ runtimeErrorMessage }}
      </p>

      <div
        v-if="projectScan"
        class="scan-result"
      >
        <div class="scan-meta">
          <div class="pill">
            {{ text.rootArtifact }}: {{ projectScan.artifactId }}
          </div>
          <div class="pill">
            {{ text.moduleCount }}: {{ projectScan.moduleCount }}
          </div>
          <div class="pill">
            {{ text.packaging }}: {{ projectScan.packaging }}
          </div>
        </div>

        <div class="module-list">
          <article
            v-for="module in projectScan.modules"
            :key="module.modulePath"
            class="module-card"
          >
            <div class="module-card__header">
              <div>
                <h3>{{ module.artifactId }}</h3>
                <p>{{ module.modulePath }}</p>
              </div>
              <span class="pill ghost">
                {{ module.serviceCandidates.length }} {{ text.startupClassCountSuffix }}
              </span>
            </div>

            <ul v-if="module.serviceCandidates.length > 0">
              <li
                v-for="candidate in module.serviceCandidates"
                :key="candidate.javaFilePath"
                class="candidate-item"
              >
                <div class="candidate-topline">
                  <div>
                    <strong>{{ candidate.mainClass }}</strong>
                    <span>{{ candidate.javaFilePath }}</span>
                  </div>

                  <div class="actions">
                    <button
                      class="refresh-button"
                      type="button"
                      :disabled="serviceActionState[getServiceId(module.artifactId, candidate.mainClass)]"
                      @click="launchService(module.modulePath, module.artifactId, candidate)"
                    >
                      {{
                        serviceActionState[getServiceId(module.artifactId, candidate.mainClass)]
                          ? text.servicePreparing
                          : text.serviceLaunch
                      }}
                    </button>
                    <button
                      class="secondary-button"
                      type="button"
                      :disabled="serviceActionState[getServiceId(module.artifactId, candidate.mainClass)]"
                      @click="restartService(getServiceId(module.artifactId, candidate.mainClass))"
                    >
                      {{ text.serviceRestart }}
                    </button>
                    <button
                      class="secondary-button"
                      type="button"
                      :disabled="serviceActionState[getServiceId(module.artifactId, candidate.mainClass)]"
                      @click="stopService(getServiceId(module.artifactId, candidate.mainClass))"
                    >
                      {{ text.serviceStop }}
                    </button>
                  </div>
                </div>

                <div class="candidate-config-grid">
                  <div class="candidate-config-grid__header">
                    <strong>{{ text.serviceConfigTitle }}</strong>
                  </div>

                  <label class="settings-field">
                    <span>{{ text.servicePort }}</span>
                    <input
                      v-model="getLaunchConfig(module.artifactId, candidate).runtimePort"
                      type="number"
                      min="1"
                      max="65535"
                    />
                  </label>

                  <label class="settings-field">
                    <span>{{ text.serviceConfigBuildTool }}</span>
                    <select v-model="getLaunchConfig(module.artifactId, candidate).buildToolPreference">
                      <option
                        v-for="option in buildToolOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>

                  <label class="settings-field">
                    <span>{{ text.serviceConfigMavenThreads }}</span>
                    <input
                      v-model="getLaunchConfig(module.artifactId, candidate).mavenThreads"
                      type="text"
                      :placeholder="text.serviceConfigMavenThreadsPlaceholder"
                    />
                    <small>{{ text.serviceConfigMavenThreadsHint }}</small>
                  </label>

                  <label class="settings-field">
                    <span>{{ text.serviceConfigProfiles }}</span>
                    <input
                      v-model="getLaunchConfig(module.artifactId, candidate).springProfiles"
                      type="text"
                      :placeholder="text.serviceConfigProfilesPlaceholder"
                    />
                  </label>

                  <label class="settings-field">
                    <span>{{ text.serviceConfigHealthPath }}</span>
                    <input
                      v-model="getLaunchConfig(module.artifactId, candidate).healthCheckPath"
                      type="text"
                      :placeholder="text.serviceConfigHealthPathPlaceholder"
                    />
                  </label>

                  <label class="settings-field candidate-config-field--wide">
                    <span>{{ text.serviceConfigDependencies }}</span>
                    <select
                      v-model="getLaunchConfig(module.artifactId, candidate).dependsOnServiceIds"
                      multiple
                    >
                      <option
                        v-for="option in getDependencyOptions(module.artifactId, candidate)"
                        :key="option.serviceId"
                        :value="option.serviceId"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                    <small>{{ text.serviceConfigDependenciesHint }}</small>
                  </label>

                  <label class="settings-toggle">
                    <input
                      v-model="getLaunchConfig(module.artifactId, candidate).skipTests"
                      type="checkbox"
                    />
                    <span>{{ text.settingsSkipTests }}</span>
                  </label>

                  <label class="settings-field candidate-config-field--wide">
                    <span>{{ text.serviceConfigJvmArgs }}</span>
                    <textarea
                      v-model="getLaunchConfig(module.artifactId, candidate).jvmArgs"
                      rows="2"
                      :placeholder="text.serviceConfigJvmArgsPlaceholder"
                    />
                  </label>

                  <label class="settings-field candidate-config-field--wide">
                    <span>{{ text.serviceConfigProgramArgs }}</span>
                    <textarea
                      v-model="getLaunchConfig(module.artifactId, candidate).programArgs"
                      rows="2"
                      :placeholder="text.serviceConfigProgramArgsPlaceholder"
                    />
                  </label>
                </div>

                <div
                  v-if="serviceInstances[getServiceId(module.artifactId, candidate.mainClass)]"
                  class="service-state"
                >
                  <div class="scan-meta">
                    <div class="pill">
                      {{ text.serviceStatus }}:
                      {{
                        getServiceStatusLabel(
                          serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].status
                        )
                      }}
                    </div>
                    <div class="pill ghost">
                      {{ text.servicePort }}:
                      {{
                        formatPort(
                          serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].runtimePort
                        )
                      }}
                    </div>
                    <div class="pill ghost">
                      {{ text.servicePortReachable }}:
                      {{
                        serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].portReachable
                          ? text.openPort
                          : text.closedPort
                      }}
                    </div>
                    <div
                      class="pill ghost"
                      :class="{
                        'pill--danger':
                          serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].healthStatus ===
                          'unhealthy'
                      }"
                    >
                      {{ text.serviceHealth }}:
                      {{
                        getServiceHealthLabel(
                          serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].healthStatus
                        )
                      }}
                    </div>
                    <div class="pill ghost">
                      {{ text.servicePid }}:
                      {{
                        serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].pid ??
                        text.runtimePending
                      }}
                    </div>
                    <div class="pill ghost">
                      {{ text.serviceBuildTool }}:
                      {{
                        serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].buildTool ??
                        text.runtimePending
                      }}
                    </div>
                    <div class="pill ghost">
                      {{ text.serviceCpu }}:
                      {{
                        formatCpu(
                          serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].cpuPercent
                        )
                      }}
                    </div>
                    <div class="pill ghost">
                      {{ text.serviceMemory }}:
                      {{
                        formatMemory(
                          serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].memoryRssBytes
                        )
                      }}
                    </div>
                  </div>

                  <div class="logs-panel">
                    <span>{{ text.serviceLogs }}</span>
                    <pre>{{
                      serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].logLines.join('\n') ||
                      text.serviceNoLogs
                    }}</pre>
                  </div>

                  <p class="muted">
                    {{ text.serviceHealthDetail }}:
                    {{
                      serviceInstances[getServiceId(module.artifactId, candidate.mainClass)].healthDetail ??
                      text.runtimePending
                    }}
                  </p>
                </div>
              </li>
            </ul>

            <p
              v-else
              class="muted"
            >
              {{ text.noStartupClassDetected }}
            </p>
          </article>
        </div>
      </div>
    </section>

    <section class="project-panel">
      <div class="project-panel__subheader">
        <h2>{{ text.logsWorkspaceTitle }}</h2>
      </div>
      <p
        v-if="logWorkspaceMessage"
        class="muted"
      >
        {{ logWorkspaceMessage }}
      </p>

      <template v-if="logWorkspaceServices.length === 0">
        <p class="muted">{{ text.logsWorkspaceEmpty }}</p>
      </template>
      <template v-else>
        <div class="workspace-layout">
          <aside class="workspace-sidebar">
            <button
              v-for="instance in logWorkspaceServices"
              :key="instance.serviceId"
              class="workspace-service-button"
              :class="{ active: selectedLogServiceId === instance.serviceId }"
              type="button"
              @click="selectedLogServiceId = instance.serviceId"
            >
              <strong>{{ instance.artifactId }}</strong>
              <span>{{ getServiceStatusLabel(instance.status) }}</span>
            </button>
          </aside>

          <div class="workspace-main">
            <template v-if="activeLogInstance">
              <div class="scan-meta">
                <div class="pill">
                  {{ text.serviceStatus }}: {{ getServiceStatusLabel(activeLogInstance.status) }}
                </div>
                <div class="pill ghost">
                  {{ text.servicePort }}: {{ formatPort(activeLogInstance.runtimePort) }}
                </div>
                <div class="pill ghost">
                  {{ text.servicePortReachable }}:
                  {{ activeLogInstance.portReachable ? text.openPort : text.closedPort }}
                </div>
                <div
                  class="pill ghost"
                  :class="{ 'pill--danger': activeLogInstance.healthStatus === 'unhealthy' }"
                >
                  {{ text.serviceHealth }}: {{ getServiceHealthLabel(activeLogInstance.healthStatus) }}
                </div>
                <div class="pill ghost">
                  {{ text.serviceCpu }}: {{ formatCpu(activeLogInstance.cpuPercent) }}
                </div>
                <div class="pill ghost">
                  {{ text.serviceMemory }}: {{ formatMemory(activeLogInstance.memoryRssBytes) }}
                </div>
              </div>

              <div class="workspace-meta">
                <span>{{ text.serviceLogFile }}</span>
                <strong>{{ activeLogInstance.logFilePath ?? text.runtimePending }}</strong>
              </div>

              <div class="workspace-meta">
                <span>{{ text.serviceHealthDetail }}</span>
                <strong>{{ activeLogInstance.healthDetail ?? text.runtimePending }}</strong>
              </div>

              <div class="log-toolbar">
                <label class="settings-field log-toolbar__field">
                  <span>{{ text.serviceLogSearch }}</span>
                  <input
                    v-model="liveLogSearchKeyword"
                    type="text"
                    :placeholder="text.serviceLogSearchPlaceholder"
                  />
                </label>

                <label class="settings-field log-toolbar__field">
                  <span>{{ text.serviceLogLevel }}</span>
                  <select v-model="liveLogLevelFilter">
                    <option
                      v-for="option in logLevelOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <div class="log-toolbar__actions">
                  <button
                    class="secondary-button log-toolbar__button"
                    type="button"
                    :disabled="filteredActiveLogLineViews.length === 0"
                    @click="copyLiveLogs"
                  >
                    {{ text.serviceLogCopy }}
                  </button>
                  <button
                    class="secondary-button log-toolbar__button"
                    type="button"
                    :disabled="filteredActiveLogLineViews.length === 0"
                    @click="exportLiveLogs"
                  >
                    {{ text.serviceLogExport }}
                  </button>
                  <button
                    class="secondary-button log-toolbar__button"
                    type="button"
                    @click="toggleLiveLogFollow"
                  >
                    {{ liveLogFollowEnabled ? text.serviceLogPauseScroll : text.serviceLogResumeScroll }}
                  </button>
                </div>
              </div>

              <div class="scan-meta">
                <div class="pill ghost">
                  {{ text.serviceLogVisibleLines }}: {{ filteredActiveLogLineViews.length }} / {{ activeLogInstance.logLines.length }}
                </div>
                <div class="pill ghost">
                  {{ text.serviceLogDiagnosticCount }}: {{ liveDiagnosticLineViews.length }}
                </div>
                <div
                  v-if="!liveLogFollowEnabled"
                  class="pill ghost pill--warn"
                >
                  {{ text.serviceLogPaused }}
                </div>
              </div>

              <div class="log-summary-panel">
                <div class="project-panel__subheader">
                  <h3>{{ text.serviceLogHighlightsTitle }}</h3>
                </div>

                <template v-if="liveDiagnosticLineViews.length === 0">
                  <p class="muted">{{ text.serviceLogDiagnosticEmpty }}</p>
                </template>
                <template v-else>
                  <div class="log-highlight-list">
                    <button
                      v-for="line in liveDiagnosticLineViews"
                      :key="`live-${line.lineNumber}`"
                      class="log-highlight-button"
                      :class="{
                        active: selectedLiveDiagnosticLineNumber === line.lineNumber,
                        'log-highlight-button--error': line.level === 'error',
                        'log-highlight-button--warn': line.level === 'warn'
                      }"
                      type="button"
                      @click="focusLiveDiagnostic(line.lineNumber)"
                    >
                      <strong>{{ text.serviceLogLinePrefix }} {{ line.lineNumber }}</strong>
                      <span>{{ line.text }}</span>
                    </button>
                  </div>
                </template>
              </div>

              <div class="log-summary-panel">
                <div class="project-panel__subheader">
                  <h3>{{ text.serviceLogContextTitle }}</h3>
                  <div class="log-toolbar__actions">
                    <button
                      class="secondary-button log-toolbar__button"
                      type="button"
                      :disabled="!liveDiagnosticContext"
                      @click="copyLiveDiagnosticContext"
                    >
                      {{ text.serviceLogCopyContext }}
                    </button>
                    <button
                      class="secondary-button log-toolbar__button"
                      type="button"
                      :disabled="!liveDiagnosticContext"
                      @click="exportLiveDiagnosticContext"
                    >
                      {{ text.serviceLogExportContext }}
                    </button>
                  </div>
                </div>

                <template v-if="liveDiagnosticContext && selectedLiveDiagnosticLineView">
                  <div class="scan-meta">
                    <div class="pill ghost">
                      {{ text.serviceLogLinePrefix }} {{ selectedLiveDiagnosticLineView.lineNumber }}
                    </div>
                    <div class="pill ghost">
                      {{ text.serviceLogContextRange }}:
                      {{ liveDiagnosticContext.startLineNumber }} - {{ liveDiagnosticContext.endLineNumber }}
                    </div>
                  </div>
                  <p class="muted">{{ selectedLiveDiagnosticLineView.text }}</p>
                  <div class="logs-panel">
                    <span>{{ text.serviceLogContextTitle }}</span>
                    <div class="logs-panel__content">
                      <div
                        v-for="line in liveDiagnosticContext.contextLines"
                        :key="`live-context-${line.lineNumber}`"
                        class="log-line"
                        :class="[
                          `log-line--${line.level}`,
                          {
                            'log-line--diagnostic': line.isDiagnostic,
                            'log-line--selected': selectedLiveDiagnosticLineNumber === line.lineNumber
                          }
                        ]"
                      >
                        <span class="log-line__number">{{ line.lineNumber }}</span>
                        <span class="log-line__text">{{ line.text }}</span>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <p class="muted">{{ text.serviceLogContextEmpty }}</p>
                </template>
              </div>

              <div class="logs-panel logs-panel--workspace">
                <span>{{ text.serviceLogs }}</span>
                <div
                  v-if="filteredActiveLogLineViews.length > 0"
                  ref="liveLogPanelRef"
                  class="logs-panel__content logs-panel__content--workspace"
                >
                  <div
                    v-for="line in filteredActiveLogLineViews"
                    :key="`live-line-${line.lineNumber}`"
                    class="log-line"
                    :class="[
                      `log-line--${line.level}`,
                      {
                        'log-line--diagnostic': line.isDiagnostic,
                        'log-line--selected': selectedLiveDiagnosticLineNumber === line.lineNumber
                      }
                    ]"
                    :data-line-number="line.lineNumber"
                  >
                    <span class="log-line__number">{{ line.lineNumber }}</span>
                    <span class="log-line__text">{{ line.text }}</span>
                  </div>
                </div>
                <p
                  v-else
                  class="muted"
                >
                  {{ activeLogInstance.logLines.length > 0 ? text.serviceNoMatchingLogs : text.serviceNoLogs }}
                </p>
              </div>

              <div class="service-group-panel">
                <div class="project-panel__subheader">
                  <h3>{{ text.serviceLogHistoryTitle }}</h3>
                  <span class="pill ghost">
                    {{ logHistoryEntries.length }}
                  </span>
                </div>

                <template v-if="logHistoryLoading">
                  <p class="muted">{{ text.serviceLogHistoryLoading }}</p>
                </template>
                <template v-else-if="logHistoryEntries.length === 0">
                  <p class="muted">{{ text.serviceLogHistoryEmpty }}</p>
                </template>
                <template v-else>
                  <div class="workspace-layout">
                    <aside class="workspace-sidebar">
                      <button
                        v-for="entry in logHistoryEntries"
                        :key="entry.id"
                        class="workspace-service-button"
                        :class="{ active: selectedLogHistoryId === entry.id }"
                        type="button"
                        @click="selectLogHistoryEntry(activeLogInstance.serviceId, entry.id)"
                      >
                        <strong>{{ entry.fileName }}</strong>
                        <span>{{ entry.createdAt }}</span>
                        <span>{{ formatFileSize(entry.sizeBytes) }}</span>
                      </button>
                    </aside>

                    <div class="workspace-main">
                      <template v-if="activeLogHistory && activeLogHistoryEntry">
                        <div class="workspace-meta">
                          <span>{{ text.serviceLogFile }}</span>
                          <strong>{{ activeLogHistory.entry.filePath }}</strong>
                        </div>

                        <div class="log-toolbar">
                          <label class="settings-field log-toolbar__field">
                            <span>{{ text.serviceLogSearch }}</span>
                            <input
                              v-model="historyLogSearchKeyword"
                              type="text"
                              :placeholder="text.serviceLogSearchPlaceholder"
                            />
                          </label>

                          <label class="settings-field log-toolbar__field">
                            <span>{{ text.serviceLogLevel }}</span>
                            <select v-model="historyLogLevelFilter">
                              <option
                                v-for="option in logLevelOptions"
                                :key="option.value"
                                :value="option.value"
                              >
                                {{ option.label }}
                              </option>
                            </select>
                          </label>

                          <div class="log-toolbar__actions">
                            <button
                              class="secondary-button log-toolbar__button"
                              type="button"
                              :disabled="filteredHistoryLogLineViews.length === 0"
                              @click="copyHistoryLogs"
                            >
                              {{ text.serviceLogCopy }}
                            </button>
                            <button
                              class="secondary-button log-toolbar__button"
                              type="button"
                              :disabled="filteredHistoryLogLineViews.length === 0"
                              @click="exportHistoryLogs"
                            >
                              {{ text.serviceLogExport }}
                            </button>
                          </div>
                        </div>

                        <div class="scan-meta">
                          <div class="pill ghost">
                            {{ text.serviceLogHistoryLines }}: {{ activeLogHistory.totalLines }}
                          </div>
                          <div class="pill ghost">
                            {{ text.serviceLogVisibleLines }}: {{ filteredHistoryLogLineViews.length }} / {{ activeLogHistory.lines.length }}
                          </div>
                          <div class="pill ghost">
                            {{ text.serviceLogDiagnosticCount }}: {{ historyDiagnosticLineViews.length }}
                          </div>
                          <div
                            v-if="activeLogHistory.entry.isActive"
                            class="pill ghost"
                          >
                            {{ text.serviceLogHistoryActive }}
                          </div>
                          <div
                            v-if="activeLogHistory.truncated"
                            class="pill ghost pill--warn"
                          >
                            {{ text.serviceLogHistoryTruncated }}
                          </div>
                        </div>

                        <div class="log-summary-panel">
                          <div class="project-panel__subheader">
                            <h3>{{ text.serviceLogHighlightsTitle }}</h3>
                          </div>

                          <template v-if="historyDiagnosticLineViews.length === 0">
                            <p class="muted">{{ text.serviceLogDiagnosticEmpty }}</p>
                          </template>
                          <template v-else>
                            <div class="log-highlight-list">
                              <button
                                v-for="line in historyDiagnosticLineViews"
                                :key="`history-${line.lineNumber}`"
                                class="log-highlight-button"
                                :class="{
                                  active: selectedHistoryDiagnosticLineNumber === line.lineNumber,
                                  'log-highlight-button--error': line.level === 'error',
                                  'log-highlight-button--warn': line.level === 'warn'
                                }"
                                type="button"
                                @click="focusHistoryDiagnostic(line.lineNumber)"
                              >
                                <strong>{{ text.serviceLogLinePrefix }} {{ line.lineNumber }}</strong>
                                <span>{{ line.text }}</span>
                              </button>
                            </div>
                          </template>
                        </div>

                        <div class="log-summary-panel">
                          <div class="project-panel__subheader">
                            <h3>{{ text.serviceLogContextTitle }}</h3>
                            <div class="log-toolbar__actions">
                              <button
                                class="secondary-button log-toolbar__button"
                                type="button"
                                :disabled="!historyDiagnosticContext"
                                @click="copyHistoryDiagnosticContext"
                              >
                                {{ text.serviceLogCopyContext }}
                              </button>
                              <button
                                class="secondary-button log-toolbar__button"
                                type="button"
                                :disabled="!historyDiagnosticContext"
                                @click="exportHistoryDiagnosticContext"
                              >
                                {{ text.serviceLogExportContext }}
                              </button>
                            </div>
                          </div>

                          <template v-if="historyDiagnosticContext && selectedHistoryDiagnosticLineView">
                            <div class="scan-meta">
                              <div class="pill ghost">
                                {{ text.serviceLogLinePrefix }} {{ selectedHistoryDiagnosticLineView.lineNumber }}
                              </div>
                              <div class="pill ghost">
                                {{ text.serviceLogContextRange }}:
                                {{ historyDiagnosticContext.startLineNumber }} - {{ historyDiagnosticContext.endLineNumber }}
                              </div>
                            </div>
                            <p class="muted">{{ selectedHistoryDiagnosticLineView.text }}</p>
                            <div class="logs-panel">
                              <span>{{ text.serviceLogContextTitle }}</span>
                              <div class="logs-panel__content">
                                <div
                                  v-for="line in historyDiagnosticContext.contextLines"
                                  :key="`history-context-${line.lineNumber}`"
                                  class="log-line"
                                  :class="[
                                    `log-line--${line.level}`,
                                    {
                                      'log-line--diagnostic': line.isDiagnostic,
                                      'log-line--selected': selectedHistoryDiagnosticLineNumber === line.lineNumber
                                    }
                                  ]"
                                >
                                  <span class="log-line__number">{{ line.lineNumber }}</span>
                                  <span class="log-line__text">{{ line.text }}</span>
                                </div>
                              </div>
                            </div>
                          </template>
                          <template v-else>
                            <p class="muted">{{ text.serviceLogContextEmpty }}</p>
                          </template>
                        </div>

                        <div class="logs-panel logs-panel--workspace">
                          <span>{{ text.serviceLogHistoryTitle }}</span>
                          <div
                            v-if="filteredHistoryLogLineViews.length > 0"
                            ref="historyLogPanelRef"
                            class="logs-panel__content logs-panel__content--workspace"
                          >
                            <div
                              v-for="line in filteredHistoryLogLineViews"
                              :key="`history-line-${line.lineNumber}`"
                              class="log-line"
                              :class="[
                                `log-line--${line.level}`,
                                {
                                  'log-line--diagnostic': line.isDiagnostic,
                                  'log-line--selected': selectedHistoryDiagnosticLineNumber === line.lineNumber
                                }
                              ]"
                              :data-line-number="line.lineNumber"
                            >
                              <span class="log-line__number">{{ line.lineNumber }}</span>
                              <span class="log-line__text">{{ line.text }}</span>
                            </div>
                          </div>
                          <p
                            v-else
                            class="muted"
                          >
                            {{ activeLogHistory.lines.length > 0 ? text.serviceNoMatchingLogs : text.serviceNoLogs }}
                          </p>
                        </div>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
            </template>

            <template v-else>
              <p class="muted">{{ text.logsWorkspaceSelectHint }}</p>
            </template>
          </div>
        </div>
      </template>
    </section>
  </main>
</template>
