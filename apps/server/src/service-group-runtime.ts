import type {
  ServiceGroupInstance,
  ServiceGroupItemState,
  ServiceGroupStatus,
  ServiceGroupLaunchRequest
} from '@microlight/shared'
import { createServiceId, serviceRuntimeManager } from './service-runtime.js'

class ServiceGroupRuntimeManager {
  private readonly groups = new Map<string, ServiceGroupInstance>()

  getGroups() {
    return Array.from(this.groups.values())
  }

  async launchGroup(request: ServiceGroupLaunchRequest) {
    if (request.services.length === 0) {
      throw new Error('Service group requires at least one service.')
    }

    const now = new Date().toISOString()
    const group: ServiceGroupInstance = {
      groupId: `group-${Date.now()}`,
      groupName: request.groupName.trim() || 'Service Group',
      status: 'running',
      stopOnFailure: request.stopOnFailure,
      startupIntervalMs: normalizeStartupInterval(request.startupIntervalMs),
      startedAt: now,
      completedAt: null,
      lastUpdatedAt: now,
      durationMs: null,
      services: request.services.map(createGroupItem)
    }

    this.groups.set(group.groupId, group)

    const orderedServices = resolveServiceGroupLaunchOrder(request.services)

    for (const [index, serviceRequest] of orderedServices.entries()) {
      const serviceId = createServiceId(serviceRequest.artifactId, serviceRequest.mainClass)
      const item = findGroupItem(group, serviceId)
      item.orderIndex = index + 1
      const failedDependency = item.dependsOnServiceIds
        .map((dependencyServiceId) => findGroupItem(group, dependencyServiceId))
        .find((dependency) => dependency.status !== 'completed')

      if (failedDependency) {
        item.status = 'failed'
        item.message = `Dependency ${failedDependency.serviceId} did not start successfully`
        item.blockedByServiceId = failedDependency.serviceId
        markItemFinished(item)
        touchGroup(group)

        if (request.stopOnFailure) {
          finishGroup(group, 'failed')
          return group
        }

        continue
      }

      item.status = 'running'
      item.message = 'Starting service'
      markItemStarted(item)
      touchGroup(group)

      try {
        const instance = await serviceRuntimeManager.launchService(serviceRequest)
        item.status = 'completed'
        item.message = 'Service started'
        item.instance = instance
        markItemFinished(item)
        touchGroup(group)

        if (index < orderedServices.length - 1) {
          await delay(group.startupIntervalMs)
        }
      } catch (error) {
        item.status = 'failed'
        item.message = error instanceof Error ? error.message : 'Service launch failed'
        markItemFinished(item)
        touchGroup(group)

        if (request.stopOnFailure) {
          finishGroup(group, 'failed')
          return group
        }
      }
    }

    finishGroup(group, group.services.some((service) => service.status === 'failed') ? 'failed' : 'completed')
    return group
  }

  async stopGroup(groupId: string) {
    const group = this.groups.get(groupId)

    if (!group) {
      throw new Error(`Service group ${groupId} was not found.`)
    }

    group.status = 'stopping'
    touchGroup(group)

    for (const item of group.services) {
      if (item.status !== 'running' && item.status !== 'completed') {
        continue
      }

      try {
        const instance = await serviceRuntimeManager.stopService(item.serviceId)
        item.status = 'stopped'
        item.message = 'Service stopped'
        item.instance = instance
        markItemStopped(item)
      } catch (error) {
        item.status = 'failed'
        item.message = error instanceof Error ? error.message : 'Service stop failed'
        markItemStopped(item)
      }

      touchGroup(group)
    }

    finishGroup(group, group.services.some((service) => service.status === 'failed') ? 'failed' : 'stopped')
    return group
  }
}

function createGroupItem(
  serviceRequest: ServiceGroupLaunchRequest['services'][number]
): ServiceGroupItemState {
  return {
    serviceId: createServiceId(serviceRequest.artifactId, serviceRequest.mainClass),
    artifactId: serviceRequest.artifactId,
    mainClass: serviceRequest.mainClass,
    dependsOnServiceIds: serviceRequest.dependsOnServiceIds ?? [],
    orderIndex: 0,
    status: 'pending',
    message: null,
    instance: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    blockedByServiceId: null
  }
}

function findGroupItem(group: ServiceGroupInstance, serviceId: string) {
  const item = group.services.find((service) => service.serviceId === serviceId)

  if (!item) {
    throw new Error(`Service ${serviceId} was not found in group ${group.groupId}.`)
  }

  return item
}

export function resolveServiceGroupLaunchOrder(services: ServiceGroupLaunchRequest['services']) {
  const serviceIds = services.map((service) => createServiceId(service.artifactId, service.mainClass))
  const serviceIdSet = new Set(serviceIds)
  const serviceById = new Map(
    services.map((service) => [createServiceId(service.artifactId, service.mainClass), service])
  )
  const pending = new Set(serviceIds)
  const orderedServices: ServiceGroupLaunchRequest['services'] = []

  for (const service of services) {
    const serviceId = createServiceId(service.artifactId, service.mainClass)
    const unknownDependency = (service.dependsOnServiceIds ?? []).find((dependencyId) => !serviceIdSet.has(dependencyId))

    if (unknownDependency) {
      throw new Error(`Service ${serviceId} depends on unknown service ${unknownDependency}.`)
    }
  }

  while (pending.size > 0) {
    const readyServiceId = serviceIds.find((serviceId) => {
      if (!pending.has(serviceId)) {
        return false
      }

      const service = serviceById.get(serviceId)
      return service ? (service.dependsOnServiceIds ?? []).every((dependencyId) => !pending.has(dependencyId)) : false
    })

    if (!readyServiceId) {
      throw new Error('Service group dependency graph contains a cycle.')
    }

    const readyService = serviceById.get(readyServiceId)

    if (!readyService) {
      throw new Error(`Service ${readyServiceId} was not found.`)
    }

    pending.delete(readyServiceId)
    orderedServices.push(readyService)
  }

  return orderedServices
}

function touchGroup(group: ServiceGroupInstance) {
  group.lastUpdatedAt = new Date().toISOString()
}

function markItemStarted(item: ServiceGroupItemState) {
  const now = new Date().toISOString()

  item.startedAt = now
  item.completedAt = null
  item.durationMs = null
  item.blockedByServiceId = null
}

function markItemFinished(item: ServiceGroupItemState) {
  const now = new Date().toISOString()

  item.completedAt = now
  item.durationMs = item.startedAt ? Math.max(0, Date.parse(now) - Date.parse(item.startedAt)) : 0
}

function markItemStopped(item: ServiceGroupItemState) {
  item.completedAt = new Date().toISOString()
}

function finishGroup(group: ServiceGroupInstance, status: ServiceGroupStatus) {
  const now = new Date().toISOString()

  group.status = status
  group.completedAt = now
  group.durationMs = Math.max(0, Date.parse(now) - Date.parse(group.startedAt))
  touchGroup(group)
}

function normalizeStartupInterval(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.min(Math.trunc(value), 600000)
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const serviceGroupRuntimeManager = new ServiceGroupRuntimeManager()
