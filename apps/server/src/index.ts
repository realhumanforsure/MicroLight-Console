import cors from '@fastify/cors'
import Fastify from 'fastify'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_NAME,
  APP_VERSION,
  type AppSettingsUpdateRequest,
  type AppStateResponse,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  type HealthResponse,
  type PortDiagnosisRequest,
  type PortDiagnosisResponse,
  type ProjectPreflightRequest,
  type ProjectPreferenceUpdateRequest,
  type ProjectScanRequest,
  type ReleaseReadinessResponse,
  type RuntimeDetectionRequest,
  type SavedServiceGroupsResponse,
  type ServiceGroupDeleteRequest,
  type ServiceGroupLaunchRequest,
  type ServiceGroupSaveRequest,
  type ServiceGroupStopRequest,
  type ServiceGroupsResponse,
  type ServiceLogContentResponse,
  type ServiceLogHistoryResponse,
  type ServiceInstancesResponse,
  type ServiceLaunchRequest,
  type ServiceRestartRequest,
  type ServiceStopRequest
} from '@microlight/shared'
import { persistenceService } from './persistence.js'
import { diagnosePort } from './port-diagnostics.js'
import { generateProjectPreflightReport } from './preflight.js'
import { scanProject } from './project-scanner.js'
import { getReleaseReadiness } from './release-readiness.js'
import { detectRuntimeTools } from './runtime-tools.js'
import { serviceGroupRuntimeManager } from './service-group-runtime.js'
import { serviceRuntimeManager } from './service-runtime.js'

export async function createServer() {
  const app = Fastify({
    logger:
      process.env.MICROLIGHT_SERVER_LOGGER === 'silent'
        ? false
        : {
            transport:
              process.env.NODE_ENV === 'production'
                ? undefined
                : {
                    target: 'pino-pretty',
                    options: {
                      colorize: true,
                      translateTime: 'HH:MM:ss'
                    }
                  }
          }
  })

  await app.register(cors, {
    origin: true
  })

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      ok: true,
      appName: APP_NAME,
      version: APP_VERSION,
      timestamp: new Date().toISOString()
    }
  })

  app.get('/api/app-state', async (): Promise<AppStateResponse> => {
    return {
      settings: persistenceService.getAppSettings(),
      recentProjects: persistenceService.getRecentProjects()
    }
  })

  app.get('/api/release/readiness', async (): Promise<ReleaseReadinessResponse> => {
    return getReleaseReadiness()
  })

  app.put<{ Body: AppSettingsUpdateRequest }>('/api/settings', async (request, reply) => {
    try {
      return persistenceService.updateAppSettings(request.body)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to update settings'
      }
    }
  })

  app.post<{ Body: ProjectScanRequest }>('/api/projects/scan', async (request, reply) => {
    try {
      persistenceService.recordRecentProject(request.body.rootPath)
      return await scanProject(request.body.rootPath)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to scan project'
      }
    }
  })

  app.put<{ Body: ProjectPreferenceUpdateRequest }>(
    '/api/projects/preferences',
    async (request, reply) => {
      try {
        return persistenceService.saveProjectPreference(request.body)
      } catch (error) {
        request.log.error(error)
        reply.code(400)
        return {
          message: error instanceof Error ? error.message : 'Failed to update project preferences'
        }
      }
    }
  )

  app.post<{ Body: ProjectPreflightRequest }>('/api/projects/preflight', async (request, reply) => {
    try {
      return await generateProjectPreflightReport(request.body.rootPath)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to run project preflight'
      }
    }
  })

  app.post<{ Body: RuntimeDetectionRequest }>('/api/runtime/detect', async (request, reply) => {
    try {
      return await detectRuntimeTools(request.body.rootPath)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to detect runtime tools'
      }
    }
  })

  app.post<{ Body: PortDiagnosisRequest }>(
    '/api/runtime/ports/diagnose',
    async (request, reply): Promise<PortDiagnosisResponse | { message: string }> => {
      try {
        return await diagnosePort(request.body.port)
      } catch (error) {
        request.log.error(error)
        reply.code(400)
        return {
          message: error instanceof Error ? error.message : 'Failed to diagnose port'
        }
      }
    }
  )

  app.get('/api/services/instances', async (): Promise<ServiceInstancesResponse> => {
    return {
      instances: serviceRuntimeManager.getInstances()
    }
  })

  app.get<{ Params: { serviceId: string } }>(
    '/api/services/:serviceId/logs/history',
    async (request, reply): Promise<ServiceLogHistoryResponse | { message: string }> => {
      try {
        return {
          serviceId: request.params.serviceId,
          entries: await serviceRuntimeManager.getLogHistory(request.params.serviceId)
        }
      } catch (error) {
        request.log.error(error)
        reply.code(400)
        return {
          message: error instanceof Error ? error.message : 'Failed to load log history'
        }
      }
    }
  )

  app.get<{ Params: { serviceId: string; entryId: string } }>(
    '/api/services/:serviceId/logs/history/:entryId',
    async (request, reply): Promise<ServiceLogContentResponse | { message: string }> => {
      try {
        return await serviceRuntimeManager.readLogHistory(request.params.serviceId, request.params.entryId)
      } catch (error) {
        request.log.error(error)
        reply.code(400)
        return {
          message: error instanceof Error ? error.message : 'Failed to load log content'
        }
      }
    }
  )

  app.get('/api/service-groups', async (): Promise<ServiceGroupsResponse> => {
    return {
      groups: serviceGroupRuntimeManager.getGroups()
    }
  })

  app.get<{ Querystring: { rootPath?: string } }>(
    '/api/service-groups/saved',
    async (request): Promise<SavedServiceGroupsResponse> => {
      return {
        groups: request.query.rootPath
          ? persistenceService.getSavedServiceGroups(request.query.rootPath)
          : []
      }
    }
  )

  app.post<{ Body: ServiceGroupSaveRequest }>('/api/service-groups/saved', async (request, reply) => {
    try {
      return persistenceService.saveServiceGroup(request.body)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to save service group'
      }
    }
  })

  app.post<{ Body: ServiceGroupDeleteRequest }>('/api/service-groups/saved/delete', async (request, reply) => {
    try {
      persistenceService.deleteServiceGroup(request.body.groupId)
      return {
        ok: true
      }
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to delete service group'
      }
    }
  })

  app.post<{ Body: ServiceGroupLaunchRequest }>('/api/service-groups/launch', async (request, reply) => {
    try {
      for (const service of request.body.services) {
        persistenceService.saveServicePreference({
          serviceId: `${service.artifactId}:${service.mainClass}`,
          rootPath: service.rootPath,
          modulePath: service.modulePath,
          artifactId: service.artifactId,
          mainClass: service.mainClass,
          buildToolPreference: service.buildToolPreference,
          skipTests: service.skipTests,
          jvmArgs: service.jvmArgs,
          programArgs: service.programArgs,
          springProfiles: service.springProfiles,
          healthCheckPath: service.healthCheckPath,
          mavenThreads: service.mavenThreads
        })
      }

      return await serviceGroupRuntimeManager.launchGroup(request.body)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to launch service group'
      }
    }
  })

  app.post<{ Body: ServiceGroupStopRequest }>('/api/service-groups/stop', async (request, reply) => {
    try {
      return await serviceGroupRuntimeManager.stopGroup(request.body.groupId)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to stop service group'
      }
    }
  })

  app.post<{ Body: ServiceLaunchRequest }>('/api/services/launch', async (request, reply) => {
    try {
      persistenceService.saveServicePreference({
        serviceId: `${request.body.artifactId}:${request.body.mainClass}`,
        rootPath: request.body.rootPath,
        modulePath: request.body.modulePath,
        artifactId: request.body.artifactId,
        mainClass: request.body.mainClass,
        buildToolPreference: request.body.buildToolPreference,
        skipTests: request.body.skipTests,
        jvmArgs: request.body.jvmArgs,
        programArgs: request.body.programArgs,
        springProfiles: request.body.springProfiles,
        healthCheckPath: request.body.healthCheckPath,
        mavenThreads: request.body.mavenThreads
      })
      return await serviceRuntimeManager.launchService(request.body)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to launch service'
      }
    }
  })

  app.post<{ Body: ServiceStopRequest }>('/api/services/stop', async (request, reply) => {
    try {
      return await serviceRuntimeManager.stopService(request.body.serviceId)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to stop service'
      }
    }
  })

  app.post<{ Body: ServiceRestartRequest }>('/api/services/restart', async (request, reply) => {
    try {
      return await serviceRuntimeManager.restartService(request.body.serviceId)
    } catch (error) {
      request.log.error(error)
      reply.code(400)
      return {
        message: error instanceof Error ? error.message : 'Failed to restart service'
      }
    }
  })

  app.get<{ Params: { serviceId: string } }>('/api/services/:serviceId/logs/stream', async (request, reply) => {
    reply.hijack()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    })

    const sendSnapshot = (state: ReturnType<typeof serviceRuntimeManager.getInstance> extends infer T
      ? T extends null
        ? never
        : T
      : never) => {
      reply.raw.write(`data: ${JSON.stringify({ type: 'snapshot', instance: state })}\n\n`)
    }

    const currentState = serviceRuntimeManager.getInstance(request.params.serviceId)

    if (currentState) {
      sendSnapshot(currentState)
    }

    const unsubscribe = serviceRuntimeManager.subscribe(request.params.serviceId, sendSnapshot)
    const heartbeat = setInterval(() => {
      reply.raw.write(':keepalive\n\n')
    }, 15000)

    reply.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  return app
}

export async function startServer() {
  const app = await createServer()
  const host = process.env.MICROLIGHT_SERVER_HOST ?? DEFAULT_SERVER_HOST
  const port = Number(process.env.MICROLIGHT_SERVER_PORT ?? DEFAULT_SERVER_PORT)

  try {
    await app.listen({ host, port })
    app.log.info(`MicroLight server listening on http://${host}:${port}`)
    return app
  } catch (error) {
    app.log.error(error)
    throw error
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isEntrypoint) {
  const app = await startServer()

  const shutdown = async () => {
    await app.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
