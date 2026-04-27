import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  LogEvent,
  ProjectScanResult,
  RuntimeDetectionResult,
  ServiceInstance,
  ServiceLaunchRequest
} from '../types'

export function selectProjectDirectory() {
  return invoke<string | null>('select_project_directory')
}

export function scanProject(rootPath: string) {
  return invoke<ProjectScanResult>('scan_project', { rootPath })
}

export function detectRuntime(rootPath: string) {
  return invoke<RuntimeDetectionResult>('detect_runtime', { rootPath })
}

export function listServices() {
  return invoke<ServiceInstance[]>('list_services')
}

export function launchService(request: ServiceLaunchRequest) {
  return invoke<ServiceInstance>('launch_service', { request })
}

export function stopService(serviceId: string) {
  return invoke<ServiceInstance>('stop_service', { serviceId })
}

export function onServiceStatus(handler: (instance: ServiceInstance) => void): Promise<UnlistenFn> {
  return listen<ServiceInstance>('service-status', (event) => {
    handler(event.payload)
  })
}

export function onServiceLog(handler: (payload: LogEvent) => void): Promise<UnlistenFn> {
  return listen<LogEvent>('service-log', (event) => {
    handler(event.payload)
  })
}
