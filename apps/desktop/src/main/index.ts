import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_NAME,
  DEFAULT_CLOSE_ACTION,
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_URL,
  DEFAULT_TRAY_ENABLED,
  type AppSettings
} from '@microlight/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcessWithoutNullStreams | null = null
let tray: Tray | null = null
let isQuitting = false
let desktopSettings: Pick<AppSettings, 'trayEnabled' | 'closeAction'> = {
  trayEnabled: DEFAULT_TRAY_ENABLED,
  closeAction: DEFAULT_CLOSE_ACTION
}

function getBackendEnv() {
  return {
    ...process.env,
    MICROLIGHT_SERVER_PORT: String(DEFAULT_SERVER_PORT)
  }
}

function resolveDevServerEntry() {
  const relativeEntry = process.env.MICROLIGHT_SERVER_DEV_ENTRY ?? '../server/src/index.ts'
  return path.resolve(app.getAppPath(), relativeEntry)
}

function startBackend() {
  if (backendProcess) {
    return
  }

  const serverEntry = resolveDevServerEntry()
  backendProcess = spawn('node', ['--import', 'tsx', serverEntry], {
    cwd: path.dirname(serverEntry),
    env: getBackendEnv(),
    stdio: 'pipe'
  })

  backendProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`)
  })

  backendProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[server] ${chunk}`)
  })

  backendProcess.on('exit', (code, signal) => {
    console.log(`[server] exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    backendProcess = null
  })
}

function stopBackend() {
  if (!backendProcess) {
    return
  }

  backendProcess.kill('SIGTERM')
  backendProcess = null
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 720,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }

    if (desktopSettings.trayEnabled && desktopSettings.closeAction === 'hide') {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function applyDesktopSettings(settings: Pick<AppSettings, 'trayEnabled' | 'closeAction'>) {
  desktopSettings = settings

  if (desktopSettings.trayEnabled) {
    ensureTray()
    return
  }

  if (tray) {
    tray.destroy()
    tray = null
  }
}

function ensureTray() {
  if (tray) {
    tray.setToolTip(APP_NAME)
    tray.setContextMenu(createTrayMenu())
    return
  }

  tray = new Tray(createTrayIcon())
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(createTrayMenu())
  tray.on('click', () => {
    showMainWindow()
  })
}

function createTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      click: () => {
        showMainWindow()
      }
    },
    {
      label: '隐藏主窗口',
      click: () => {
        mainWindow?.hide()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#0d172b"/>
      <path d="M18 18h28v8H26v12h16v8H26v10h-8z" fill="#79f0c8"/>
      <circle cx="46" cy="42" r="8" fill="#93b8ff"/>
    </svg>
  `.trim()

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function showMainWindow() {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
}

ipcMain.handle('app:get-runtime-info', async () => {
  return {
    appName: APP_NAME,
    serverUrl: DEFAULT_SERVER_URL,
    backendPid: backendProcess?.pid ?? null
  }
})

ipcMain.handle('app:select-project-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择 Maven 项目目录',
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.handle('app:apply-desktop-settings', async (_, settings: Pick<AppSettings, 'trayEnabled' | 'closeAction'>) => {
  applyDesktopSettings(settings)
  return {
    ok: true
  }
})

app.whenReady().then(async () => {
  startBackend()
  await createWindow()
  applyDesktopSettings(desktopSettings)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
      applyDesktopSettings(desktopSettings)
      return
    }

    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  stopBackend()
})
