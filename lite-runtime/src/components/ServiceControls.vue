<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  RuntimeDetectionResult,
  ServiceCandidate,
  ServiceInstance,
  ServiceLaunchRequest
} from '../types'

interface LaunchForm {
  runtimePort: string
  skipTests: boolean
  jvmArgs: string
  programArgs: string
  springProfiles: string
}

const props = defineProps<{
  rootPath: string
  service: ServiceCandidate | null
  instance: ServiceInstance | null
  runtime: RuntimeDetectionResult | null
  busy: boolean
  preferCollapsed: boolean
  modelValue: LaunchForm
}>()

const emit = defineEmits<{
  'update:modelValue': [value: LaunchForm]
  launch: [request: ServiceLaunchRequest]
  stop: [serviceId: string]
}>()

const portError = ref('')
const collapsed = ref(true)

const canLaunch = computed(() => {
  if (!props.service || !props.runtime?.java.available || !props.runtime.buildToolKind) {
    return false
  }

  return props.instance?.status !== 'building'
})
const canStop = computed(() => props.instance?.status === 'building' || props.instance?.status === 'running')
const effectivePort = computed(() => props.modelValue.runtimePort.trim() || `${props.service?.defaultPort ?? ''}`)
const effectiveBuildTool = computed(() => props.runtime?.buildToolKind ?? 'mvn')
const buildCommandPreview = computed(() => {
  if (!props.service || !props.rootPath.trim()) {
    return ''
  }

  const command = props.runtime?.buildTool.command ?? props.runtime?.buildToolKind ?? 'mvn'
  const args = ['-pl', getRelativeModulePath(props.rootPath, props.service.modulePath), '-am']

  if (props.modelValue.skipTests) {
    args.push('-DskipTests')
  }

  args.push('package')
  return `${command} ${args.join(' ')}`
})

const runCommandPreview = computed(() => {
  if (!props.service) {
    return ''
  }

  const args = []
  const trimmedJvmArgs = props.modelValue.jvmArgs.trim()
  const trimmedProgramArgs = props.modelValue.programArgs.trim()
  const port = normalizePortValue(props.modelValue.runtimePort, props.service.defaultPort)

  if (trimmedJvmArgs.length > 0) {
    args.push(trimmedJvmArgs)
  }

  args.push('-jar target/<artifact>.jar')

  if (trimmedProgramArgs.length > 0) {
    args.push(trimmedProgramArgs)
  }

  if (port !== null) {
    args.push(`--server.port=${port}`)
  }

  if (props.modelValue.springProfiles.trim().length > 0) {
    args.push(`--spring.profiles.active=${normalizeProfiles(props.modelValue.springProfiles)}`)
  }

  return `java ${args.join(' ')}`
})

const launchButtonLabel = computed(() => {
  if (props.instance?.status === 'building') {
    return '启动中...'
  }

  if (props.instance?.status === 'running') {
    return '重新启动'
  }

  return '启动服务'
})

const collapseButtonLabel = computed(() => (collapsed.value ? '展开配置' : '收起配置'))

watch(
  () => props.modelValue.runtimePort,
  () => {
    portError.value = ''
  }
)

watch(
  () => [props.service?.serviceId ?? '', props.preferCollapsed] as const,
  ([serviceId, preferCollapsed], previousValue) => {
    const previousServiceId = previousValue?.[0] ?? ''

    if (serviceId !== previousServiceId) {
      collapsed.value = true
      return
    }

    if (preferCollapsed) {
      collapsed.value = true
    }
  },
  { immediate: true }
)

function updateField<K extends keyof LaunchForm>(key: K, value: LaunchForm[K]) {
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: value
  })
}

function submitLaunch() {
  if (!props.service) {
    return
  }

  const parsedPort = normalizePortValue(props.modelValue.runtimePort, props.service.defaultPort)

  if (props.modelValue.runtimePort.trim().length > 0 && parsedPort === null) {
    portError.value = '端口必须是 1 到 65535 之间的整数。'
    return
  }

  emit('launch', {
    rootPath: '',
    modulePath: props.service.modulePath,
    artifactId: props.service.artifactId,
    mainClass: props.service.mainClass,
    runtimePort: parsedPort,
    skipTests: props.modelValue.skipTests,
    jvmArgs: props.modelValue.jvmArgs,
    programArgs: props.modelValue.programArgs,
    springProfiles: normalizeProfiles(props.modelValue.springProfiles)
  })
}

function normalizeProfiles(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(',')
}

function normalizePortValue(value: string, defaultPort: number | null) {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return defaultPort
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null
  }

  return parsed
}

function getRelativeModulePath(rootPath: string, modulePath: string) {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  const normalizedModule = modulePath.replace(/\\/g, '/')
  const relative = normalizedModule.startsWith(normalizedRoot)
    ? normalizedModule.slice(normalizedRoot.length).replace(/^\//, '')
    : normalizedModule

  return relative.length > 0 ? relative : '.'
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <section class="panel panel--compact control-panel" :class="{ 'control-panel--collapsed': collapsed }">
    <div v-if="!service || !collapsed" class="panel__header">
      <h2>启动配置</h2>
      <div class="panel__header-actions">
        <button
          v-if="service"
          class="secondary-button secondary-button--compact"
          type="button"
          @click="toggleCollapsed"
        >
          {{ collapseButtonLabel }}
        </button>
        <span v-if="service" class="pill">{{ service.artifactId }}</span>
      </div>
    </div>

    <div v-if="!service" class="empty-state">
      先从左侧选择一个服务
    </div>

    <template v-else-if="collapsed">
      <div class="control-strip control-strip--single-row">
        <div class="control-strip__service">
          <strong>{{ service.mainClass.split('.').pop() }}</strong>
          <small>{{ service.artifactId }}</small>
        </div>
        <div class="actions actions--inline control-strip__actions">
          <button
            class="secondary-button"
            type="button"
            @click="toggleCollapsed"
          >
            展开配置
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="!canLaunch || busy"
            @click="submitLaunch"
          >
            {{ launchButtonLabel }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="!canStop || busy || !instance"
            @click="instance && emit('stop', instance.serviceId)"
          >
            停止服务
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="service-summary service-summary--compact service-summary--hero">
        <div class="service-summary__item">
          <span class="meta-label">服务</span>
          <strong>{{ service.mainClass.split('.').pop() }}</strong>
          <small>{{ service.artifactId }}</small>
        </div>
        <div class="service-summary__item">
          <span class="meta-label">端口</span>
          <strong>{{ effectivePort || service.defaultPort || '-' }}</strong>
          <small>{{ instance?.runtimePort ? '运行中端口已同步' : '可在启动前覆盖默认值' }}</small>
        </div>
        <div class="service-summary__item">
          <span class="meta-label">Profiles</span>
          <strong>{{ modelValue.springProfiles.trim() || '-' }}</strong>
          <small>{{ modelValue.springProfiles.trim() ? '会拼接为 spring.profiles.active' : '未设置激活环境' }}</small>
        </div>
        <div class="service-summary__item">
          <span class="meta-label">状态</span>
          <strong>{{ instance?.status ?? 'idle' }}</strong>
          <small>{{ instance?.lastError ?? `构建器 ${effectiveBuildTool}` }}</small>
        </div>
        <div class="service-summary__item">
          <span class="meta-label">PID</span>
          <strong>{{ instance?.pid ?? '-' }}</strong>
          <small>{{ runtime?.java.available ? runtime.java.version ?? 'java ready' : '未检测到 Java' }}</small>
        </div>
      </div>

      <div v-if="!collapsed" class="quick-grid">
        <label class="field">
          <span>端口</span>
          <input
            :value="modelValue.runtimePort"
            type="number"
            :placeholder="service.defaultPort ? `默认 ${service.defaultPort}` : '默认端口'"
            @input="updateField('runtimePort', ($event.target as HTMLInputElement).value)"
          />
          <small v-if="portError" class="field-error">{{ portError }}</small>
        </label>

        <label class="field">
          <span>Profiles</span>
          <input
            :value="modelValue.springProfiles"
            type="text"
            placeholder="local,dev"
            @input="updateField('springProfiles', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label class="field">
          <span>JVM 参数</span>
          <input
            :value="modelValue.jvmArgs"
            type="text"
            placeholder="-Xms256m -Xmx512m"
            @input="updateField('jvmArgs', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label class="field">
          <span>程序参数</span>
          <input
            :value="modelValue.programArgs"
            type="text"
            placeholder="--feature.toggle=true"
            @input="updateField('programArgs', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>

      <div v-if="!collapsed" class="command-preview">
        <div class="command-preview__header">
          <strong>执行预览</strong>
          <label class="checkbox-row checkbox-row--quiet">
            <input
              :checked="modelValue.skipTests"
              type="checkbox"
              @change="updateField('skipTests', ($event.target as HTMLInputElement).checked)"
            />
            <span>构建时跳过测试</span>
          </label>
        </div>
        <div class="command-preview__body">
          <div class="command-line">
            <span class="command-line__label">build</span>
            <code>{{ buildCommandPreview || '等待选择项目与服务' }}</code>
          </div>
          <div class="command-line">
            <span class="command-line__label">run</span>
            <code>{{ runCommandPreview || '等待生成运行命令' }}</code>
          </div>
        </div>
      </div>

      <div class="actions actions--inline">
        <button
          class="primary-button"
          type="button"
          :disabled="!canLaunch || busy"
          @click="submitLaunch"
        >
          {{ launchButtonLabel }}
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!canStop || busy || !instance"
          @click="instance && emit('stop', instance.serviceId)"
        >
          停止服务
        </button>
      </div>

      <details v-if="!collapsed" class="advanced-options">
        <summary>高级信息</summary>

        <div class="service-summary">
          <div class="service-summary__item">
            <span class="meta-label">类</span>
            <strong>{{ service.mainClass.split('.').pop() }}</strong>
          </div>
          <div class="service-summary__item">
            <span class="meta-label">构建器</span>
            <strong>{{ runtime?.buildToolKind ?? '未检测' }}</strong>
          </div>
          <div class="service-summary__item">
            <span class="meta-label">Java</span>
            <strong>{{ runtime?.java.available ? 'ready' : 'missing' }}</strong>
          </div>
          <div class="service-summary__item">
            <span class="meta-label">模块</span>
            <strong>{{ service.artifactId }}</strong>
          </div>
        </div>
        <div class="advanced-meta">
          <div>
            <span class="meta-label">模块路径</span>
            <code>{{ service.modulePath }}</code>
          </div>
          <div>
            <span class="meta-label">Java 文件</span>
            <code>{{ service.javaFilePath }}</code>
          </div>
        </div>
      </details>
    </template>
  </section>
</template>
