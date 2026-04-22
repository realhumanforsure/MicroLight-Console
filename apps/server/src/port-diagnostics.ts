import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PortDiagnosisResponse, PortListenerProcess } from '@microlight/shared'

const execFileAsync = promisify(execFile)

export async function diagnosePort(port: number): Promise<PortDiagnosisResponse> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.')
  }

  const listeners = process.platform === 'win32' ? await diagnoseWindowsPort(port) : await diagnoseUnixPort(port)

  return {
    port,
    status: listeners.length > 0 ? 'listening' : 'not_listening',
    detectedAt: new Date().toISOString(),
    listeners
  }
}

async function diagnoseWindowsPort(port: number): Promise<PortListenerProcess[]> {
  const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], {
    windowsHide: true
  })
  const listeners = parseWindowsNetstat(stdout, port)
  const processNames = await resolveWindowsProcessNames(listeners)

  return listeners.map((listener) => ({
    ...listener,
    processName: listener.pid === null ? null : processNames.get(listener.pid) ?? null
  }))
}

async function diagnoseUnixPort(port: number): Promise<PortListenerProcess[]> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
    return parseLsof(stdout, port)
  } catch {
    return []
  }
}

function parseWindowsNetstat(stdout: string, port: number): PortListenerProcess[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^TCP\s+/i.test(line))
    .flatMap((line) => {
      const columns = line.split(/\s+/)
      const localAddress = columns[1]
      const state = columns[3]
      const pid = Number.parseInt(columns[4] ?? '', 10)
      const localPort = parsePortFromAddress(localAddress)

      if (localPort !== port || !/^LISTENING$/i.test(state)) {
        return []
      }

      return [
        {
          protocol: columns[0],
          localAddress,
          localPort,
          pid: Number.isInteger(pid) ? pid : null,
          processName: null
        } satisfies PortListenerProcess
      ]
    })
}

function parseLsof(stdout: string, port: number): PortListenerProcess[] {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const columns = line.split(/\s+/)
      const pid = Number.parseInt(columns[1] ?? '', 10)
      const localAddress = columns.at(-2) ?? ''
      const localPort = parsePortFromAddress(localAddress)

      if (localPort !== port) {
        return []
      }

      return [
        {
          protocol: 'TCP',
          localAddress,
          localPort,
          pid: Number.isInteger(pid) ? pid : null,
          processName: columns[0] ?? null
        } satisfies PortListenerProcess
      ]
    })
}

async function resolveWindowsProcessNames(listeners: PortListenerProcess[]) {
  const pids = Array.from(
    new Set(listeners.map((listener) => listener.pid).filter((pid): pid is number => pid !== null))
  )
  const processNames = new Map<number, string>()

  await Promise.all(
    pids.map(async (pid) => {
      try {
        const { stdout } = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          windowsHide: true
        })
        const row = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line && !/^INFO:/i.test(line))
        const processName = row ? parseCsvRow(row)[0] : null

        if (processName) {
          processNames.set(pid, processName)
        }
      } catch {
        processNames.set(pid, '')
      }
    })
  )

  return processNames
}

function parseCsvRow(row: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index]

    if (character === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (character === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += character
  }

  values.push(current)
  return values
}

function parsePortFromAddress(address: string) {
  const match = address.match(/:(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : null
}
