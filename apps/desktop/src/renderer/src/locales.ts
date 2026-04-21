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
    startupClassCountSuffix: 'startup class(es)',
    noStartupClassDetected: 'No Spring Boot startup class detected in this module yet.',
    selectProjectFirst: 'Please select a Maven project directory first.',
    scanFailedPrefix: 'Scan failed'
  }
}
