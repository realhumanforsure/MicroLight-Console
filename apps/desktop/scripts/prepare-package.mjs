import { access, cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '..', '..')
const serverDistPath = path.join(workspaceRoot, 'apps', 'server', 'dist')
const stagingRoot = path.join(desktopRoot, '.package-assets')
const stagingServerPath = path.join(stagingRoot, 'server')

await access(serverDistPath)
await rm(stagingRoot, { recursive: true, force: true })
await mkdir(stagingServerPath, { recursive: true })
await cp(serverDistPath, path.join(stagingServerPath, 'dist'), { recursive: true })

console.log(`Prepared packaged backend from ${serverDistPath}`)
