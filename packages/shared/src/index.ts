export const APP_NAME = 'MicroLight Console'
export const APP_VERSION = '0.1.0'
export const DEFAULT_SERVER_HOST = '127.0.0.1'
export const DEFAULT_SERVER_PORT = 3210
export const DEFAULT_SERVER_URL = `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`

export interface HealthResponse {
  ok: boolean
  appName: string
  version: string
  timestamp: string
}

export interface ProjectScanRequest {
  rootPath: string
}

export interface ServiceCandidate {
  className: string
  packageName: string
  mainClass: string
  javaFilePath: string
  modulePath: string
}

export interface ScannedModule {
  moduleName: string
  modulePath: string
  artifactId: string
  packaging: string
  bootVersion: string | null
  serviceCandidates: ServiceCandidate[]
}

export interface ProjectScanResult {
  rootPath: string
  artifactId: string
  packaging: string
  moduleCount: number
  modules: ScannedModule[]
}
