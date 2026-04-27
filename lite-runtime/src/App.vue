<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import LogConsole from './components/LogConsole.vue'
import ServiceControls from './components/ServiceControls.vue'
import ServiceList from './components/ServiceList.vue'
import {
  detectRuntime,
  launchService,
  listServices,
  onServiceLog,
  onServiceStatus,
  scanProject,
  selectProjectDirectory,
  stopService
} from './lib/tauri'
import type {
  LogEvent,
  ProjectScanResult,
  RuntimeDetectionResult,
  ServiceCandidate,
  ServiceInstance,
  ServiceLaunchRequest
} from './types'

interface LaunchForm {
  runtimePort: string
  skipTests: boolean
  jvmArgs: string
  programArgs: string
  springProfiles: string
}

const projectPath = ref('')
const projectScan = ref<ProjectScanResult | null>(null)
const runtime = ref<RuntimeDetectionResult | null>(null)
const activeServiceId = ref('')
const statusMessage = ref('选择一个 Maven 项目，扫描后直接启动服务。')
const errorMessage = ref('')
const busy = ref(false)
const instanceMap = reactive<Record<string, ServiceInstance>>({})
const logMap = reactive<Record<string, LogEvent[]>>({})
const launchForms = reactive<Record<string, LaunchForm>>({})

let unlistenStatus: (() => void) | null = null
let unlistenLog: (() => void) | null = null

const activeService = computed<ServiceCandidate | null>(() => {
  return projectScan.value?.services.find((service) => service.serviceId === activeServiceId.value) ?? null
})

const activeInstance = computed<ServiceInstance | null>(() => {
  return activeServiceId.value ? instanceMap[activeServiceId.value] ?? null : null
})

const activeLogs = computed<LogEvent[]>(() => {
  return activeServiceId.value ? logMap[activeServiceId.value] ?? [] : []
})

const hasActiveLaunch = computed(() => {
  return Object.values(instanceMap).some((instance) => instance.status === 'building' || instance.status === 'running')
})

const prefersLogFocus = computed(() => {
  if (activeLogs.value.length > 0) {
    return true
  }

  return activeInstance.value !== null
})

const runningServiceCount = computed(() => {
  return Object.values(instanceMap).filter((instance) => instance.status === 'running').length
})

const failedServiceCount = computed(() => {
  return Object.values(instanceMap).filter((instance) => instance.status === 'failed').length
})

const runtimeSummary = computed(() => {
  if (!runtime.value) {
    return '等待扫描后检测 Java 与构建链路'
  }

  const javaLabel = runtime.value.java.version ?? 'missing'
  const buildLabel = runtime.value.buildToolKind ?? 'missing'
  return `Java ${javaLabel} · ${buildLabel}`
})

const overviewExpanded = ref(true)

const activeLaunchForm = computed<LaunchForm>({
  get() {
    if (!activeServiceId.value) {
      return createLaunchForm(null)
    }

    return launchForms[activeServiceId.value] ?? createLaunchForm(activeService.value)
  },
  set(value) {
    if (!activeServiceId.value) {
      return
    }

    launchForms[activeServiceId.value] = value
  }
})

onMounted(async () => {
  const [statusOff, logOff] = await Promise.all([
    onServiceStatus((instance) => {
      instanceMap[instance.serviceId] = instance
    }),
    onServiceLog((entry) => {
      const current = logMap[entry.serviceId] ?? []
      current.push(entry)

      if (current.length > 1200) {
        current.splice(0, current.length - 1200)
      }

      logMap[entry.serviceId] = current
    })
  ])

  unlistenStatus = statusOff
  unlistenLog = logOff

  const instances = await listServices()
  for (const instance of instances) {
    instanceMap[instance.serviceId] = instance
  }
})

onBeforeUnmount(() => {
  unlistenStatus?.()
  unlistenLog?.()
})

watch(activeService, (service) => {
  if (!service) {
    return
  }

  if (!launchForms[service.serviceId]) {
    launchForms[service.serviceId] = createLaunchForm(service)
  }
})

watch(
  hasActiveLaunch,
  (value) => {
    if (value) {
      overviewExpanded.value = false
    }
  },
  { immediate: true }
)

function createLaunchForm(service: ServiceCandidate | null): LaunchForm {
  return {
    runtimePort: service?.defaultPort ? String(service.defaultPort) : '',
    skipTests: true,
    jvmArgs: '',
    programArgs: '',
    springProfiles: ''
  }
}

function clearActiveLogs() {
  if (!activeServiceId.value) {
    return
  }

  logMap[activeServiceId.value] = []
  statusMessage.value = '当前服务的界面日志已清空。'
}

function toggleOverview() {
  overviewExpanded.value = !overviewExpanded.value
}

async function chooseProject() {
  errorMessage.value = ''
  const selected = await selectProjectDirectory()
  if (selected) {
    projectPath.value = selected
  }
}

async function handleScanProject() {
  if (!projectPath.value.trim()) {
    errorMessage.value = '请先选择 Maven 项目目录。'
    return
  }

  busy.value = true
  errorMessage.value = ''
  statusMessage.value = '正在扫描项目并探测运行环境...'

  try {
    const [scanResult, runtimeResult] = await Promise.all([
      scanProject(projectPath.value),
      detectRuntime(projectPath.value)
    ])

    projectScan.value = scanResult
    runtime.value = runtimeResult
    activeServiceId.value = scanResult.services[0]?.serviceId ?? ''

    for (const service of scanResult.services) {
      if (!launchForms[service.serviceId]) {
        launchForms[service.serviceId] = createLaunchForm(service)
      }
    }

    statusMessage.value = `扫描完成：找到 ${scanResult.services.length} 个可启动服务。`
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '扫描失败'
  } finally {
    busy.value = false
  }
}

async function handleLaunch(request: ServiceLaunchRequest) {
  if (!activeService.value) {
    return
  }

  busy.value = true
  errorMessage.value = ''
  statusMessage.value = `正在启动 ${activeService.value.artifactId}...`

  try {
    const instance = await launchService({
      ...request,
      rootPath: projectPath.value
    })
    instanceMap[instance.serviceId] = instance
    statusMessage.value = `${activeService.value.artifactId} 已进入 ${instance.status} 状态。`
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '启动失败'
  } finally {
    busy.value = false
  }
}

async function handleStop(serviceId: string) {
  busy.value = true
  errorMessage.value = ''

  try {
    const instance = await stopService(serviceId)
    instanceMap[instance.serviceId] = instance
    statusMessage.value = `${instance.artifactId} 已停止。`
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '停止失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div class="topbar__intro">
        <h1>MicroLight Lite 控制台</h1>
        <p class="topbar__summary">
          测试版仅供体验，问题与建议请前往
          <a
            class="topbar__link topbar__link--repo"
            href="https://github.com/realhumanforsure/MicroLight-Console"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          提交
          <a
            class="topbar__link topbar__link--issues"
            href="https://github.com/realhumanforsure/MicroLight-Console/issues"
            target="_blank"
            rel="noreferrer"
          >
            Issue
          </a>
        </p>
      </div>
      <div class="topbar__actions">
        <div class="toolbar">
          <input
            v-model="projectPath"
            class="path-input"
            type="text"
            placeholder="选择 Maven 项目目录"
          />
          <button class="secondary-button" type="button" @click="chooseProject">
            选择目录
          </button>
          <button class="primary-button" type="button" :disabled="busy" @click="handleScanProject">
            {{ busy ? '处理中...' : '扫描项目' }}
          </button>
        </div>
        <div class="runtime-banner">
          <span class="runtime-banner__label">Runtime</span>
          <strong>{{ runtimeSummary }}</strong>
        </div>
      </div>
    </header>

    <section v-if="overviewExpanded" class="overview-strip">
      <article class="overview-tile">
        <span class="overview-tile__label">项目</span>
        <strong>{{ projectScan?.artifactId ?? '未选择项目' }}</strong>
        <small>{{ projectPath || '选择一个 Maven 工程后开始扫描' }}</small>
      </article>
      <article class="overview-tile">
        <span class="overview-tile__label">可启动服务</span>
        <strong>{{ projectScan?.services.length ?? 0 }}</strong>
        <small>{{ projectScan?.moduleCount ?? 0 }} 个模块已纳入扫描</small>
      </article>
      <article class="overview-tile">
        <span class="overview-tile__label">运行中</span>
        <strong>{{ runningServiceCount }}</strong>
        <small v-if="failedServiceCount > 0">{{ failedServiceCount }} 个服务最近启动失败</small>
        <small v-else>当前无失败告警</small>
      </article>
      <article class="overview-tile overview-tile--status">
        <span class="overview-tile__label">状态</span>
        <strong>{{ statusMessage }}</strong>
      </article>
    </section>

    <section class="status-strip">
      <span class="status-strip__label">Workspace</span>
      <span class="status-strip__text">{{ statusMessage }}</span>
      <button
        v-if="projectScan"
        class="secondary-button secondary-button--compact"
        type="button"
        @click="toggleOverview"
      >
        {{ overviewExpanded ? '收起项目' : '展开项目' }}
      </button>
      <span v-if="runtime" class="status-strip__meta muted">
        Java {{ runtime.java.available ? 'ready' : 'missing' }} ·
        Build {{ runtime.buildToolKind ?? 'missing' }}
      </span>
    </section>

    <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

    <section class="workspace">
      <ServiceList
        :services="projectScan?.services ?? []"
        :instances="instanceMap"
        :active-service-id="activeServiceId"
        @select="activeServiceId = $event"
      />

      <section class="workspace-main">
        <ServiceControls
          v-model="activeLaunchForm"
          :root-path="projectPath"
          :service="activeService"
          :instance="activeInstance"
          :runtime="runtime"
          :busy="busy"
          :prefer-collapsed="prefersLogFocus"
          @launch="handleLaunch"
          @stop="handleStop"
        />

        <LogConsole
          :service="activeService"
          :logs="activeLogs"
          @clear="clearActiveLogs"
        />
      </section>
    </section>
  </main>
</template>
