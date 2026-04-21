export const APP_NAME = 'MicroLight Console'
export const APP_VERSION = '0.1.0'
export const DEFAULT_SERVER_HOST = '127.0.0.1'
export const DEFAULT_SERVER_PORT = 3210
export const DEFAULT_SERVER_URL = `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`
export const DEFAULT_BUILD_TOOL_PREFERENCE: BuildToolPreference = 'auto'
export const DEFAULT_SKIP_TESTS = true
export const DEFAULT_JVM_ARGS = ''
export const DEFAULT_PROGRAM_ARGS = ''
export const DEFAULT_SPRING_PROFILES = ''

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
  savedBuildToolPreference: BuildToolPreference
  savedSkipTests: boolean
  savedJvmArgs: string
  savedProgramArgs: string
  savedSpringProfiles: string
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
  jvmArgs: string
  programArgs: string
  springProfiles: string
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

export interface AppSettings {
  locale: 'zh-CN' | 'en-US'
  defaultBuildToolPreference: BuildToolPreference
  defaultSkipTests: boolean
  lastProjectPath: string | null
}

export interface RecentProject {
  rootPath: string
  displayName: string
  lastOpenedAt: string
}

export interface AppStateResponse {
  settings: AppSettings
  recentProjects: RecentProject[]
}

export interface AppSettingsUpdateRequest {
  locale: 'zh-CN' | 'en-US'
  defaultBuildToolPreference: BuildToolPreference
  defaultSkipTests: boolean
  lastProjectPath: string | null
}

export interface ServicePreference {
  serviceId: string
  rootPath: string
  modulePath: string
  artifactId: string
  mainClass: string
  buildToolPreference: BuildToolPreference
  skipTests: boolean
  jvmArgs: string
  programArgs: string
  springProfiles: string
  updatedAt: string
}
