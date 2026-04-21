import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const desktopRoot = path.resolve(__dirname, '..')

let packagingFailed = false

try {
  runCommand(npmCommand, ['run', 'prepare:package'])
  runCommand('npx', ['electron-builder', '--win', 'nsis'])
} catch (error) {
  packagingFailed = true
  throw error
} finally {
  try {
    await restoreNativeModule()
  } catch (restoreError) {
    if (!packagingFailed) {
      throw restoreError
    }

    console.error(restoreError)
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}`)
  }
}

async function restoreNativeModule() {
  let lastError = null

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      if (attempt > 1) {
        await delay(3000)
      }

      runCommand(npmCommand, ['run', 'restore:dev-native'])
      return
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}
