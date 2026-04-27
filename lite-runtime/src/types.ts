export interface RuntimeToolStatus {
  available: boolean
  command: string
  version: string | null
}

export interface RuntimeDetectionResult {
  java: RuntimeToolStatus
  buildTool: RuntimeToolStatus
  buildToolKind: 'mvnw' | 'mvnd' | 'mvn' | null
}

export interface ServiceCandidate {
  serviceId: string
  artifactId: string
  mainClass: string
  modulePath: string
  javaFilePath: string
  defaultPort: number | null
}

export interface ProjectScanResult {
  rootPath: string
  artifactId: string
  moduleCount: number
  services: ServiceCandidate[]
}

export type ServiceStatus = 'idle' | 'building' | 'running' | 'stopped' | 'failed'

export interface ServiceInstance {
  serviceId: string
  artifactId: string
  mainClass: string
  modulePath: string
  status: ServiceStatus
  pid: number | null
  runtimePort: number | null
  buildTool: 'mvnw' | 'mvnd' | 'mvn' | null
  startedAt: string | null
  lastUpdatedAt: string
  lastError: string | null
}

export interface ServiceLaunchRequest {
  rootPath: string
  modulePath: string
  artifactId: string
  mainClass: string
  runtimePort: number | null
  skipTests: boolean
  jvmArgs: string
  programArgs: string
  springProfiles: string
}

export interface LogEvent {
  serviceId: string
  source: 'stdout' | 'stderr' | 'system'
  timestamp: string
  line: string
}
