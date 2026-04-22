interface RuntimeInfo {
  appName: string
  appVersion: string
  serverUrl: string
  backendPid: number | null
  isPackaged: boolean
  platform: NodeJS.Platform
  exePath: string
  userDataPath: string
}

interface Window {
  microlight: {
    getRuntimeInfo: () => Promise<RuntimeInfo>
    selectProjectDirectory: () => Promise<string | null>
    copyText: (text: string) => Promise<{ ok: boolean }>
    saveTextFile: (payload: {
      title: string
      defaultFileName: string
      content: string
    }) => Promise<{ canceled: boolean; filePath: string | null }>
    applyDesktopSettings: (settings: { trayEnabled: boolean; closeAction: 'quit' | 'hide' }) => Promise<{ ok: boolean }>
  }
}
