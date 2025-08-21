import type { Shell } from '../src/builtins/types'
import type { Job } from '../src/jobs/job-manager'
import { describe, expect, it, mock } from 'bun:test'
import { bgCommand } from '../src/builtins/bg'
import { disownCommand } from '../src/builtins/disown'
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
    addJob: mock(),
    removeJob: mock(() => true),
    suspendJob: mock(),
    resumeJobBackground: mock(() => true),
    resumeJobForeground: mock(() => true),
    terminateJob: mock(() => true),
    waitForJob: mock(async (id: number) => mockJobs.find(j => j.id === id) ?? null),
  } as unknown as Shell
}

describe('Designator variants: %+, +, - across bg/fg/disown', () => {
  it('resolves %+ and + as current', async () => {
    const shell = createMockShell([
      { id: 10, command: 'older', status: 'running' },
      { id: 11, command: 'newer', status: 'stopped' },
    ])

    // bg with + should refer to current (id 11) but it's stopped so allowed
    let res = await bgCommand.execute(['+'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobBackground).toHaveBeenCalledWith(11)

    // disown with %+ should refer to current (id 11)
    res = await disownCommand.execute(['%+'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.removeJob).toHaveBeenCalledWith(11, true)
  })

  it('resolves - as previous', async () => {
    const shell = createMockShell([
      { id: 20, command: 'first', status: 'running' },
      { id: 21, command: 'second', status: 'running' },
    ])

    // fg with - should bring previous (id 20)
    const res = await fgCommand.execute(['-'], shell)
    expect(res.exitCode).toBe(0)
    expect(shell.resumeJobForeground).toHaveBeenCalledWith(20)
  })
})
