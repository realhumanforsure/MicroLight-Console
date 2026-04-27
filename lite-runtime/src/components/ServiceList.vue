<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ServiceCandidate, ServiceInstance } from '../types'

const props = defineProps<{
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

function getStatusTone(serviceId: string, instances: Record<string, ServiceInstance>) {
  return getStatusLabel(serviceId, instances)
}

const searchQuery = ref('')
const filteredServices = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()

  if (!keyword) {
    return props.services
  }

  return props.services.filter((service) => {
    const className = service.mainClass.split('.').pop() ?? service.artifactId
    return [className, service.artifactId, service.mainClass].some((value) => value.toLowerCase().includes(keyword))
  })
})

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

    <div v-else class="sidebar__body">
      <label class="field field--search">
        <span class="sr-only">搜索服务</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索服务名、artifactId、主类"
        />
      </label>

      <div class="service-list-meta">
        <span>{{ filteredServices.length }} / {{ services.length }}</span>
        <span>Active {{ activeServiceId ? '1' : '0' }}</span>
      </div>

      <div v-if="filteredServices.length === 0" class="empty-state">
        当前筛选条件下没有匹配服务
      </div>

      <div v-else class="service-list">
        <button
          v-for="service in filteredServices"
          :key="service.serviceId"
          class="service-item"
          :class="[
            { active: service.serviceId === activeServiceId },
            `service-item--${getStatusTone(service.serviceId, instances)}`
          ]"
          type="button"
          @click="emit('select', service.serviceId)"
        >
          <div class="service-item__row">
            <div class="service-item__title">
              <span class="service-state-dot" :data-status="getStatusLabel(service.serviceId, instances)"></span>
              <strong>{{ getDisplayName(service, instances) }}</strong>
            </div>
            <span class="status-badge" :data-status="getStatusLabel(service.serviceId, instances)">
              {{ getStatusLabel(service.serviceId, instances) }}
            </span>
          </div>
          <span class="service-item__class">{{ service.artifactId }}</span>
          <span class="service-item__meta">{{ service.mainClass }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>
