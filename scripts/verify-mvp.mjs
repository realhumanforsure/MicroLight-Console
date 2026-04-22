import { access, cp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.NODE_ENV = 'production'
process.env.MICROLIGHT_SERVER_LOGGER = 'silent'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..')
const sampleSingleModulePath = path.join(workspaceRoot, 'fixtures', 'sample-maven-app')
const sampleMultiModulePath = path.join(workspaceRoot, 'fixtures', 'sample-multi-module-app')
const desktopReleasePath = path.join(workspaceRoot, 'apps', 'desktop', 'release')
const installerPath = path.join(desktopReleasePath, 'MicroLight Console-0.1.0-x64.exe')
const unpackedExePath = path.join(desktopReleasePath, 'win-unpacked', 'MicroLight Console.exe')
const tempRoot = path.join(os.tmpdir(), `MicroLight Console 验收-${Date.now()}`)
const tempProjectPath = path.join(tempRoot, '示例 项目')

const { createServer } = await import('../apps/server/dist/index.js')
const app = await createServer()
const results = []

try {
  await check('server-health', '后端健康检查', async () => {
    const response = await app.inject('/api/health')
    const payload = response.json()

    assert(response.statusCode === 200, `期望状态码 200，实际 ${response.statusCode}`)
    assert(payload.ok === true, '健康检查未返回 ok=true')

    return `服务响应 ${response.statusCode}，版本 ${payload.version}`
  })

  await check('single-module-scan', '单模块项目扫描', async () => {
    const payload = await postJson('/api/projects/scan', {
      rootPath: sampleSingleModulePath
    })
    const services = collectServiceCandidates(payload)
    const service = services[0]

    assert(payload.moduleCount === 1, `期望 1 个模块，实际 ${payload.moduleCount}`)
    assert(services.length === 1, `期望 1 个启动类，实际 ${services.length}`)
    assert(service.defaultPort === 18080, `期望默认端口 18080，实际 ${service.defaultPort}`)
    assert(
      service.mainClass === 'com.example.demo.SampleMavenAppApplication',
      `启动类不匹配：${service.mainClass}`
    )

    return `识别 ${payload.moduleCount} 个模块、${services.length} 个启动类`
  })

  await check('multi-module-scan', '嵌套多模块项目扫描', async () => {
    const payload = await postJson('/api/projects/scan', {
      rootPath: sampleMultiModulePath
    })
    const services = collectServiceCandidates(payload)
    const serviceModule = payload.modules.find((module) => module.artifactId === 'service-app')

    assert(payload.moduleCount === 4, `期望 4 个模块，实际 ${payload.moduleCount}`)
    assert(services.length === 1, `期望 1 个启动类，实际 ${services.length}`)
    assert(serviceModule, '未识别 service-app 模块')
    assert(
      serviceModule.serviceCandidates[0]?.defaultPort === 18082,
      `期望 service-app 默认端口 18082，实际 ${serviceModule.serviceCandidates[0]?.defaultPort}`
    )

    return `识别 ${payload.moduleCount} 个模块，服务模块 ${serviceModule.artifactId}`
  })

  await check('project-preflight', '项目预检接口', async () => {
    const payload = await postJson('/api/projects/preflight', {
      rootPath: sampleMultiModulePath
    })
    const moduleScan = findCheck(payload, 'module-scan')
    const startupClasses = findCheck(payload, 'startup-classes')
    const servicePackaging = findCheck(payload, 'service-packaging')

    assert(moduleScan.status === 'pass', `模块扫描状态异常：${moduleScan.status}`)
    assert(startupClasses.status === 'pass', `启动类识别状态异常：${startupClasses.status}`)
    assert(servicePackaging.status === 'pass', `可启动模块状态异常：${servicePackaging.status}`)

    return `预检通过 ${payload.summary.passCount} 项，警告 ${payload.summary.warnCount} 项`
  })

  await check('unicode-path-scan', '中文与空格路径扫描', async () => {
    await mkdir(tempRoot, { recursive: true })
    await cp(sampleSingleModulePath, tempProjectPath, { recursive: true })

    const scanPayload = await postJson('/api/projects/scan', {
      rootPath: tempProjectPath
    })
    const preflightPayload = await postJson('/api/projects/preflight', {
      rootPath: tempProjectPath
    })
    const pathCheck = findCheck(preflightPayload, 'project-path-shape')
    const services = collectServiceCandidates(scanPayload)

    assert(services.length === 1, `中文路径下期望 1 个启动类，实际 ${services.length}`)
    assert(pathCheck.status === 'warn', `路径兼容性检查期望 warn，实际 ${pathCheck.status}`)

    return `中文路径识别 ${services.length} 个启动类，路径检查状态 ${pathCheck.status}`
  })

  await check('release-artifacts', 'Windows 发布产物', async () => {
    await access(installerPath)
    await access(unpackedExePath)

    return `已找到安装器和 win-unpacked 可执行文件`
  })

  await check('release-readiness', '发布安装说明', async () => {
    const response = await app.inject('/api/release/readiness')
    const payload = response.json()

    assert(response.statusCode === 200, `期望状态码 200，实际 ${response.statusCode}`)
    assert(payload.artifacts.every((artifact) => artifact.available), '存在未生成的发布产物')
    assert(payload.installationSteps.length >= 3, '安装步骤不完整')
    assert(payload.verificationSteps.length >= 3, '运行验证步骤不完整')

    return `发布产物 ${payload.artifacts.length} 项，安装步骤 ${payload.installationSteps.length} 项`
  })

  await check('service-group-contract', '服务组编排接口', async () => {
    const listResponse = await app.inject('/api/service-groups')
    const listPayload = listResponse.json()
    const emptyLaunchResponse = await app.inject({
      method: 'POST',
      url: '/api/service-groups/launch',
      payload: {
        groupName: 'empty',
        services: [],
        stopOnFailure: true
      }
    })

    assert(listResponse.statusCode === 200, `服务组列表返回 ${listResponse.statusCode}`)
    assert(Array.isArray(listPayload.groups), '服务组列表格式不正确')
    assert(emptyLaunchResponse.statusCode === 400, `空服务组应返回 400，实际 ${emptyLaunchResponse.statusCode}`)

    return `服务组列表可读，空服务组保护生效`
  })
} finally {
  await rm(tempRoot, { recursive: true, force: true })
  await app.close()
}

printResults()

if (results.some((result) => result.status === 'fail')) {
  process.exit(1)
}

process.exit(0)

async function check(id, label, run) {
  try {
    const detail = await run()
    results.push({
      id,
      label,
      status: 'pass',
      detail
    })
  } catch (error) {
    results.push({
      id,
      label,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}

async function postJson(url, body) {
  const response = await app.inject({
    method: 'POST',
    url,
    payload: body
  })
  const payload = response.json()

  assert(response.statusCode >= 200 && response.statusCode < 300, `${url} 返回 ${response.statusCode}`)

  return payload
}

function collectServiceCandidates(scanResult) {
  return scanResult.modules.flatMap((module) => module.serviceCandidates)
}

function findCheck(report, id) {
  const item = report.checks.find((checkItem) => checkItem.id === id)

  assert(item, `预检结果缺少 ${id}`)

  return item
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function printResults() {
  console.log('\nMicroLight Console MVP 验收结果')
  console.log('='.repeat(36))

  for (const result of results) {
    const marker = result.status === 'pass' ? 'PASS' : 'FAIL'
    console.log(`[${marker}] ${result.label}：${result.detail}`)
  }
}
