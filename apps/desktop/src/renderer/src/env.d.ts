interface RuntimeInfo {
  appName: string
  serverUrl: string
  backendPid: number | null
}

interface Window {
  microlight: {
    getRuntimeInfo: () => Promise<RuntimeInfo>
    selectProjectDirectory: () => Promise<string | null>
    applyDesktopSettings: (settings: { trayEnabled: boolean; closeAction: 'quit' | 'hide' }) => Promise<{ ok: boolean }>
  }
}
