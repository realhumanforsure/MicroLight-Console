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
const iconSourcePath = path.join(desktopRoot, 'buildResources', 'icon.svg')
const stageRoot = resolveStageRoot()
const stageServerPath = path.join(stageRoot, '.package-assets', 'server')
const stageSharedPath = path.join(stageRoot, 'vendor', 'microlight-shared')
const stageBuildPath = path.join(stageRoot, 'build')
const stageIconPath = path.join(stageBuildPath, 'icon.ico')

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
await access(iconSourcePath)

await rm(stageRoot, { recursive: true, force: true })
await mkdir(stageServerPath, { recursive: true })
await mkdir(stageSharedPath, { recursive: true })
await mkdir(stageBuildPath, { recursive: true })

await cp(desktopDistPath, path.join(stageRoot, 'out'), { recursive: true })
await cp(serverDistPath, path.join(stageServerPath, 'dist'), { recursive: true })
await cp(sharedDistPath, path.join(stageSharedPath, 'dist'), { recursive: true })
await writeFile(stageIconPath, createWindowsIcon())

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
      'build/icon.ico',
      'package.json'
    ],
    extraResources: [
      {
        from: 'build/icon.ico',
        to: 'icon.ico'
      }
    ],
    asar: true,
    asarUnpack: ['node_modules/**/*.node'],
    electronLanguages: ['zh-CN', 'en-US'],
    compression: 'maximum',
    npmRebuild: true,
    copyright: 'Copyright © 2026 realhumanforsure',
    win: {
      icon: 'build/icon.ico',
      executableName: 'MicroLight Console',
      target: [
        {
          target: 'nsis',
          arch: ['x64']
        }
      ],
      artifactName: '${productName}-${version}-${arch}.${ext}'
    },
    nsis: {
      installerIcon: 'build/icon.ico',
      uninstallerIcon: 'build/icon.ico',
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'MicroLight Console',
      uninstallDisplayName: 'MicroLight Console'
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

function createWindowsIcon() {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = sizes.map((size) => createIconImage(size))
  const headerSize = 6
  const directorySize = 16 * images.length
  let offset = headerSize + directorySize
  const directoryEntries = []

  for (const image of images) {
    directoryEntries.push(createIconDirectoryEntry(image.size, image.buffer.length, offset))
    offset += image.buffer.length
  }

  return Buffer.concat([
    createIconHeader(images.length),
    ...directoryEntries,
    ...images.map((image) => image.buffer)
  ])
}

function createIconHeader(imageCount) {
  const buffer = Buffer.alloc(6)
  buffer.writeUInt16LE(0, 0)
  buffer.writeUInt16LE(1, 2)
  buffer.writeUInt16LE(imageCount, 4)
  return buffer
}

function createIconDirectoryEntry(size, imageSize, imageOffset) {
  const buffer = Buffer.alloc(16)
  buffer.writeUInt8(size === 256 ? 0 : size, 0)
  buffer.writeUInt8(size === 256 ? 0 : size, 1)
  buffer.writeUInt8(0, 2)
  buffer.writeUInt8(0, 3)
  buffer.writeUInt16LE(1, 4)
  buffer.writeUInt16LE(32, 6)
  buffer.writeUInt32LE(imageSize, 8)
  buffer.writeUInt32LE(imageOffset, 12)
  return buffer
}

function createIconImage(size) {
  const pixels = createIconPixels(size)
  const header = Buffer.alloc(40)
  const pixelDataSize = size * size * 4
  const maskStride = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskStride * size)
  const bitmap = Buffer.alloc(pixelDataSize)

  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(pixelDataSize + mask.length, 20)
  header.writeInt32LE(0, 24)
  header.writeInt32LE(0, 28)
  header.writeUInt32LE(0, 32)
  header.writeUInt32LE(0, 36)

  for (let y = 0; y < size; y += 1) {
    const sourceY = size - 1 - y

    for (let x = 0; x < size; x += 1) {
      const sourceIndex = (sourceY * size + x) * 4
      const targetIndex = (y * size + x) * 4

      bitmap[targetIndex] = pixels[sourceIndex + 2]
      bitmap[targetIndex + 1] = pixels[sourceIndex + 1]
      bitmap[targetIndex + 2] = pixels[sourceIndex]
      bitmap[targetIndex + 3] = pixels[sourceIndex + 3]
    }
  }

  return {
    size,
    buffer: Buffer.concat([header, bitmap, mask])
  }
}

function createIconPixels(size) {
  const pixels = new Uint8ClampedArray(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / (size - 1)
      const ny = y / (size - 1)
      const shellAlpha = roundedRectAlpha(nx, ny, 0.07, 0.07, 0.86, 0.86, 0.21)

      if (shellAlpha > 0) {
        const shade = Math.min(1, Math.max(0, (nx * 0.42) + (ny * 0.58)))
        const base = mixColor([17, 43, 67], [8, 16, 30], shade)
        setPixel(pixels, size, x, y, base[0], base[1], base[2], Math.round(255 * shellAlpha))
      }
    }
  }

  drawRect(pixels, size, 0.23, 0.28, 0.12, 0.46, [121, 240, 200, 255])
  drawRect(pixels, size, 0.65, 0.28, 0.12, 0.46, [85, 216, 180, 255])
  drawSegment(pixels, size, 0.32, 0.31, 0.50, 0.64, 0.13, [169, 255, 228, 255])
  drawSegment(pixels, size, 0.50, 0.64, 0.69, 0.31, 0.13, [85, 216, 180, 255])
  drawCircle(pixels, size, 0.72, 0.32, 0.09, [143, 179, 255, 255])
  drawRoundedRect(pixels, size, 0.51, 0.69, 0.25, 0.06, 0.03, [143, 179, 255, 255])

  return pixels
}

function setPixel(pixels, size, x, y, r, g, b, a) {
  const index = (y * size + x) * 4
  const sourceAlpha = a / 255
  const targetAlpha = pixels[index + 3] / 255
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)

  if (outputAlpha === 0) {
    return
  }

  pixels[index] = Math.round((r * sourceAlpha + pixels[index] * targetAlpha * (1 - sourceAlpha)) / outputAlpha)
  pixels[index + 1] = Math.round((g * sourceAlpha + pixels[index + 1] * targetAlpha * (1 - sourceAlpha)) / outputAlpha)
  pixels[index + 2] = Math.round((b * sourceAlpha + pixels[index + 2] * targetAlpha * (1 - sourceAlpha)) / outputAlpha)
  pixels[index + 3] = Math.round(outputAlpha * 255)
}

function drawRect(pixels, size, left, top, width, height, color) {
  const x0 = Math.floor(left * size)
  const y0 = Math.floor(top * size)
  const x1 = Math.ceil((left + width) * size)
  const y1 = Math.ceil((top + height) * size)

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      setPixel(pixels, size, x, y, ...color)
    }
  }
}

function drawRoundedRect(pixels, size, left, top, width, height, radius, color) {
  for (let y = Math.floor(top * size); y < Math.ceil((top + height) * size); y += 1) {
    for (let x = Math.floor(left * size); x < Math.ceil((left + width) * size); x += 1) {
      const alpha = roundedRectAlpha(x / size, y / size, left, top, width, height, radius)

      if (alpha > 0) {
        setPixel(pixels, size, x, y, color[0], color[1], color[2], Math.round(color[3] * alpha))
      }
    }
  }
}

function drawCircle(pixels, size, cx, cy, radius, color) {
  for (let y = Math.floor((cy - radius) * size); y < Math.ceil((cy + radius) * size); y += 1) {
    for (let x = Math.floor((cx - radius) * size); x < Math.ceil((cx + radius) * size); x += 1) {
      const distance = Math.hypot(x / size - cx, y / size - cy)
      const alpha = Math.max(0, Math.min(1, (radius - distance) * size))

      if (alpha > 0) {
        setPixel(pixels, size, x, y, color[0], color[1], color[2], Math.round(color[3] * alpha))
      }
    }
  }
}

function drawSegment(pixels, size, x0, y0, x1, y1, width, color) {
  const minX = Math.floor((Math.min(x0, x1) - width) * size)
  const maxX = Math.ceil((Math.max(x0, x1) + width) * size)
  const minY = Math.floor((Math.min(y0, y1) - width) * size)
  const maxY = Math.ceil((Math.max(y0, y1) + width) * size)

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const distance = pointToSegmentDistance(x / size, y / size, x0, y0, x1, y1)
      const alpha = Math.max(0, Math.min(1, (width / 2 - distance) * size))

      if (alpha > 0) {
        setPixel(pixels, size, x, y, color[0], color[1], color[2], Math.round(color[3] * alpha))
      }
    }
  }
}

function roundedRectAlpha(nx, ny, left, top, width, height, radius) {
  const right = left + width
  const bottom = top + height

  if (nx < left || nx > right || ny < top || ny > bottom) {
    return 0
  }

  const cornerX = nx < left + radius ? left + radius : nx > right - radius ? right - radius : nx
  const cornerY = ny < top + radius ? top + radius : ny > bottom - radius ? bottom - radius : ny
  const distance = Math.hypot(nx - cornerX, ny - cornerY)

  return Math.max(0, Math.min(1, (radius - distance) * 256))
}

function pointToSegmentDistance(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared))
  const x = x0 + t * dx
  const y = y0 + t * dy

  return Math.hypot(px - x, py - y)
}

function mixColor(from, to, amount) {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount)
  ]
}
