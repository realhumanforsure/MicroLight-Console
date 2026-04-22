import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ReleaseArtifactCheck,
  ReleaseGuideStep,
  ReleaseReadinessResponse
} from '@microlight/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..', '..', '..')
const releaseRoot = path.join(workspaceRoot, 'apps', 'desktop', 'release')
const sourceInstallerPath = path.join(releaseRoot, 'MicroLight Console-0.1.0-x64.exe')
const sourceUnpackedExePath = path.join(releaseRoot, 'win-unpacked', 'MicroLight Console.exe')
const sourceIconPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'icon.ico')

export async function getReleaseReadiness(): Promise<ReleaseReadinessResponse> {
  const runtimePaths = resolveRuntimePaths()

  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    installerPath: runtimePaths.installerPath,
    unpackedExePath: runtimePaths.unpackedExePath,
    artifacts: await Promise.all(
      runtimePaths.artifacts.map((artifact) =>
        createArtifactCheck(artifact.id, artifact.label, artifact.path, artifact.detail)
      )
    ),
    installationSteps: createInstallationSteps(),
    verificationSteps: createVerificationSteps()
  }
}

function resolveRuntimePaths() {
  if (isPackagedElectronRuntime()) {
    const currentExecutablePath = process.execPath
    const resourcesPath = getElectronResourcesPath() ?? path.dirname(currentExecutablePath)
    const iconPath = path.join(resourcesPath, 'icon.ico')

    return {
      installerPath: currentExecutablePath,
      unpackedExePath: currentExecutablePath,
      artifacts: [
        {
          id: 'current-executable',
          label: 'Current executable',
          path: currentExecutablePath,
          detail: 'Installed application executable is readable.'
        },
        {
          id: 'application-resources',
          label: 'Application resources',
          path: resourcesPath,
          detail: 'Packaged application resources directory is readable.'
        },
        {
          id: 'application-icon',
          label: 'Application icon',
          path: iconPath,
          detail: 'Packaged Windows icon resource is readable.'
        }
      ]
    }
  }

  return {
    installerPath: sourceInstallerPath,
    unpackedExePath: sourceUnpackedExePath,
    artifacts: [
      {
        id: 'windows-installer',
        label: 'Windows installer',
        path: sourceInstallerPath,
        detail: 'NSIS installer created with electron-builder.'
      },
      {
        id: 'unpacked-executable',
        label: 'Unpacked executable',
        path: sourceUnpackedExePath,
        detail: 'Portable validation target used before distributing the installer.'
      },
      {
        id: 'application-icon',
        label: 'Application icon',
        path: sourceIconPath,
        detail: 'Windows icon resource generated for the packaged application.'
      }
    ]
  }
}

function isPackagedElectronRuntime() {
  return Boolean(process.versions.electron && getElectronResourcesPath())
}

function getElectronResourcesPath() {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
}

async function createArtifactCheck(
  id: string,
  label: string,
  artifactPath: string,
  detail: string
): Promise<ReleaseArtifactCheck> {
  const available = await canReadFile(artifactPath)

  return {
    id,
    label,
    path: artifactPath,
    available,
    detail: available ? detail : `Artifact is not available at ${artifactPath}`
  }
}

async function canReadFile(filePath: string) {
  try {
    await fs.access(filePath, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

function createInstallationSteps(): ReleaseGuideStep[] {
  return [
    {
      id: 'close-running-app',
      title: 'Close running instances',
      detail: 'Exit any running MicroLight Console window before installing a new build.'
    },
    {
      id: 'run-installer',
      title: 'Run the Windows installer',
      detail: 'Open the generated exe installer and keep the default per-user installation unless a custom directory is required.'
    },
    {
      id: 'open-from-shortcut',
      title: 'Launch from shortcut',
      detail: 'Start MicroLight Console from the desktop or Start Menu shortcut created by the installer.'
    }
  ]
}

function createVerificationSteps(): ReleaseGuideStep[] {
  return [
    {
      id: 'backend-health',
      title: 'Confirm backend health',
      detail: 'The runtime panel should show a healthy backend and the packaged runtime mode.'
    },
    {
      id: 'open-project',
      title: 'Open a Maven project',
      detail: 'Choose a Spring Boot 3.x project and verify that modules and startup classes are detected.'
    },
    {
      id: 'start-service',
      title: 'Build and start a service',
      detail: 'Launch one service, confirm that logs stream into the service tab, then stop the service cleanly.'
    }
  ]
}
