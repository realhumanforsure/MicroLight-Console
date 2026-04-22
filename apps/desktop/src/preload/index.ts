import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('microlight', {
  getRuntimeInfo: () => ipcRenderer.invoke('app:get-runtime-info'),
  selectProjectDirectory: () => ipcRenderer.invoke('app:select-project-directory'),
  copyText: (text: string) => ipcRenderer.invoke('app:copy-text', text),
  saveTextFile: (payload: { title: string; defaultFileName: string; content: string }) =>
    ipcRenderer.invoke('app:save-text-file', payload),
  applyDesktopSettings: (settings: { trayEnabled: boolean; closeAction: 'quit' | 'hide' }) =>
    ipcRenderer.invoke('app:apply-desktop-settings', settings)
})
