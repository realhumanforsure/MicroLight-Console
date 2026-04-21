import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('microlight', {
  getRuntimeInfo: () => ipcRenderer.invoke('app:get-runtime-info'),
  selectProjectDirectory: () => ipcRenderer.invoke('app:select-project-directory'),
  applyDesktopSettings: (settings: { trayEnabled: boolean; closeAction: 'quit' | 'hide' }) =>
    ipcRenderer.invoke('app:apply-desktop-settings', settings)
})
