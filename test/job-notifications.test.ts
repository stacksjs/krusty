import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, mock } from 'bun:test'
import { JobManager } from '../src/jobs/job-manager'

function createShellWithLogger() {
  const info = mock(() => {})
  const warn = mock(() => {})
  const error = mock(() => {})
  const debug = mock(() => {})
  const shell = {
    log: { info, warn, error, debug },
  } as any
  return { shell, info, warn, error, debug }
}

describe('Background job completion notifications', () => {
  it('logs "Done" when monitoring detects process exit (ESRCH)', () => {
    const { shell, info } = createShellWithLogger()
    const jm = new JobManager(shell)

    // Add a background job with just a PID
    const jobId = jm.addJob('sleep 1', 12345, true)

    // Simulate process.kill(pid, 0) throwing ESRCH for this pid
    const originalKill = process.kill
    const killSpy = mock((pid: any, sig?: any) => {
      if ((pid === 12345 || pid === -12345) && (sig === 0 || sig === undefined)) {
        const err: any = new Error('No such process')
        err.code = 'ESRCH'
        throw err
      }
      return true as any
    })
    process.kill = killSpy as unknown as typeof process.kill

    // Invoke private monitor method to detect completion
    ;(jm as any).checkJobStatuses()

    // Expect notification using "Done" format
    expect(info).toHaveBeenCalledWith(`[${jobId}] Done sleep 1`)

    process.kill = originalKill
    jm.shutdown()
  })

  it('logs exit status when ChildProcess exit event fires', () => {
    const { shell, info } = createShellWithLogger()
    const jm = new JobManager(shell)

    // Minimal ChildProcess mock that supports on('exit', cb)
    const listeners: Record<string, Array<(...args: any[]) => void>> = {}
    const cp: Partial<ChildProcess> = {
      pid: 24680,
      on: (event: string, cb: (...args: any[]) => void) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
        return cp as any
      },
    }

    const jobId = jm.addJob('echo ok', cp as ChildProcess, true)

    // Fire exit event
    listeners.exit?.forEach(cb => cb(0, null))

    // Expect notification with explicit exit code
    expect(info).toHaveBeenCalledWith(`[${jobId}] exited with code 0 echo ok`)

    jm.shutdown()
  })
})
