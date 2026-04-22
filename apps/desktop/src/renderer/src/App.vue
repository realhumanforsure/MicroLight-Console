<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import {
  APP_NAME,
  DEFAULT_BUILD_TOOL_PREFERENCE,
  DEFAULT_CLOSE_ACTION,
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
  type ServiceCandidate,
  type ServiceInstanceState,
  type ServiceLaunchRequest,
  type ServiceStreamEvent
} from '@microlight/shared'
import { DEFAULT_LOCALE, messages, type Locale } from './locales'

interface ServiceLaunchConfig {
  runtimePort: string
  buildToolPreference: BuildToolPreference
  skipTests: boolean
  jvmArgs: string
  programArgs: string
  springProfiles: string
}

const runtimeInfo = ref<DesktopRuntimeInfo | null>(null)
const health = ref<HealthResponse | null>(null)
const preflightReport = ref<ProjectPreflightReport | null>(null)
const releaseReadiness = ref<ReleaseReadinessResponse | null>(null)
const selectedProjectPath = ref('')
const projectScan = ref<ProjectScanResult | null>(null)
const runtimeDetection = ref<RuntimeDetectionResult | null>(null)
const serviceInstances = ref<Record<string, ServiceInstanceState>>({})
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
const loading = ref(true)
const preflightLoading = ref(false)
const releaseLoading = ref(false)
const scanning = ref(false)
const detecting = ref(false)
const errorMessage = ref('')
const scanErrorMessage = ref('')
const runtimeErrorMessage = ref('')
const settingsMessage = ref('')
const serviceActionState = ref<Record<string, boolean>>({})
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
    springProfiles: candidate.savedSpringProfiles
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

function normalizeProfiles(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(',')
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

function formatCpu(cpuPercent: number | null) {
  return cpuPercent === null ? text.value.runtimePending : `${cpuPercent.toFixed(1)}%`
}

function formatMemory(memoryRssBytes: number | null) {
  return memoryRssBytes === null ? text.value.runtimePending : `${(memoryRssBytes / 1024 / 1024).toFixed(1)} MB`
}

function formatPort(port: number | null) {
  return port === null ? text.value.runtimePending : String(port)
}

async function launchService(modulePath: string, artifactId: string, candidate: ServiceCandidate) {
  const serviceId = getServiceId(artifactId, candidate.mainClass)
  serviceActionState.value[serviceId] = true
  runtimeErrorMessage.value = ''

  try {
    const launchConfig = getLaunchConfig(artifactId, candidate)
    const requestBody: ServiceLaunchRequest = {
      rootPath: selectedProjectPath.value,
      modulePath,
      artifactId,
      mainClass: candidate.mainClass,
      runtimePort: normalizeRuntimePort(launchConfig.runtimePort),
      buildToolPreference: launchConfig.buildToolPreference,
      skipTests: launchConfig.skipTests,
      jvmArgs: launchConfig.jvmArgs.trim(),
      programArgs: launchConfig.programArgs.trim(),
      springProfiles: normalizeProfiles(launchConfig.springProfiles)
    }

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
  } catch (error) {
    runtimeErrorMessage.value = error instanceof Error ? error.message : 'Unknown launch error'
  } finally {
    serviceActionState.value[serviceId] = false
    await refreshInstances()
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

const logWorkspaceServices = computed(() =>
  Object.values(serviceInstances.value).sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId, 'zh-CN')
  )
)

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

        <div class="scan-meta">
          <div class="pill ghost">
            {{ text.environmentJava }}:
            {{ runtimeDetection.java.available ? text.environmentAvailable : text.environmentUnavailable }}
          </div>
          <div class="pill ghost">
            {{ text.environmentMavenWrapper }}:
            {{ runtimeDetection.mavenWrapper.available ? text.environmentAvailable : text.environmentUnavailable }}
          </div>
          <div class="pill ghost">
            {{ text.environmentMaven }}:
            {{ runtimeDetection.maven.available ? text.environmentAvailable : text.environmentUnavailable }}
          </div>
          <div class="pill ghost">
            {{ text.environmentMvnd }}:
            {{ runtimeDetection.mvnd.available ? text.environmentAvailable : text.environmentUnavailable }}
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
                    <span>{{ text.serviceConfigProfiles }}</span>
                    <input
                      v-model="getLaunchConfig(module.artifactId, candidate).springProfiles"
                      type="text"
                      :placeholder="text.serviceConfigProfilesPlaceholder"
                    />
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

              <div class="logs-panel logs-panel--workspace">
                <span>{{ text.serviceLogs }}</span>
                <pre>{{ activeLogInstance.logLines.join('\n') || text.serviceNoLogs }}</pre>
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
