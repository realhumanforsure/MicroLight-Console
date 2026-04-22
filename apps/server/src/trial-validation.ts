import path from 'node:path'
import {
  type PreflightCheck,
  type ProjectTrialValidationReport
} from '@microlight/shared'
import { scanProject } from './project-scanner.js'
import { detectRuntimeTools } from './runtime-tools.js'

export async function generateTrialValidationReport(rootPath: string | null): Promise<ProjectTrialValidationReport> {
  const normalizedRootPath = rootPath ? path.resolve(rootPath) : null

  if (!normalizedRootPath) {
    return buildReport(normalizedRootPath, [
      {
        id: 'trial-project-selected',
        label: '试用项目目录',
        status: 'warn',
        detail: '请选择一个 Spring Boot 3.x / Maven 3.x 项目后再运行试用验证。'
      }
    ])
  }

  const scanResult = await scanProject(normalizedRootPath)
  const runtimeDetection = await detectRuntimeTools(normalizedRootPath)
  const startupClassCount = scanResult.modules.reduce(
    (count, module) => count + module.serviceCandidates.length,
    0
  )
  const bootVersions = scanResult.modules
    .map((module) => module.bootVersion)
    .filter((version): version is string => Boolean(version))
  const hasBoot3 = bootVersions.some((version) => version.startsWith('3.'))
  const hasBoot2 = bootVersions.some((version) => version.startsWith('2.'))
  const hasBoot4 = bootVersions.some((version) => version.startsWith('4.'))

  return buildReport(normalizedRootPath, [
    {
      id: 'trial-maven-project',
      label: 'Maven 项目结构',
      status: scanResult.moduleCount > 0 ? 'pass' : 'fail',
      detail: `已识别 ${scanResult.moduleCount} 个 Maven 模块。`
    },
    {
      id: 'trial-spring-boot-baseline',
      label: 'Spring Boot 3 基线',
      status: hasBoot3 ? 'pass' : hasBoot2 ? 'fail' : 'warn',
      detail: describeBootBaseline(bootVersions, hasBoot3, hasBoot2, hasBoot4)
    },
    {
      id: 'trial-startup-classes',
      label: '服务启动类',
      status: startupClassCount > 0 ? 'pass' : 'fail',
      detail:
        startupClassCount > 0
          ? `已识别 ${startupClassCount} 个可启动服务。`
          : '没有识别到 Spring Boot 启动类，暂不能进入启动试用。'
    },
    createJavaCheck(runtimeDetection.java.majorVersion, runtimeDetection.java.version),
    createMaven3Check(runtimeDetection),
    {
      id: 'trial-diagnostic-readiness',
      label: '日志诊断准备',
      status: startupClassCount > 0 ? 'pass' : 'warn',
      detail:
        startupClassCount > 0
          ? '启动后可进入实时日志、历史日志、构建失败摘要、端口诊断和多服务异常对比链路。'
          : '需要先识别到服务启动类，才能完整验证日志诊断链路。'
    }
  ])
}

function createJavaCheck(majorVersion: number | null, rawVersion: string | null): PreflightCheck {
  if (majorVersion === null) {
    return {
      id: 'trial-java-17',
      label: 'Java 17+',
      status: 'fail',
      detail: '没有检测到可用 Java，Spring Boot 3 试用验证无法继续。'
    }
  }

  return {
    id: 'trial-java-17',
    label: 'Java 17+',
    status: majorVersion >= 17 ? 'pass' : 'fail',
    detail:
      majorVersion >= 17
        ? `当前 Java 版本满足 Spring Boot 3 基线：${rawVersion ?? majorVersion}。`
        : `当前 Java 主版本为 ${majorVersion}，Spring Boot 3 需要 Java 17 或更高版本。`
  }
}

function createMaven3Check(runtimeDetection: Awaited<ReturnType<typeof detectRuntimeTools>>): PreflightCheck {
  const recommendedTool =
    runtimeDetection.recommendedBuildTool === 'mvnw'
      ? runtimeDetection.mavenWrapper
      : runtimeDetection.recommendedBuildTool === 'mvnd'
        ? runtimeDetection.mvnd
        : runtimeDetection.recommendedBuildTool === 'mvn'
          ? runtimeDetection.maven
          : null

  if (!recommendedTool) {
    return {
      id: 'trial-maven-3-stable',
      label: 'Maven 3 稳定构建路径',
      status: 'fail',
      detail: '没有检测到可用的 mvnw、mvn 或 mvnd。'
    }
  }

  if (recommendedTool.supportLevel === 'stable') {
    return {
      id: 'trial-maven-3-stable',
      label: 'Maven 3 稳定构建路径',
      status: 'pass',
      detail: `推荐构建器 ${recommendedTool.kind} 可用于当前试用路径：${recommendedTool.parsedVersion ?? recommendedTool.version ?? '未知版本'}。`
    }
  }

  return {
    id: 'trial-maven-3-stable',
    label: 'Maven 3 稳定构建路径',
    status: 'warn',
    detail: `推荐构建器 ${recommendedTool.kind} 当前为${recommendedTool.supportLevel === 'experimental' ? '实验性' : '非稳定'}路径，建议优先使用 Maven 3.x 或 mvnd 1.x 做本轮试用。`
  }
}

function describeBootBaseline(versions: string[], hasBoot3: boolean, hasBoot2: boolean, hasBoot4: boolean) {
  if (hasBoot3) {
    return `已检测到 Spring Boot 3.x：${formatVersions(versions)}。`
  }

  if (hasBoot2) {
    return `检测到 Spring Boot 2.x：${formatVersions(versions)}。当前试用重点是 Spring Boot 3.x，建议升级后再做正式验证。`
  }

  if (hasBoot4) {
    return `检测到 Spring Boot 4.x：${formatVersions(versions)}。当前按后续兼容性验证处理，不阻塞 Spring Boot 3.x 主线。`
  }

  return '未能从 pom.xml 明确识别 Spring Boot 版本，请确认父 POM 或依赖管理配置。'
}

function formatVersions(versions: string[]) {
  return versions.length > 0 ? Array.from(new Set(versions)).join(', ') : '未知版本'
}

function buildReport(rootPath: string | null, checks: PreflightCheck[]): ProjectTrialValidationReport {
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
  const ready = summary.failCount === 0 && checks.some((check) => check.id === 'trial-startup-classes' && check.status === 'pass')

  return {
    generatedAt: new Date().toISOString(),
    rootPath,
    target: 'spring-boot-3-maven-3',
    ready,
    summary,
    checks,
    recommendation: ready
      ? '当前项目可以进入内部试用验证：建议先启动单个服务，再验证服务组、实时日志、历史日志和诊断摘要。'
      : '当前项目还不建议进入启动试用，请先处理失败项，再重新运行验证。'
  }
}
