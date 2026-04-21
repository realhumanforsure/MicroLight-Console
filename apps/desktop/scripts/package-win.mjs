import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '..', '..')
const builderCliPath = path.join(workspaceRoot, 'node_modules', 'electron-builder', 'cli.js')
const stageRoot = resolveStageRoot()

runCommand(npmCommand, ['run', 'prepare:package'], desktopRoot)
runCommand(npmCommand, ['install', '--omit=dev'], stageRoot)
runCommand(process.execPath, [builderCliPath, '--projectDir', stageRoot, '--win', 'nsis'], desktopRoot, {
  shell: false
})

function runCommand(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: options.shell ?? process.platform === 'win32'
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}`)
  }
}

function resolveStageRoot() {
  const stageDirectoryName = 'MicroLight-Console-PackageStage'
  const stagePath = path.resolve(workspaceRoot, '..', stageDirectoryName)

  if (path.basename(stagePath) !== stageDirectoryName) {
    throw new Error(`Unsafe package stage path: ${stagePath}`)
  }

  return stagePath
}
