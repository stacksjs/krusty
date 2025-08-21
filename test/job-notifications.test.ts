import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, mock, vi } from 'bun:test'
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
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: any, sig?: any) => {
      if ((pid === 12345 || pid === -12345) && (sig === 0 || sig === undefined)) {
        const err: any = new Error('No such process')
        err.code = 'ESRCH'
        throw err
      }
      return true as any
    })

    // Invoke private monitor method to detect completion
    ;(jm as any).checkJobStatuses()

    // Expect notification using "Done" format
    expect(info).toHaveBeenCalledWith(`[${jobId}] Done sleep 1`)

    killSpy.mockRestore()
    jm.shutdown()
  })

  it('logs exit status when ChildProcess exit event fires', () => {
    const { shell, info } = createShellWithLogger()
    const jm = new JobManager(shell)

    // Minimal ChildProcess mock that supports on('exit', cb)
    const listeners: Record<string, Function[]> = {}
    const cp: Partial<ChildProcess> = {
      pid: 24680,
      on: (event: any, cb: any) => {
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
