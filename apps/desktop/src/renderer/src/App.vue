<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import {
  APP_NAME,
  DEFAULT_SERVER_URL,
  type HealthResponse,
  type ProjectScanRequest,
  type ProjectScanResult
} from '@microlight/shared'
import { DEFAULT_LOCALE, messages, type Locale } from './locales'

const runtimeInfo = ref<RuntimeInfo | null>(null)
const health = ref<HealthResponse | null>(null)
const selectedProjectPath = ref('')
const projectScan = ref<ProjectScanResult | null>(null)
const locale = ref<Locale>(DEFAULT_LOCALE)
const loading = ref(true)
const scanning = ref(false)
const errorMessage = ref('')
const scanErrorMessage = ref('')
const text = computed(() => messages[locale.value])

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
  } catch (error) {
    scanErrorMessage.value = error instanceof Error ? error.message : 'Unknown scan error'
    projectScan.value = null
  } finally {
    scanning.value = false
  }
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
              >
                <strong>{{ candidate.mainClass }}</strong>
                <span>{{ candidate.javaFilePath }}</span>
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
