import { promises as fs, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import {
  type PreflightCheck,
  type PreflightCheckStatus,
  type ProjectPreflightReport,
  type ToolAvailability
} from '@microlight/shared'
import { persistenceService } from './persistence.js'
import { scanProject } from './project-scanner.js'
import { detectRuntimeTools } from './runtime-tools.js'

export async function generateProjectPreflightReport(rootPath: string | null): Promise<ProjectPreflightReport> {
  const normalizedRootPath = rootPath ? path.resolve(rootPath) : null
  const checks: PreflightCheck[] = []

  checks.push(await createDatabaseCheck())

  if (!normalizedRootPath) {
    checks.push({
      id: 'project-selected',
      label: '项目已选择',
      status: 'warn',
      detail: '当前还没有选择项目目录，预检已跳过 Maven 项目相关检查。'
    })

    return buildReport(normalizedRootPath, checks)
  }

  checks.push(await createPomCheck(normalizedRootPath))
  checks.push(createProjectPathCheck(normalizedRootPath))

  const runtimeDetection = await detectRuntimeTools(normalizedRootPath)
  checks.push(createToolCheck('java-runtime', 'Java 运行时', runtimeDetection.java.available, runtimeDetection.java.version))
  checks.push(
    createToolCheck(
      'maven-runtime',
      'Maven 构建工具',
      runtimeDetection.recommendedBuildTool !== null,
      runtimeDetection.recommendedBuildTool
        ? `推荐构建器：${runtimeDetection.recommendedBuildTool}`
        : '未检测到可用的 mvnw、mvn 或 mvnd。'
    )
  )
  checks.push(createMavenCompatibilityCheck(runtimeDetection))

  const scanResult = await scanProject(normalizedRootPath)
  const startupClassCount = scanResult.modules.reduce(
    (count, module) => count + module.serviceCandidates.length,
    0
  )
  const serviceModules = scanResult.modules.filter((module) => module.serviceCandidates.length > 0)
  const hasBoot2Module = scanResult.modules.some((module) => module.bootVersion?.startsWith('2.'))

  checks.push({
    id: 'module-scan',
    label: '模块扫描',
    status: scanResult.moduleCount > 0 ? 'pass' : 'fail',
    detail: `共识别 ${scanResult.moduleCount} 个模块。`
  })

  checks.push({
    id: 'startup-classes',
    label: '启动类识别',
    status: startupClassCount > 0 ? 'pass' : 'fail',
    detail:
      startupClassCount > 0
        ? `共识别 ${startupClassCount} 个 Spring Boot 启动类。`
        : '没有识别到可启动的 Spring Boot 服务，请检查 @SpringBootApplication 和 main 方法。'
  })

  checks.push({
    id: 'service-packaging',
    label: '可启动模块包装',
    status: serviceModules.length > 0 ? 'pass' : 'warn',
    detail:
      serviceModules.length > 0
        ? `含启动类的模块数：${serviceModules.length}。`
        : '当前项目还没有检测到可直接启动的服务模块。'
  })

  checks.push({
    id: 'boot-version',
    label: 'Spring Boot 版本基线',
    status: hasBoot2Module ? 'warn' : 'pass',
    detail: hasBoot2Module
      ? '检测到 Spring Boot 2.x 模块，当前 MVP 主要面向 Spring Boot 3.x/4.x 路径。'
      : '当前项目未检测到 Spring Boot 2.x 模块。'
  })

  return buildReport(normalizedRootPath, checks)
}

async function createDatabaseCheck(): Promise<PreflightCheck> {
  const databasePath = persistenceService.getDatabasePath()

  try {
    await fs.access(databasePath, fsConstants.R_OK | fsConstants.W_OK)
    return {
      id: 'database-access',
      label: '本地配置存储',
      status: 'pass',
      detail: `配置数据库可读写：${databasePath}`
    }
  } catch {
    return {
      id: 'database-access',
      label: '本地配置存储',
      status: 'fail',
      detail: `配置数据库不可读写：${databasePath}`
    }
  }
}

async function createPomCheck(rootPath: string): Promise<PreflightCheck> {
  const pomPath = path.join(rootPath, 'pom.xml')

  try {
    await fs.access(pomPath, fsConstants.R_OK)
    return {
      id: 'pom-readable',
      label: '根 pom.xml',
      status: 'pass',
      detail: `已找到根 pom.xml：${pomPath}`
    }
  } catch {
    return {
      id: 'pom-readable',
      label: '根 pom.xml',
      status: 'fail',
      detail: `没有在项目根目录找到可读取的 pom.xml：${pomPath}`
    }
  }
}

function createProjectPathCheck(rootPath: string): PreflightCheck {
  const hasWhitespace = /\s/.test(rootPath)
  const hasNonAscii = /[^\u0000-\u007f]/.test(rootPath)
  const isLongPath = rootPath.length >= 180

  if (!hasWhitespace && !hasNonAscii && !isLongPath) {
    return {
      id: 'project-path-shape',
      label: '项目路径兼容性',
      status: 'pass',
      detail: '当前项目路径长度和字符集都在常规范围内。'
    }
  }

  const notes: string[] = []

  if (hasWhitespace) {
    notes.push('包含空格')
  }

  if (hasNonAscii) {
    notes.push('包含非 ASCII 字符')
  }

  if (isLongPath) {
    notes.push('路径长度较长')
  }

  return {
    id: 'project-path-shape',
    label: '项目路径兼容性',
    status: 'warn',
    detail: `当前项目路径${notes.join('、')}。MicroLight Console 会继续支持该路径，但建议在实际服务启动后再做一次联调确认。`
  }
}

function createToolCheck(
  id: string,
  label: string,
  available: boolean,
  detail: string | null
): PreflightCheck {
  return {
    id,
    label,
    status: available ? 'pass' : 'fail',
    detail: detail ?? (available ? '检查通过。' : '检查失败。')
  }
}

function createMavenCompatibilityCheck(runtimeDetection: Awaited<ReturnType<typeof detectRuntimeTools>>): PreflightCheck {
  const availableTools = [
    runtimeDetection.mavenWrapper,
    runtimeDetection.maven,
    runtimeDetection.mvnd
  ].filter((tool) => tool.available)

  if (availableTools.length === 0) {
    return {
      id: 'maven-compatibility',
      label: 'Maven 版本兼容性',
      status: 'fail',
      detail: '当前没有可用的 mvnw、mvn 或 mvnd，无法验证 Maven 版本兼容性。'
    }
  }

  const recommendedTool =
    runtimeDetection.recommendedBuildTool === 'mvnw'
      ? runtimeDetection.mavenWrapper
      : runtimeDetection.recommendedBuildTool === 'mvnd'
        ? runtimeDetection.mvnd
        : runtimeDetection.recommendedBuildTool === 'mvn'
          ? runtimeDetection.maven
          : null

  const detail = availableTools
    .map((tool) => {
      const versionLabel = tool.parsedVersion ?? tool.version ?? '未知版本'
      const supportLabel =
        tool.supportLevel === 'stable'
          ? '稳定支持'
          : tool.supportLevel === 'experimental'
            ? '实验性支持'
            : tool.supportLevel === 'unsupported'
              ? '超出规划范围'
              : '待确认'

      return `${tool.kind}=${versionLabel}（${supportLabel}）`
    })
    .join('；')

  if (!recommendedTool) {
    return {
      id: 'maven-compatibility',
      label: 'Maven 版本兼容性',
      status: 'warn',
      detail
    }
  }

  const status =
    recommendedTool.supportLevel === 'stable'
      ? 'pass'
      : recommendedTool.supportLevel === 'experimental'
        ? 'warn'
        : 'fail'

  return {
    id: 'maven-compatibility',
    label: 'Maven 版本兼容性',
    status,
    detail: `推荐构建器 ${recommendedTool.kind}：${describeRecommendedTool(recommendedTool)}`
  }
}

function describeRecommendedTool(tool: ToolAvailability) {
  const versionLabel = tool.parsedVersion ?? tool.version ?? '未知版本'

  if (tool.kind === 'mvnd') {
    if (tool.supportLevel === 'stable') {
      return `mvnd ${versionLabel} 位于稳定支持范围，目标 Maven 3.x。`
    }

    if (tool.supportLevel === 'experimental') {
      return `mvnd ${versionLabel} 按实验性支持处理，目标 Maven ${tool.linkedMavenMajor ?? 4}.x。`
    }

    return `mvnd ${versionLabel} 超出规划范围，建议切回 1.x 或 2.x 版本线。`
  }

  if (tool.supportLevel === 'stable') {
    return `Apache Maven ${versionLabel} 位于稳定支持范围。`
  }

  if (tool.supportLevel === 'experimental') {
    return `Apache Maven ${versionLabel} 按实验性支持处理，建议先做一次构建验证。`
  }

  return `Apache Maven ${versionLabel} 超出规划范围，建议切回 Maven 3.x 或 4.x 路径。`
}

function buildReport(rootPath: string | null, checks: PreflightCheck[]): ProjectPreflightReport {
  const summary = checks.reduce(
    (result, check) => {
      if (check.status === 'pass') {
        result.passCount += 1
      } else if (check.status === 'warn') {
        result.warnCount += 1
      } else {
        result.failCount += 1
      }

      return result
    },
    {
      passCount: 0,
      warnCount: 0,
      failCount: 0
    }
  )

  return {
    generatedAt: new Date().toISOString(),
    rootPath,
    summary,
    checks
  }
}
