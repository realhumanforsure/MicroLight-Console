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
  type ProjectScanRequest,
  type RuntimeDetectionRequest,
  type ServiceInstancesResponse,
  type ServiceLaunchRequest,
  type ServiceRestartRequest,
  type ServiceStopRequest
} from '@microlight/shared'
import { persistenceService } from './persistence.js'
import { scanProject } from './project-scanner.js'
import { detectRuntimeTools } from './runtime-tools.js'
import { serviceRuntimeManager } from './service-runtime.js'

export async function createServer() {
  const app = Fastify({
    logger: {
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

  app.get('/api/services/instances', async (): Promise<ServiceInstancesResponse> => {
    return {
      instances: serviceRuntimeManager.getInstances()
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
        skipTests: request.body.skipTests
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
