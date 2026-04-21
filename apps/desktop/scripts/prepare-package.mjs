import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '..', '..')
const desktopDistPath = path.join(desktopRoot, 'out')
const serverDistPath = path.join(workspaceRoot, 'apps', 'server', 'dist')
const sharedDistPath = path.join(workspaceRoot, 'packages', 'shared', 'dist')
const stageRoot = resolveStageRoot()
const stageServerPath = path.join(stageRoot, '.package-assets', 'server')
const stageSharedPath = path.join(stageRoot, 'vendor', 'microlight-shared')

const desktopPackage = await readJson(path.join(desktopRoot, 'package.json'))
const serverPackage = await readJson(path.join(workspaceRoot, 'apps', 'server', 'package.json'))
const sharedPackage = await readJson(path.join(workspaceRoot, 'packages', 'shared', 'package.json'))

const runtimeDependencies = pickDependencies(serverPackage.dependencies, [
  '@fastify/cors',
  'better-sqlite3',
  'fast-xml-parser',
  'fastify',
  'pidusage'
])

await access(desktopDistPath)
await access(serverDistPath)
await access(sharedDistPath)

await rm(stageRoot, { recursive: true, force: true })
await mkdir(stageServerPath, { recursive: true })
await mkdir(stageSharedPath, { recursive: true })

await cp(desktopDistPath, path.join(stageRoot, 'out'), { recursive: true })
await cp(serverDistPath, path.join(stageServerPath, 'dist'), { recursive: true })
await cp(sharedDistPath, path.join(stageSharedPath, 'dist'), { recursive: true })

await writeJson(path.join(stageSharedPath, 'package.json'), {
  name: sharedPackage.name,
  version: sharedPackage.version,
  type: sharedPackage.type,
  main: sharedPackage.main,
  exports: sharedPackage.exports
})

await writeJson(path.join(stageRoot, 'package.json'), {
  name: 'microlight-console-packaged',
  version: desktopPackage.version,
  private: true,
  description: desktopPackage.description,
  author: desktopPackage.author,
  type: desktopPackage.type,
  main: desktopPackage.main,
  dependencies: {
    '@microlight/shared': 'file:vendor/microlight-shared',
    ...runtimeDependencies
  },
  build: {
    appId: 'com.realhumanforsure.microlightconsole',
    productName: 'MicroLight Console',
    electronVersion: resolveElectronVersion(desktopPackage),
    directories: {
      output: path.join(desktopRoot, 'release')
    },
    files: [
      'out/**/*',
      '.package-assets/server/dist/**/*',
      'vendor/microlight-shared/**/*',
      'package.json'
    ],
    asar: true,
    asarUnpack: ['node_modules/**/*.node'],
    npmRebuild: true,
    win: {
      target: [
        {
          target: 'nsis',
          arch: ['x64']
        }
      ],
      artifactName: '${productName}-${version}-${arch}.${ext}'
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'MicroLight Console'
    }
  }
})

console.log(`Prepared isolated package stage at ${stageRoot}`)

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function pickDependencies(dependencies, dependencyNames) {
  return dependencyNames.reduce((result, dependencyName) => {
    const version = dependencies?.[dependencyName]

    if (!version) {
      throw new Error(`Missing runtime dependency: ${dependencyName}`)
    }

    return {
      ...result,
      [dependencyName]: version
    }
  }, {})
}

function resolveElectronVersion(packageJson) {
  const version = packageJson.devDependencies?.electron

  if (!version) {
    throw new Error('Missing Electron devDependency in desktop package.')
  }

  return version.replace(/^[^\d]*/, '')
}

function resolveStageRoot() {
  const stageDirectoryName = 'MicroLight-Console-PackageStage'
  const stagePath = path.resolve(workspaceRoot, '..', stageDirectoryName)

  if (path.basename(stagePath) !== stageDirectoryName) {
    throw new Error(`Unsafe package stage path: ${stagePath}`)
  }

  return stagePath
}
