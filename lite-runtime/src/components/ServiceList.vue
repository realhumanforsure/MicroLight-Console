<script setup lang="ts">
import type { ServiceCandidate, ServiceInstance } from '../types'

defineProps<{
  services: ServiceCandidate[]
  instances: Record<string, ServiceInstance>
  activeServiceId: string
}>()

const emit = defineEmits<{
  select: [serviceId: string]
}>()

function getStatusLabel(serviceId: string, instances: Record<string, ServiceInstance>) {
  return instances[serviceId]?.status ?? 'idle'
}

function getDisplayName(service: ServiceCandidate, instances: Record<string, ServiceInstance>) {
  const className = service.mainClass.split('.').pop() ?? service.artifactId
  const instance = instances[service.serviceId]

  if (instance?.status === 'running' && instance.runtimePort) {
    return `${className}:${instance.runtimePort}`
  }

  return className
}
</script>

<template>
  <aside class="panel sidebar">
    <div class="panel__header">
      <h2>服务</h2>
      <span class="pill">{{ services.length }}</span>
    </div>

    <div v-if="services.length === 0" class="empty-state">
      还没有扫描到可启动服务
    </div>

    <div v-else class="service-list">
      <button
        v-for="service in services"
        :key="service.serviceId"
        class="service-item"
        :class="{ active: service.serviceId === activeServiceId }"
        type="button"
        @click="emit('select', service.serviceId)"
      >
        <div class="service-item__row">
          <strong>{{ getDisplayName(service, instances) }}</strong>
          <span class="status-badge" :data-status="getStatusLabel(service.serviceId, instances)">
            {{ getStatusLabel(service.serviceId, instances) }}
          </span>
        </div>
      </button>
    </div>
  </aside>
</template>
