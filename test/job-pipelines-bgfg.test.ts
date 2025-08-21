import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { JobManager } from '../src/jobs/job-manager'

function createMockChildProcess(pid: number = 32100): Partial<ChildProcess> {
  return {
    pid,
    on: mock(),
    kill: mock(),
    stdout: { on: mock() } as any,
    stderr: { on: mock() } as any,
    stdin: { write: mock(), end: mock() } as any,
  }
}

describe('bg/fg across pipelines', () => {
  let jm: JobManager
  let originalKill: typeof process.kill

  beforeEach(() => {
    jm = new JobManager()
    originalKill = process.kill
    process.kill = mock()
  })

  afterEach(() => {
    jm.shutdown()
    process.kill = originalKill
  })

  it('resumes a stopped pipeline in background with SIGCONT to pgid', () => {
    const cp = createMockChildProcess(40001)
    const id = jm.addJob('sleep 1 | cat | wc -l', cp as ChildProcess, false)

    // Suspend then resume in bg
    expect(jm.suspendJob(id)).toBe(true)
    const ok = jm.resumeJobBackground(id)

    expect(ok).toBe(true)
    const job = jm.getJob(id)!
    expect(job.status).toBe('running')
    expect(job.background).toBe(true)

    // SIGCONT should have been sent to -pgid
    const killMock = process.kill as any
    expect(killMock).toHaveBeenCalledWith(-job.pgid, 'SIGCONT')
  })

  it('brings a running background pipeline to foreground without sending signals', () => {
    const cp = createMockChildProcess(40002)
    const id = jm.addJob('yes | head -n 1', cp as ChildProcess, true)

    // Job is running in background; bring to foreground
    const killMock = process.kill as any
    killMock.mockClear()

    const ok = jm.resumeJobForeground(id)

    expect(ok).toBe(true)
    const job = jm.getJob(id)!
    expect(job.background).toBe(false)

    // No signals should be sent when merely attaching
    expect(killMock).not.toHaveBeenCalled()
  })

  it('continues a stopped background pipeline to foreground with SIGCONT', () => {
    const cp = createMockChildProcess(40003)
    const id = jm.addJob('grep foo | sort | uniq', cp as ChildProcess, true)

    // Stop it
    expect(jm.suspendJob(id)).toBe(true)

    const killMock = process.kill as any
    killMock.mockClear()

    // Bring to foreground, should SIGCONT then attach
    const ok = jm.resumeJobForeground(id)

    expect(ok).toBe(true)
    const job = jm.getJob(id)!
    expect(job.background).toBe(false)
    expect(job.status).toBe('running')
    expect(killMock).toHaveBeenCalledWith(-job.pgid, 'SIGCONT')
  })
})
