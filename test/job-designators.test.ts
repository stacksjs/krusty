import type { Shell } from '../src/builtins/types'
import type { Job } from '../src/jobs/job-manager'
import { describe, expect, it, mock } from 'bun:test'
import { bgCommand } from '../src/builtins/bg'
import { disownCommand } from '../src/builtins/disown'
import { fgCommand } from '../src/builtins/fg'

function createMockShell(jobs: Partial<Job>[] = []): Shell {
  const mockJobs = jobs.map((job, index) => ({
    id: job.id || index + 1,
    pid: job.pid || 1000 + index,
    command: job.command || `cmd ${index + 1}`,
    status: job.status || 'running',
    background: job.background ?? false,
    pgid: job.pgid || 2000 + index,
    startTime: job.startTime || Date.now(),
    ...job,
  })) as Job[]

  return {
    config: { verbose: false } as any,
    log: { info: mock(), warn: mock(), error: mock(), debug: mock() } as any,
    jobs: mock(() => mockJobs),
    getJobs: mock(() => mockJobs),
    getJob: mock((id: number) => mockJobs.find(j => j.id === id)),
    addJob: mock(),
    removeJob: mock(() => true),
    suspendJob: mock(),
    resumeJobBackground: mock(() => true),
    resumeJobForeground: mock(() => true),
    terminateJob: mock(() => true),
    waitForJob: mock(async (id: number) => {
      const job = mockJobs.find(j => j.id === id)
      return job ? { ...job, status: 'done' as const, exitCode: 0 } : null
    }),
  } as unknown as Shell
}

describe('Job designators %+ and %- across builtins', () => {
  it('bg defaults to most recent stopped job and supports %+/%-', async () => {
    const shell = createMockShell([
      { id: 1, command: 'sleep 1', status: 'stopped' },
      { id: 2, command: 'sleep 2', status: 'stopped' },
      { id: 3, command: 'echo ok', status: 'running' },
    ])

    // No arg: most recent stopped -> id 2
    let res = await bgCommand.execute([], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobBackground).toHaveBeenCalledWith(2)

    // %+ should resolve to current (most recent non-done) -> id 3
    res = await bgCommand.execute(['%+'], shell)
    expect(res.exitCode).toBe(1) // not stopped -> error
    expect(res.stderr).toContain('is not stopped')

    // %- should resolve to previous non-done -> id 2
    res = await bgCommand.execute(['%-'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobBackground).toHaveBeenCalledWith(2)
  })

  it('fg attaches running background job and continues stopped job', async () => {
    const shell = createMockShell([
      { id: 1, command: 'bg running', status: 'running', background: true },
      { id: 2, command: 'stopped', status: 'stopped', background: true },
    ])

    // %+ -> id 2 as current non-done? With ordering above, id2 is last -> current
    let res = await fgCommand.execute(['%+'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobForeground).toHaveBeenCalledWith(2)

    // %- -> id 1 previous; running background should attach
    res = await fgCommand.execute(['%-'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobForeground).toHaveBeenCalledWith(1)
  })

  it('disown supports %+ and %- and defaults to current', async () => {
    const shell = createMockShell([
      { id: 5, command: 'run5', status: 'running' },
      { id: 6, command: 'run6', status: 'running' },
    ])

    // default -> current id 6
    let res = await disownCommand.execute([], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.removeJob).toHaveBeenCalledWith(6, true)

    // %+ -> id 6
    res = await disownCommand.execute(['%+'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.removeJob).toHaveBeenCalledWith(6, true)

    // %- -> id 5
    res = await disownCommand.execute(['%-'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.removeJob).toHaveBeenCalledWith(5, true)
  })
})
