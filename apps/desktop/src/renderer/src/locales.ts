export type Locale = 'zh-CN' | 'en-US'

interface LocaleMessages {
  appTitle: string
  heroEyebrow: string
  heroTitle: string
  heroDescription: string
  switchToChinese: string
  switchToEnglish: string
  refreshHealth: string
  runtimeTitle: string
  runtimeApp: string
  runtimeBackendUrl: string
  runtimeBackendPid: string
  runtimePending: string
  settingsTitle: string
  settingsLocale: string
  settingsDefaultBuildTool: string
  settingsSkipTests: string
  settingsRecentProjects: string
  settingsSave: string
  settingsSaved: string
  settingsRestoreLastProject: string
  settingsAuto: string
  settingsMavenWrapper: string
  settingsMaven: string
  settingsMvnd: string
  settingsNoRecentProjects: string
  healthTitle: string
  healthChecking: string
  healthHealthy: string
  healthUnknown: string
  healthStatus: string
  healthVersion: string
  healthTimestamp: string
  scannerEyebrow: string
  scannerTitle: string
  selectProject: string
  scanProject: string
  scanning: string
  selectedPath: string
  noProjectSelected: string
  rootArtifact: string
  moduleCount: string
  packaging: string
  environmentTitle: string
  detectEnvironment: string
  environmentRecommendedTool: string
  environmentUnavailable: string
  environmentAvailable: string
  environmentJava: string
  environmentMavenWrapper: string
  environmentMaven: string
  environmentMvnd: string
  serviceLaunch: string
  serviceRestart: string
  serviceStop: string
  serviceConfigTitle: string
  serviceConfigBuildTool: string
  serviceConfigProfiles: string
  serviceConfigProfilesPlaceholder: string
  serviceConfigJvmArgs: string
  serviceConfigJvmArgsPlaceholder: string
  serviceConfigProgramArgs: string
  serviceConfigProgramArgsPlaceholder: string
  serviceConfigPortInvalid: string
  serviceStatus: string
  servicePort: string
  servicePortReachable: string
  servicePid: string
  serviceBuildTool: string
  serviceCpu: string
  serviceMemory: string
  serviceLogFile: string
  serviceLogs: string
  serviceIdle: string
  serviceBuilding: string
  serviceRunning: string
  serviceStopped: string
  serviceFailed: string
  serviceNoLogs: string
  servicePreparing: string
  logsWorkspaceTitle: string
  logsWorkspaceEmpty: string
  logsWorkspaceSelectHint: string
  openPort: string
  closedPort: string
  runtimeDetectFirst: string
  startupClassCountSuffix: string
  noStartupClassDetected: string
  selectProjectFirst: string
  scanFailedPrefix: string
}

export const DEFAULT_LOCALE: Locale = 'zh-CN'

export const messages: Record<Locale, LocaleMessages> = {
  'zh-CN': {
    appTitle: 'MicroLight Console',
    heroEyebrow: '桌面运行控制台',
    heroTitle: 'MicroLight Console',
    heroDescription:
      '面向本地 Spring Boot 微服务的轻量控制台。当前版本已经打通 Electron、Vue 和 Fastify 的基础链路，并具备第一版 Maven 项目扫描能力。',
    switchToChinese: '中文',
    switchToEnglish: 'English',
    refreshHealth: '刷新健康检查',
    runtimeTitle: '运行时信息',
    runtimeApp: '应用名称',
    runtimeBackendUrl: '后端地址',
    runtimeBackendPid: '后端进程 PID',
    runtimePending: '等待中',
    settingsTitle: '设置',
    settingsLocale: '界面语言',
    settingsDefaultBuildTool: '默认构建器',
    settingsSkipTests: '默认跳过测试',
    settingsRecentProjects: '最近项目',
    settingsSave: '保存设置',
    settingsSaved: '设置已保存',
    settingsRestoreLastProject: '恢复上次项目',
    settingsAuto: '自动',
    settingsMavenWrapper: 'Maven Wrapper',
    settingsMaven: 'System Maven',
    settingsMvnd: 'mvnd',
    settingsNoRecentProjects: '还没有最近项目记录。',
    healthTitle: '健康检查',
    healthChecking: '正在检查后端健康状态...',
    healthHealthy: '健康',
    healthUnknown: '未知',
    healthStatus: '状态',
    healthVersion: '版本',
    healthTimestamp: '时间戳',
    scannerEyebrow: '第二阶段',
    scannerTitle: '项目扫描器',
    selectProject: '选择项目',
    scanProject: '扫描 Maven 项目',
    scanning: '扫描中...',
    selectedPath: '当前路径',
    noProjectSelected: '尚未选择项目目录',
    rootArtifact: '根制品',
    moduleCount: '模块数',
    packaging: '打包方式',
    environmentTitle: '运行环境',
    detectEnvironment: '检测环境',
    environmentRecommendedTool: '推荐构建器',
    environmentUnavailable: '不可用',
    environmentAvailable: '可用',
    environmentJava: 'Java',
    environmentMavenWrapper: 'Maven Wrapper',
    environmentMaven: 'System Maven',
    environmentMvnd: 'mvnd',
    serviceLaunch: '构建并启动',
    serviceRestart: '重启服务',
    serviceStop: '停止服务',
    serviceConfigTitle: '启动配置',
    serviceConfigBuildTool: '本次构建器',
    serviceConfigProfiles: 'Spring Profiles',
    serviceConfigProfilesPlaceholder: '例如：dev,local',
    serviceConfigJvmArgs: 'JVM 参数',
    serviceConfigJvmArgsPlaceholder: '例如：-Xms256m -Xmx512m',
    serviceConfigProgramArgs: '程序参数',
    serviceConfigProgramArgsPlaceholder: '例如：--server.servlet.context-path=/demo',
    serviceConfigPortInvalid: '运行端口必须是 1 到 65535 之间的整数。',
    serviceStatus: '状态',
    servicePort: '端口',
    servicePortReachable: '端口连通',
    servicePid: 'PID',
    serviceBuildTool: '构建器',
    serviceCpu: 'CPU',
    serviceMemory: '内存',
    serviceLogFile: '日志文件',
    serviceLogs: '最近日志',
    serviceIdle: '空闲',
    serviceBuilding: '构建中',
    serviceRunning: '运行中',
    serviceStopped: '已停止',
    serviceFailed: '失败',
    serviceNoLogs: '当前还没有日志输出。',
    servicePreparing: '处理中...',
    logsWorkspaceTitle: '日志工作台',
    logsWorkspaceEmpty: '当前还没有可查看日志的服务。',
    logsWorkspaceSelectHint: '请选择一个服务查看更完整的实时日志。',
    openPort: '已连通',
    closedPort: '未连通',
    runtimeDetectFirst: '请先完成项目扫描，再进行环境探测。',
    startupClassCountSuffix: '个启动类',
    noStartupClassDetected: '当前模块还没有识别到 Spring Boot 启动类。',
    selectProjectFirst: '请先选择一个 Maven 项目目录。',
    scanFailedPrefix: '扫描失败'
  },
  'en-US': {
    appTitle: 'MicroLight Console',
    heroEyebrow: 'Desktop Runtime Console',
    heroTitle: 'MicroLight Console',
    heroDescription:
      'A lightweight control surface for local Spring Boot services. The current build already wires Electron, Vue, and Fastify together and includes a first-pass Maven project scanner.',
    switchToChinese: '中文',
    switchToEnglish: 'English',
    refreshHealth: 'Refresh Health',
    runtimeTitle: 'Runtime',
    runtimeApp: 'App',
    runtimeBackendUrl: 'Backend URL',
    runtimeBackendPid: 'Backend PID',
    runtimePending: 'Pending',
    settingsTitle: 'Settings',
    settingsLocale: 'Interface Language',
    settingsDefaultBuildTool: 'Default Build Tool',
    settingsSkipTests: 'Skip Tests by Default',
    settingsRecentProjects: 'Recent Projects',
    settingsSave: 'Save Settings',
    settingsSaved: 'Settings saved',
    settingsRestoreLastProject: 'Restore Last Project',
    settingsAuto: 'Auto',
    settingsMavenWrapper: 'Maven Wrapper',
    settingsMaven: 'System Maven',
    settingsMvnd: 'mvnd',
    settingsNoRecentProjects: 'No recent projects yet.',
    healthTitle: 'Health Check',
    healthChecking: 'Checking backend health...',
    healthHealthy: 'Healthy',
    healthUnknown: 'Unknown',
    healthStatus: 'Status',
    healthVersion: 'Version',
    healthTimestamp: 'Timestamp',
    scannerEyebrow: 'Phase 2',
    scannerTitle: 'Project Scanner',
    selectProject: 'Select Project',
    scanProject: 'Scan Maven Project',
    scanning: 'Scanning...',
    selectedPath: 'Selected Path',
    noProjectSelected: 'No project selected yet',
    rootArtifact: 'Root Artifact',
    moduleCount: 'Modules',
    packaging: 'Packaging',
    environmentTitle: 'Runtime Environment',
    detectEnvironment: 'Detect Runtime',
    environmentRecommendedTool: 'Recommended Builder',
    environmentUnavailable: 'Unavailable',
    environmentAvailable: 'Available',
    environmentJava: 'Java',
    environmentMavenWrapper: 'Maven Wrapper',
    environmentMaven: 'System Maven',
    environmentMvnd: 'mvnd',
    serviceLaunch: 'Build and Start',
    serviceRestart: 'Restart Service',
    serviceStop: 'Stop Service',
    serviceConfigTitle: 'Launch Configuration',
    serviceConfigBuildTool: 'Builder for This Run',
    serviceConfigProfiles: 'Spring Profiles',
    serviceConfigProfilesPlaceholder: 'For example: dev,local',
    serviceConfigJvmArgs: 'JVM Arguments',
    serviceConfigJvmArgsPlaceholder: 'For example: -Xms256m -Xmx512m',
    serviceConfigProgramArgs: 'Program Arguments',
    serviceConfigProgramArgsPlaceholder: 'For example: --server.servlet.context-path=/demo',
    serviceConfigPortInvalid: 'Runtime port must be an integer between 1 and 65535.',
    serviceStatus: 'Status',
    servicePort: 'Port',
    servicePortReachable: 'Port Reachability',
    servicePid: 'PID',
    serviceBuildTool: 'Build Tool',
    serviceCpu: 'CPU',
    serviceMemory: 'Memory',
    serviceLogFile: 'Log File',
    serviceLogs: 'Recent Logs',
    serviceIdle: 'Idle',
    serviceBuilding: 'Building',
    serviceRunning: 'Running',
    serviceStopped: 'Stopped',
    serviceFailed: 'Failed',
    serviceNoLogs: 'No logs yet.',
    servicePreparing: 'Working...',
    logsWorkspaceTitle: 'Log Workspace',
    logsWorkspaceEmpty: 'No service logs are available yet.',
    logsWorkspaceSelectHint: 'Select a service to inspect its live log stream.',
    openPort: 'Reachable',
    closedPort: 'Unreachable',
    runtimeDetectFirst: 'Please scan a project before runtime detection.',
    startupClassCountSuffix: 'startup class(es)',
    noStartupClassDetected: 'No Spring Boot startup class detected in this module yet.',
    selectProjectFirst: 'Please select a Maven project directory first.',
    scanFailedPrefix: 'Scan failed'
  }
}
