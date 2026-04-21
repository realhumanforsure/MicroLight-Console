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
  defaultPort: number | null
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

export type BuildToolKind = 'mvnw' | 'mvn' | 'mvnd'
export type BuildToolPreference = 'auto' | BuildToolKind
export type ServiceStatus = 'idle' | 'building' | 'running' | 'stopped' | 'failed'

export interface ToolAvailability {
  kind: 'java' | BuildToolKind
  available: boolean
  command: string
  version: string | null
  detail: string | null
}

export interface RuntimeDetectionRequest {
  rootPath: string
}

export interface RuntimeDetectionResult {
  rootPath: string
  java: ToolAvailability
  mavenWrapper: ToolAvailability
  maven: ToolAvailability
  mvnd: ToolAvailability
  recommendedBuildTool: BuildToolKind | null
}

export interface ServiceLaunchRequest {
  rootPath: string
  modulePath: string
  artifactId: string
  mainClass: string
  runtimePort: number | null
  buildToolPreference: BuildToolPreference
  skipTests: boolean
}

export interface ServiceStopRequest {
  serviceId: string
}

export interface ServiceRestartRequest {
  serviceId: string
}

export interface ServiceInstanceState {
  serviceId: string
  artifactId: string
  mainClass: string
  modulePath: string
  status: ServiceStatus
  pid: number | null
  buildTool: BuildToolKind | null
  jarPath: string | null
  startedAt: string | null
  lastUpdatedAt: string
  lastExitCode: number | null
  runtimePort: number | null
  portReachable: boolean
  cpuPercent: number | null
  memoryRssBytes: number | null
  logFilePath: string | null
  logLines: string[]
}

export interface ServiceInstancesResponse {
  instances: ServiceInstanceState[]
}

export interface ServiceStreamEvent {
  type: 'snapshot'
  instance: ServiceInstanceState
}
