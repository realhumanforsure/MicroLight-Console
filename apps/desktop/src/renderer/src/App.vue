<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import {
  APP_NAME,
  DEFAULT_SERVER_URL,
  type HealthResponse,
  type ProjectScanRequest,
  type ProjectScanResult,
  type RuntimeDetectionRequest,
  type RuntimeDetectionResult,
  type ServiceInstanceState,
  type ServiceLaunchRequest,
  type ServiceStreamEvent
} from '@microlight/shared'
import { DEFAULT_LOCALE, messages, type Locale } from './locales'

const runtimeInfo = ref<RuntimeInfo | null>(null)
const health = ref<HealthResponse | null>(null)
const selectedProjectPath = ref('')
const projectScan = ref<ProjectScanResult | null>(null)
const runtimeDetection = ref<RuntimeDetectionResult | null>(null)
const serviceInstances = ref<Record<string, ServiceInstanceState>>({})
const locale = ref<Locale>(DEFAULT_LOCALE)
const loading = ref(true)
const scanning = ref(false)
const detecting = ref(false)
const errorMessage = ref('')
const scanErrorMessage = ref('')
const runtimeErrorMessage = ref('')
const serviceActionState = ref<Record<string, boolean>>({})
const text = computed(() => messages[locale.value])
let refreshTimer: number | null = null
const logStreams = new Map<string, EventSource>()

async function loadHealth() {
  loading.value = true
  errorMessage.value = ''

  try {
    runtimeInfo.value = await window.microlight.getRuntimeInfo()
    const response = await fetch(`${runtimeInfo.value.serverUrl}/api/health`)

    if (!response.ok) {
      throw new Error(`Health request failed with ${response.status}`)
    }

    health.value = (await response.json()) as HealthResponse
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unknown error'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadHealth()
})

watchEffect(() => {
  document.title = text.value.appTitle
})

function setLocale(nextLocale: Locale) {
  locale.value = nextLocale
}

async function selectProjectDirectory() {
  const selectedPath = await window.microlight.selectProjectDirectory()

  if (selectedPath) {
    selectedProjectPath.value = selectedPath
  }
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

async function launchService(
  modulePath: string,
  artifactId: string,
  mainClass: string
) {
  const serviceId = getServiceId(artifactId, mainClass)
  serviceActionState.value[serviceId] = true

  try {
    const requestBody: ServiceLaunchRequest = {
      rootPath: selectedProjectPath.value,
      modulePath,
      artifactId,
      mainClass,
      buildToolPreference: 'auto',
      skipTests: true
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

onMounted(() => {
  refreshTimer = window.setInterval(() => {
    void refreshInstances()
  }, 3000)
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
          @click="loadHealth"
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
            <dt>{{ text.runtimeBackendUrl }}</dt>
            <dd>{{ runtimeInfo?.serverUrl ?? DEFAULT_SERVER_URL }}</dd>
          </div>
          <div class="row">
            <dt>{{ text.runtimeBackendPid }}</dt>
            <dd>{{ runtimeInfo?.backendPid ?? text.runtimePending }}</dd>
          </div>
        </dl>
      </article>

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
                      @click="launchService(module.modulePath, module.artifactId, candidate.mainClass)"
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
  </main>
</template>
