import type { Shell } from '../src/builtins/types'
import type { Job } from '../src/jobs/job-manager'
import { describe, expect, it, mock } from 'bun:test'
import { bgCommand } from '../src/builtins/bg'
import { fgCommand } from '../src/builtins/fg'

function createMockShell(jobs: Partial<Job>[]): Shell {
  const mockJobs = jobs.map((job, i) => ({
    id: job.id ?? i + 1,
    pid: job.pid ?? 1000 + i,
    pgid: job.pgid ?? 2000 + i,
    command: job.command ?? `cmd ${i + 1}`,
    status: job.status ?? 'running',
    background: job.background ?? true,
    startTime: job.startTime ?? Date.now(),
    ...job,
  })) as Job[]

  return {
    config: { verbose: false } as any,
    log: { info: mock(), warn: mock(), error: mock(), debug: mock() } as any,
    jobs: mock(() => mockJobs),
    getJobs: mock(() => mockJobs),
    getJob: mock((id: number) => mockJobs.find(j => j.id === id)),
    resumeJobBackground: mock(() => true),
    resumeJobForeground: mock(() => true),
    removeJob: mock(() => true),
  } as unknown as Shell
}

describe('bg/fg defaults and error handling', () => {
  it('fg defaults to current job (most recent non-done)', async () => {
    const shell = createMockShell([
      { id: 1, command: 'sleep 10', status: 'running', background: true },
      { id: 2, command: 'vim file', status: 'stopped', background: true },
    ])

    const res = await fgCommand.execute([], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobForeground).toHaveBeenCalledWith(2)
  })

  it('bg defaults to most recent stopped job', async () => {
    const shell = createMockShell([
      { id: 3, command: 'top', status: 'running', background: true },
      { id: 4, command: 'nano', status: 'stopped', background: true },
    ])

    const res = await bgCommand.execute([], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobBackground).toHaveBeenCalledWith(4)
  })

  it('errors on invalid job spec and inappropriate states', async () => {
    // No jobs
    const emptyShell = createMockShell([])
    let res = await bgCommand.execute(['%1'], emptyShell)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toMatch(/job not found/i)

    res = await fgCommand.execute(['%1'], emptyShell)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toMatch(/no such job|no current job/i)

    // A running job (not stopped) for bg should error
    const shell = createMockShell([
      { id: 5, command: 'echo run', status: 'running', background: true },
    ])
    res = await bgCommand.execute(['%5'], shell)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toMatch(/is not stopped/i)
  })
})
