export type Locale = 'zh-CN' | 'en-US'

interface ReleaseStepMessage {
  title: string
  detail: string
}

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
  runtimeVersion: string
  runtimeBackendUrl: string
  runtimeBackendPid: string
  runtimeMode: string
  runtimeModePackaged: string
  runtimeModeDev: string
  runtimePlatform: string
  runtimeExePath: string
  runtimeUserDataPath: string
  runtimePending: string
  preflightTitle: string
  preflightDescription: string
  preflightRefresh: string
  preflightChecking: string
  preflightPass: string
  preflightWarn: string
  preflightFail: string
  preflightGeneratedAt: string
  preflightEmpty: string
  releaseEyebrow: string
  releaseTitle: string
  releaseDescription: string
  releaseRefresh: string
  releaseChecking: string
  releaseGeneratedAt: string
  releaseInstallerArtifact: string
  releaseUnpackedArtifact: string
  releaseAvailable: string
  releaseMissing: string
  releaseInstallStepsTitle: string
  releaseVerifyStepsTitle: string
  releaseInstallSteps: ReleaseStepMessage[]
  releaseVerifySteps: ReleaseStepMessage[]
  releaseEmpty: string
  settingsTitle: string
  settingsGeneralTitle: string
  settingsGeneralDescription: string
  settingsDesktopTitle: string
  settingsDesktopDescription: string
  settingsLocale: string
  settingsDefaultBuildTool: string
  settingsSkipTests: string
  settingsTrayEnabled: string
  settingsCloseAction: string
  settingsCloseActionSummary: string
  settingsCloseActionHide: string
  settingsCloseActionQuit: string
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
  serviceHealth: string
  serviceHealthHealthy: string
  serviceHealthUnhealthy: string
  serviceHealthUnknown: string
  serviceHealthDetail: string
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
  serviceGroupTitle: string
  serviceGroupLaunchAll: string
  serviceGroupStopAll: string
  serviceGroupSaveCurrent: string
  serviceGroupStartupInterval: string
  serviceGroupStartupIntervalHint: string
  serviceGroupStartupIntervalInvalid: string
  serviceGroupSavedTitle: string
  serviceGroupLaunchSaved: string
  serviceGroupDeleteSaved: string
  serviceGroupSavedMessage: string
  serviceGroupDeletedMessage: string
  serviceGroupName: string
  serviceGroupServiceCount: string
  serviceGroupUpdatedAt: string
  serviceGroupRunning: string
  serviceGroupItemPending: string
  serviceGroupCompleted: string
  serviceGroupFailed: string
  serviceGroupStopping: string
  serviceGroupStopped: string
  serviceGroupEmpty: string
  serviceGroupNoActive: string
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
    runtimeVersion: '应用版本',
    runtimeBackendUrl: '后端地址',
    runtimeBackendPid: '后端进程 PID',
    runtimeMode: '运行模式',
    runtimeModePackaged: '已打包',
    runtimeModeDev: '开发态',
    runtimePlatform: '运行平台',
    runtimeExePath: '可执行文件',
    runtimeUserDataPath: '用户数据目录',
    runtimePending: '等待中',
    preflightTitle: '环境与项目预检',
    preflightDescription: '把 MVP 验收中最关键的检查项提前跑一遍，帮助我们更快定位阻塞点。',
    preflightRefresh: '刷新预检',
    preflightChecking: '正在执行预检...',
    preflightPass: '通过',
    preflightWarn: '警告',
    preflightFail: '失败',
    preflightGeneratedAt: '最近预检时间',
    preflightEmpty: '当前还没有预检结果。',
    releaseEyebrow: '发布收尾',
    releaseTitle: 'Windows 安装与运行',
    releaseDescription: '汇总当前 Windows 发布产物、安装动作和运行验证步骤，方便在分发前做最后确认。',
    releaseRefresh: '刷新发布检查',
    releaseChecking: '正在检查发布产物...',
    releaseGeneratedAt: '最近检查时间',
    releaseInstallerArtifact: 'Windows 安装器',
    releaseUnpackedArtifact: '解压版可执行文件',
    releaseAvailable: '已生成',
    releaseMissing: '缺失',
    releaseInstallStepsTitle: '安装步骤',
    releaseVerifyStepsTitle: '运行验证',
    releaseInstallSteps: [
      {
        title: '退出正在运行的应用',
        detail: '安装新版本前，先关闭当前 MicroLight Console 窗口，避免文件占用。'
      },
      {
        title: '运行 Windows 安装器',
        detail: '打开生成的 exe 安装器，普通场景保持默认的当前用户安装目录即可。'
      },
      {
        title: '从快捷方式启动',
        detail: '安装完成后，通过桌面或开始菜单快捷方式启动 MicroLight Console。'
      }
    ],
    releaseVerifySteps: [
      {
        title: '确认后端健康',
        detail: '运行时信息应显示后端健康，并且打包版本中运行模式应为已打包。'
      },
      {
        title: '打开 Maven 项目',
        detail: '选择一个 Spring Boot 3.x 项目，确认模块和启动类可以被识别。'
      },
      {
        title: '启动并停止服务',
        detail: '构建启动一个服务，确认日志进入服务选项卡，然后正常停止服务。'
      }
    ],
    releaseEmpty: '当前还没有发布检查结果。',
    settingsTitle: '设置',
    settingsGeneralTitle: '通用设置',
    settingsGeneralDescription: '配置默认语言、构建器和基础构建偏好。',
    settingsDesktopTitle: '桌面行为',
    settingsDesktopDescription: '配置托盘支持和点击关闭按钮时的窗口行为。',
    settingsLocale: '界面语言',
    settingsDefaultBuildTool: '默认构建器',
    settingsSkipTests: '默认跳过测试',
    settingsTrayEnabled: '启用系统托盘',
    settingsCloseAction: '关闭按钮行为',
    settingsCloseActionSummary: '当前关闭窗口时将执行：',
    settingsCloseActionHide: '隐藏到托盘',
    settingsCloseActionQuit: '直接退出应用',
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
    serviceHealth: '健康状态',
    serviceHealthHealthy: '健康',
    serviceHealthUnhealthy: '异常',
    serviceHealthUnknown: '未知',
    serviceHealthDetail: '健康检查详情',
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
    serviceGroupTitle: '服务组编排',
    serviceGroupLaunchAll: '顺序启动服务组',
    serviceGroupStopAll: '停止服务组',
    serviceGroupSaveCurrent: '保存当前服务组',
    serviceGroupStartupInterval: '服务启动间隔',
    serviceGroupStartupIntervalHint: '服务组会按扫描顺序启动，每个服务启动成功后再等待指定秒数启动下一个服务。',
    serviceGroupStartupIntervalInvalid: '服务启动间隔必须是 0 到 600 秒之间的数字。',
    serviceGroupSavedTitle: '已保存服务组',
    serviceGroupLaunchSaved: '启动已保存组',
    serviceGroupDeleteSaved: '删除',
    serviceGroupSavedMessage: '服务组已保存。',
    serviceGroupDeletedMessage: '服务组已删除。',
    serviceGroupName: '服务组',
    serviceGroupServiceCount: '服务数',
    serviceGroupUpdatedAt: '更新时间',
    serviceGroupRunning: '运行中',
    serviceGroupItemPending: '等待中',
    serviceGroupCompleted: '已完成',
    serviceGroupFailed: '失败',
    serviceGroupStopping: '停止中',
    serviceGroupStopped: '已停止',
    serviceGroupEmpty: '当前扫描结果中没有可编排启动的服务。',
    serviceGroupNoActive: '当前还没有可停止的服务组。',
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
    runtimeVersion: 'Version',
    runtimeBackendUrl: 'Backend URL',
    runtimeBackendPid: 'Backend PID',
    runtimeMode: 'Runtime Mode',
    runtimeModePackaged: 'Packaged',
    runtimeModeDev: 'Development',
    runtimePlatform: 'Platform',
    runtimeExePath: 'Executable Path',
    runtimeUserDataPath: 'User Data Path',
    runtimePending: 'Pending',
    preflightTitle: 'Environment and Project Preflight',
    preflightDescription: 'Run the most important MVP readiness checks up front so blockers are easier to spot.',
    preflightRefresh: 'Refresh Preflight',
    preflightChecking: 'Running preflight...',
    preflightPass: 'Pass',
    preflightWarn: 'Warn',
    preflightFail: 'Fail',
    preflightGeneratedAt: 'Last Preflight Time',
    preflightEmpty: 'No preflight report is available yet.',
    releaseEyebrow: 'Release Readiness',
    releaseTitle: 'Windows Install and Run',
    releaseDescription: 'Review the current Windows artifacts, installation actions, and runtime checks before distributing a build.',
    releaseRefresh: 'Refresh Release Check',
    releaseChecking: 'Checking release artifacts...',
    releaseGeneratedAt: 'Last Check Time',
    releaseInstallerArtifact: 'Windows Installer',
    releaseUnpackedArtifact: 'Unpacked Executable',
    releaseAvailable: 'Generated',
    releaseMissing: 'Missing',
    releaseInstallStepsTitle: 'Installation Steps',
    releaseVerifyStepsTitle: 'Runtime Verification',
    releaseInstallSteps: [
      {
        title: 'Exit running instances',
        detail: 'Close any active MicroLight Console window before installing a new version.'
      },
      {
        title: 'Run the Windows installer',
        detail: 'Open the generated exe installer and keep the default per-user location unless a custom path is needed.'
      },
      {
        title: 'Launch from shortcut',
        detail: 'Start MicroLight Console from the desktop shortcut or the Start Menu shortcut.'
      }
    ],
    releaseVerifySteps: [
      {
        title: 'Confirm backend health',
        detail: 'The runtime panel should show a healthy backend, and packaged builds should show packaged mode.'
      },
      {
        title: 'Open a Maven project',
        detail: 'Select a Spring Boot 3.x project and confirm that modules and startup classes are detected.'
      },
      {
        title: 'Start and stop a service',
        detail: 'Build and launch one service, confirm logs stream into the service tab, then stop it cleanly.'
      }
    ],
    releaseEmpty: 'No release readiness result is available yet.',
    settingsTitle: 'Settings',
    settingsGeneralTitle: 'General',
    settingsGeneralDescription: 'Configure the default language, build tool, and basic build preferences.',
    settingsDesktopTitle: 'Desktop Behavior',
    settingsDesktopDescription: 'Configure tray support and how the app behaves when the close button is pressed.',
    settingsLocale: 'Interface Language',
    settingsDefaultBuildTool: 'Default Build Tool',
    settingsSkipTests: 'Skip Tests by Default',
    settingsTrayEnabled: 'Enable System Tray',
    settingsCloseAction: 'Close Button Behavior',
    settingsCloseActionSummary: 'Closing the window will currently:',
    settingsCloseActionHide: 'Hide to Tray',
    settingsCloseActionQuit: 'Quit the App',
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
    serviceHealth: 'Health',
    serviceHealthHealthy: 'Healthy',
    serviceHealthUnhealthy: 'Unhealthy',
    serviceHealthUnknown: 'Unknown',
    serviceHealthDetail: 'Health Detail',
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
    serviceGroupTitle: 'Service Group Orchestration',
    serviceGroupLaunchAll: 'Start Service Group',
    serviceGroupStopAll: 'Stop Service Group',
    serviceGroupSaveCurrent: 'Save Current Group',
    serviceGroupStartupInterval: 'Startup Interval',
    serviceGroupStartupIntervalHint: 'Services start in scan order. After each service starts, the group waits this many seconds before the next one.',
    serviceGroupStartupIntervalInvalid: 'Startup interval must be a number between 0 and 600 seconds.',
    serviceGroupSavedTitle: 'Saved Service Groups',
    serviceGroupLaunchSaved: 'Launch Saved Group',
    serviceGroupDeleteSaved: 'Delete',
    serviceGroupSavedMessage: 'Service group saved.',
    serviceGroupDeletedMessage: 'Service group deleted.',
    serviceGroupName: 'Group',
    serviceGroupServiceCount: 'Services',
    serviceGroupUpdatedAt: 'Updated At',
    serviceGroupRunning: 'Running',
    serviceGroupItemPending: 'Pending',
    serviceGroupCompleted: 'Completed',
    serviceGroupFailed: 'Failed',
    serviceGroupStopping: 'Stopping',
    serviceGroupStopped: 'Stopped',
    serviceGroupEmpty: 'No services are available for group orchestration in the current scan result.',
    serviceGroupNoActive: 'There is no active service group to stop yet.',
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
