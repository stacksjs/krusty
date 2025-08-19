import type { Shell } from '../src/builtins/types'
import type { Job } from '../src/jobs/job-manager'
import { describe, expect, it, mock } from 'bun:test'
import { bgCommand } from '../src/builtins/bg'
import { fgCommand } from '../src/builtins/fg'
import { jobsCommand } from '../src/builtins/jobs'
import { killCommand } from '../src/builtins/kill'
import { waitCommand } from '../src/builtins/wait'

// Mock shell with job management capabilities
function createMockShell(jobs: Partial<Job>[] = []): Shell {
  const mockJobs = jobs.map((job, index) => ({
    id: job.id || index + 1,
    pid: job.pid || 1000 + index,
    command: job.command || `command ${index + 1}`,
    status: job.status || 'running',
    background: job.background || false,
    pgid: job.pgid || 1000 + index,
    startTime: job.startTime || Date.now(),
    ...job,
  })) as Job[]

  return {
    config: { verbose: false },
    log: {
      info: mock(),
      warn: mock(),
      error: mock(),
      debug: mock(),
    },
    jobs: mock(() => mockJobs),
    getJobs: mock(() => mockJobs),
    getJob: mock((id: number) => mockJobs.find(j => j.id === id)),
    addJob: mock(),
    removeJob: mock(),
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

describe('enhanced Job Control Builtins', () => {
  describe('jobs command', () => {
    it('should display no jobs when list is empty', async () => {
      const shell = createMockShell([])
      const result = await jobsCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('should display running jobs with basic format', async () => {
      const shell = createMockShell([
        { id: 1, command: 'sleep 100', status: 'running', background: true },
        { id: 2, command: 'ping google.com', status: 'running', background: false },
      ])

      const result = await jobsCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1]+ running sleep 100 &')
      expect(result.stdout).toContain('[2]+ running ping google.com')
    })

    it('should display stopped jobs correctly', async () => {
      const shell = createMockShell([
        { id: 1, command: 'vim file.txt', status: 'stopped', background: true },
      ])

      const result = await jobsCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1]- stopped vim file.txt &')
    })

    it('should display completed jobs', async () => {
      const shell = createMockShell([
        { id: 1, command: 'ls -la', status: 'done', background: false },
      ])

      const result = await jobsCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1]Done done ls -la')
    })

    it('should show PIDs with -l flag', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])

      const result = await jobsCommand.execute(['-l'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('12345')
    })

    it('should show PIDs with --long flag', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])

      const result = await jobsCommand.execute(['--long'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('12345')
    })
  })

  describe('bg command', () => {
    it('should resume most recent stopped job when no argument provided', async () => {
      const shell = createMockShell([
        { id: 1, command: 'vim file1.txt', status: 'stopped' },
        { id: 2, command: 'vim file2.txt', status: 'stopped' },
      ])

      const result = await bgCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[2] vim file2.txt &')
      expect(shell.resumeJobBackground).toHaveBeenCalledWith(2)
    })

    it('should resume specific job with %id syntax', async () => {
      const shell = createMockShell([
        { id: 1, command: 'vim file.txt', status: 'stopped' },
      ])

      const result = await bgCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1] vim file.txt &')
      expect(shell.resumeJobBackground).toHaveBeenCalledWith(1)
    })

    it('should resume specific job with numeric id', async () => {
      const shell = createMockShell([
        { id: 5, command: 'vim file.txt', status: 'stopped' },
      ])

      const result = await bgCommand.execute(['5'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[5] vim file.txt &')
      expect(shell.resumeJobBackground).toHaveBeenCalledWith(5)
    })

    it('should return error for invalid job id', async () => {
      const shell = createMockShell([])

      const result = await bgCommand.execute(['invalid'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('invalid job id')
    })

    it('should return error when no stopped jobs exist', async () => {
      const shell = createMockShell([
        { id: 1, command: 'sleep 100', status: 'running' },
      ])

      const result = await bgCommand.execute([], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no stopped jobs')
    })

    it('should return error for non-existent job', async () => {
      const shell = createMockShell([])

      const result = await bgCommand.execute(['%999'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('job not found')
    })

    it('should return error for non-stopped job', async () => {
      const shell = createMockShell([
        { id: 1, command: 'sleep 100', status: 'running' },
      ])

      const result = await bgCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('is not stopped')
    })

    it('should handle resume failure gracefully', async () => {
      const shell = createMockShell([
        { id: 1, command: 'vim file.txt', status: 'stopped' },
      ])
      ;(shell.resumeJobBackground as any).mockReturnValue(false)

      const result = await bgCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('failed to resume job')
    })
  })

  describe('fg command', () => {
    it('should bring most recent job to foreground when no argument', async () => {
      const shell = createMockShell([
        { id: 1, command: 'vim file1.txt', status: 'stopped' },
        { id: 2, command: 'vim file2.txt', status: 'stopped' },
      ])

      const result = await fgCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('vim file2.txt')
      expect(shell.resumeJobForeground).toHaveBeenCalledWith(2)
    })

    it('should bring specific job to foreground', async () => {
      const shell = createMockShell([
        { id: 1, command: 'vim file.txt', status: 'stopped' },
      ])

      const result = await fgCommand.execute(['1'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('vim file.txt')
      expect(shell.resumeJobForeground).toHaveBeenCalledWith(1)
    })

    it('should return error when no jobs exist', async () => {
      const shell = createMockShell([])

      const result = await fgCommand.execute([], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no current job')
    })

    it('should return error for invalid job id', async () => {
      const shell = createMockShell([])

      const result = await fgCommand.execute(['invalid'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no current job')
    })

    it('should return error for non-existent job', async () => {
      const shell = createMockShell([])

      const result = await fgCommand.execute(['999'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no current job')
    })

    it('should wait for job completion when waitForJob is available', async () => {
      const shell = createMockShell([
        { id: 1, command: 'sleep 5', status: 'stopped' },
      ])

      const result = await fgCommand.execute(['1'], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.waitForJob).toHaveBeenCalledWith(1)
    })

    it('should handle resume failure gracefully', async () => {
      const shell = createMockShell([
        { id: 1, command: 'vim file.txt', status: 'stopped' },
      ])
      ;(shell.resumeJobForeground as any).mockReturnValue(false)

      const result = await fgCommand.execute(['1'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('failed to resume job')
    })
  })

  describe('kill command', () => {
    it('should list signals with -l flag', async () => {
      const shell = createMockShell([])

      const result = await killCommand.execute(['-l'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('1) HUP')
      expect(result.stdout).toContain('9) KILL')
      expect(result.stdout).toContain('15) TERM')
    })

    it('should kill job with default TERM signal', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])

      const result = await killCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1] sleep 100 terminated')
      expect(shell.terminateJob).toHaveBeenCalledWith(1, 'TERM')
    })

    it('should kill job with specific signal', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])

      const result = await killCommand.execute(['-KILL', '%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1] sleep 100 terminated')
      expect(shell.terminateJob).toHaveBeenCalledWith(1, 'KILL')
    })

    it('should continue job with CONT signal', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'vim file.txt', status: 'stopped' },
      ])

      const result = await killCommand.execute(['-CONT', '%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1] vim file.txt continued')
      expect(shell.resumeJobBackground).toHaveBeenCalledWith(1)
    })

    it('should stop job with STOP signal', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])

      const result = await killCommand.execute(['-STOP', '%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[1] sleep 100 stopped')
      expect(shell.suspendJob).toHaveBeenCalledWith(1)
    })

    it('should handle numeric signal', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])

      const result = await killCommand.execute(['-9', '%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.terminateJob).toHaveBeenCalledWith(1, '9')
    })

    it('should handle PID directly', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])

      const result = await killCommand.execute(['12345'], shell)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('sleep 100 terminated')
    })

    it('should return error for invalid signal', async () => {
      const shell = createMockShell([])

      const result = await killCommand.execute(['-INVALID', '12345'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('invalid signal specification')
    })

    it('should return error for non-existent job', async () => {
      const shell = createMockShell([])

      const result = await killCommand.execute(['%999'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no current job')
    })

    it('should return error when no arguments provided', async () => {
      const shell = createMockShell([])

      const result = await killCommand.execute([], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('usage: kill')
    })

    it('should handle multiple PIDs', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
        { id: 2, pid: 12346, command: 'sleep 200', status: 'running' },
      ])

      const result = await killCommand.execute(['%1', '%2'], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.terminateJob).toHaveBeenCalledWith(1, 'TERM')
      expect(shell.terminateJob).toHaveBeenCalledWith(2, 'TERM')
    })

    it('should handle job control operation failures', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 100', status: 'running' },
      ])
      ;(shell.terminateJob as any).mockReturnValue(false)

      const result = await killCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('No such process')
    })
  })

  describe('wait command', () => {
    it('should wait for all running jobs when no arguments', async () => {
      const shell = createMockShell([
        { id: 1, command: 'sleep 5', status: 'running' },
        { id: 2, command: 'sleep 10', status: 'running' },
      ])

      const result = await waitCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.waitForJob).toHaveBeenCalledWith(1)
      expect(shell.waitForJob).toHaveBeenCalledWith(2)
    })

    it('should return immediately when no running jobs', async () => {
      const shell = createMockShell([
        { id: 1, command: 'echo done', status: 'done' },
      ])

      const result = await waitCommand.execute([], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.waitForJob).not.toHaveBeenCalled()
    })

    it('should wait for specific job with %id syntax', async () => {
      const shell = createMockShell([
        { id: 1, command: 'sleep 5', status: 'running' },
      ])

      const result = await waitCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.waitForJob).toHaveBeenCalledWith(1)
    })

    it('should wait for job by PID', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 5', status: 'running' },
      ])

      const result = await waitCommand.execute(['12345'], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.waitForJob).toHaveBeenCalledWith(1)
    })

    it('should return error for non-existent job', async () => {
      const shell = createMockShell([])

      const result = await waitCommand.execute(['%999'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no current job')
    })

    it('should return error for invalid job id', async () => {
      const shell = createMockShell([])

      const result = await waitCommand.execute(['invalid'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('invalid id')
    })

    it('should not wait for already completed jobs', async () => {
      const shell = createMockShell([
        { id: 1, command: 'echo done', status: 'done' },
      ])

      const result = await waitCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.waitForJob).not.toHaveBeenCalled()
    })

    it('should handle wait errors gracefully', async () => {
      const shell = createMockShell([
        { id: 1, command: 'sleep 5', status: 'running' },
      ])
      ;(shell.waitForJob as any).mockRejectedValue(new Error('Job terminated unexpectedly'))

      const result = await waitCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Job terminated unexpectedly')
    })

    it('should return job exit code when job completes with error', async () => {
      const shell = createMockShell([
        { id: 1, command: 'false', status: 'running' },
      ])
      ;(shell.waitForJob as any).mockResolvedValue({ exitCode: 1 })

      const result = await waitCommand.execute(['%1'], shell)

      expect(result.exitCode).toBe(1)
    })

    it('should wait for multiple jobs', async () => {
      const shell = createMockShell([
        { id: 1, pid: 12345, command: 'sleep 5', status: 'running' },
        { id: 2, pid: 12346, command: 'sleep 10', status: 'running' },
      ])

      const result = await waitCommand.execute(['12345', '12346'], shell)

      expect(result.exitCode).toBe(0)
      expect(shell.waitForJob).toHaveBeenCalledWith(1)
      expect(shell.waitForJob).toHaveBeenCalledWith(2)
    })
  })
})
