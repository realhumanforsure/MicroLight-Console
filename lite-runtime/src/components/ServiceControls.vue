<script setup lang="ts">
import { computed } from 'vue'
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
  service: ServiceCandidate | null
  instance: ServiceInstance | null
  runtime: RuntimeDetectionResult | null
  busy: boolean
  modelValue: LaunchForm
}>()

const emit = defineEmits<{
  'update:modelValue': [value: LaunchForm]
  launch: [request: ServiceLaunchRequest]
  stop: [serviceId: string]
}>()

const canLaunch = computed(() => {
  if (!props.service || !props.runtime?.java.available || !props.runtime.buildToolKind) {
    return false
  }

  return props.instance?.status !== 'building'
})
const canStop = computed(() => props.instance?.status === 'building' || props.instance?.status === 'running')
const effectivePort = computed(() => props.modelValue.runtimePort.trim() || `${props.service?.defaultPort ?? ''}`)
const launchButtonLabel = computed(() => {
  if (props.instance?.status === 'building') {
    return '启动中...'
  }

  if (props.instance?.status === 'running') {
    return '重新启动'
  }

  return '启动服务'
})

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

  const trimmedPort = props.modelValue.runtimePort.trim()

  emit('launch', {
    rootPath: '',
    modulePath: props.service.modulePath,
    artifactId: props.service.artifactId,
    mainClass: props.service.mainClass,
    runtimePort: trimmedPort.length > 0 ? Number(trimmedPort) : props.service.defaultPort,
    skipTests: props.modelValue.skipTests,
    jvmArgs: props.modelValue.jvmArgs,
    programArgs: props.modelValue.programArgs,
    springProfiles: props.modelValue.springProfiles
  })
}
</script>

<template>
  <section class="panel panel--compact">
    <div class="panel__header">
      <h2>启动</h2>
      <span v-if="service" class="pill">{{ service.artifactId }}</span>
    </div>

    <div v-if="!service" class="empty-state">
      先从左侧选择一个服务
    </div>

    <template v-else>
      <div class="service-summary service-summary--compact">
        <div>
          <span class="meta-label">端口</span>
          <strong>{{ effectivePort || service.defaultPort || '-' }}</strong>
        </div>
        <div>
          <span class="meta-label">Profiles</span>
          <strong>{{ modelValue.springProfiles.trim() || '-' }}</strong>
        </div>
        <div>
          <span class="meta-label">状态</span>
          <strong>{{ instance?.status ?? 'idle' }}</strong>
        </div>
        <div>
          <span class="meta-label">PID</span>
          <strong>{{ instance?.pid ?? '-' }}</strong>
        </div>
      </div>

      <div class="launch-bar">
        <label class="field">
          <span>端口</span>
          <input
            :value="modelValue.runtimePort"
            type="text"
            :placeholder="service.defaultPort ? `默认 ${service.defaultPort}` : '默认端口'"
            @input="updateField('runtimePort', ($event.target as HTMLInputElement).value)"
          />
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
      </div>

      <details class="advanced-options">
        <summary>高级参数</summary>

        <div class="service-summary">
          <div>
            <span class="meta-label">类</span>
            <strong>{{ service.mainClass.split('.').pop() }}</strong>
          </div>
          <div>
            <span class="meta-label">构建器</span>
            <strong>{{ runtime?.buildToolKind ?? '未检测' }}</strong>
          </div>
          <div>
            <span class="meta-label">Java</span>
            <strong>{{ runtime?.java.available ? 'ready' : 'missing' }}</strong>
          </div>
          <div>
            <span class="meta-label">模块</span>
            <strong>{{ service.artifactId }}</strong>
          </div>
        </div>

        <div class="form-grid form-grid--advanced">
          <label class="field field--full">
            <span>JVM 参数</span>
            <input
              :value="modelValue.jvmArgs"
              type="text"
              placeholder="-Xms256m -Xmx512m"
              @input="updateField('jvmArgs', ($event.target as HTMLInputElement).value)"
            />
          </label>

          <label class="field field--full">
            <span>程序参数</span>
            <input
              :value="modelValue.programArgs"
              type="text"
              placeholder="--feature.toggle=true"
              @input="updateField('programArgs', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <label class="checkbox-row">
          <input
            :checked="modelValue.skipTests"
            type="checkbox"
            @change="updateField('skipTests', ($event.target as HTMLInputElement).checked)"
          />
          <span>构建时跳过测试</span>
        </label>
      </details>
    </template>
  </section>
</template>
