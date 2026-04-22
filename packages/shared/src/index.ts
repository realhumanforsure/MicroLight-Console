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
export const DEFAULT_TRAY_ENABLED = true
export const DEFAULT_CLOSE_ACTION: DesktopCloseAction = 'hide'

export interface HealthResponse {
  ok: boolean
  appName: string
  version: string
  timestamp: string
}

export interface DesktopRuntimeInfo {
  appName: string
  appVersion: string
  backendPid: number | null
  serverUrl: string
  isPackaged: boolean
  platform: NodeJS.Platform
  exePath: string
  userDataPath: string
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
  savedLastSelectedServiceId: string | null
}

export type BuildToolKind = 'mvnw' | 'mvn' | 'mvnd'
export type BuildToolPreference = 'auto' | BuildToolKind
export type ServiceStatus = 'idle' | 'building' | 'running' | 'stopped' | 'failed'
export type ServiceHealthStatus = 'unknown' | 'healthy' | 'unhealthy'
export type DesktopCloseAction = 'quit' | 'hide'

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

export interface ProjectPreflightRequest {
  rootPath: string | null
}

export type PreflightCheckStatus = 'pass' | 'warn' | 'fail'

export interface PreflightCheck {
  id: string
  label: string
  status: PreflightCheckStatus
  detail: string
}

export interface PreflightSummary {
  passCount: number
  warnCount: number
  failCount: number
}

export interface ProjectPreflightReport {
  generatedAt: string
  rootPath: string | null
  summary: PreflightSummary
  checks: PreflightCheck[]
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
  healthStatus: ServiceHealthStatus
  healthUrl: string | null
  healthDetail: string | null
  lastHealthCheckAt: string | null
  cpuPercent: number | null
  memoryRssBytes: number | null
  logFilePath: string | null
  logLines: string[]
}

export interface ServiceInstancesResponse {
  instances: ServiceInstanceState[]
}

export type ServiceGroupStatus = 'running' | 'completed' | 'failed' | 'stopping' | 'stopped'
export type ServiceGroupItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped'

export interface ServiceGroupLaunchRequest {
  groupName: string
  services: ServiceLaunchRequest[]
  stopOnFailure: boolean
}

export interface ServiceGroupSaveRequest {
  groupName: string
  rootPath: string
  services: ServiceLaunchRequest[]
  stopOnFailure: boolean
}

export interface ServiceGroupDeleteRequest {
  groupId: string
}

export interface ServiceGroupStopRequest {
  groupId: string
}

export interface ServiceGroupItemState {
  serviceId: string
  artifactId: string
  mainClass: string
  status: ServiceGroupItemStatus
  message: string | null
  instance: ServiceInstanceState | null
}

export interface ServiceGroupInstance {
  groupId: string
  groupName: string
  status: ServiceGroupStatus
  stopOnFailure: boolean
  startedAt: string
  completedAt: string | null
  lastUpdatedAt: string
  services: ServiceGroupItemState[]
}

export interface SavedServiceGroupService extends ServiceLaunchRequest {
  serviceId: string
  orderIndex: number
}

export interface SavedServiceGroup {
  groupId: string
  groupName: string
  rootPath: string
  stopOnFailure: boolean
  createdAt: string
  updatedAt: string
  services: SavedServiceGroupService[]
}

export interface ServiceGroupsResponse {
  groups: ServiceGroupInstance[]
}

export interface SavedServiceGroupsResponse {
  groups: SavedServiceGroup[]
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
  trayEnabled: boolean
  closeAction: DesktopCloseAction
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
  trayEnabled: boolean
  closeAction: DesktopCloseAction
}

export interface ReleaseArtifactCheck {
  id: string
  label: string
  path: string
  available: boolean
  detail: string
}

export interface ReleaseGuideStep {
  id: string
  title: string
  detail: string
}

export interface ReleaseReadinessResponse {
  generatedAt: string
  platform: NodeJS.Platform
  installerPath: string
  unpackedExePath: string
  artifacts: ReleaseArtifactCheck[]
  installationSteps: ReleaseGuideStep[]
  verificationSteps: ReleaseGuideStep[]
}

export interface ProjectPreference {
  rootPath: string
  lastSelectedServiceId: string | null
  updatedAt: string
}

export interface ProjectPreferenceUpdateRequest {
  rootPath: string
  lastSelectedServiceId: string | null
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
