import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_NAME,
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_URL
} from '@microlight/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcessWithoutNullStreams | null = null

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

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
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
    title: 'Select a Maven project directory',
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

app.whenReady().then(async () => {
  startBackend()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackend()
})
