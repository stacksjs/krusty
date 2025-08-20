import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { JobManager } from '../src/jobs/job-manager'

// Mock child process for testing
function createMockChildProcess(pid: number = 12345): Partial<ChildProcess> {
  return {
    pid,
    on: mock.fn(),
    kill: mock.fn(),
    stdout: { on: mock.fn() },
    stderr: { on: mock.fn() },
    stdin: { write: mock.fn(), end: mock.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
  }
}

// Mock timers - using native setTimeout/setInterval for bun

describe.skip('Real-time Background Job Monitoring', () => {
  let jobManager: JobManager
  let mockChildProcess: Partial<ChildProcess>

  beforeEach(() => {
    jobManager = new JobManager()
    mockChildProcess = createMockChildProcess()
  })

  afterEach(() => {
    jobManager.shutdown()
  })

  describe('Background Job Status Monitoring', () => {
    it('should start monitoring when first job is added', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

      jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
    })

    it('should monitor job status changes automatically', async () => {
      const jobId = jobManager.addJob('sleep 5', mockChildProcess as ChildProcess, true)
      const job = jobManager.getJob(jobId)!

      // Simulate job completion by triggering exit event
      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      expect(exitCallback).toBeDefined()

      // Trigger exit event
      exitCallback(0, null)

      // Advance timers to trigger monitoring
      vi.advanceTimersByTime(1000)

      expect(job.status).toBe('done')
      expect(job.exitCode).toBe(0)
    })

    it('should detect and update job status from running to done', () => {
      const jobId = jobManager.addJob('echo hello', mockChildProcess as ChildProcess, true)
      const job = jobManager.getJob(jobId)!

      expect(job.status).toBe('running')

      // Simulate process exit
      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(0, null)
      vi.advanceTimersByTime(1000)

      expect(job.status).toBe('done')
    })

    it('should detect job failure with exit code', () => {
      const jobId = jobManager.addJob('false', mockChildProcess as ChildProcess, true)
      const job = jobManager.getJob(jobId)!

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(1, null)
      vi.advanceTimersByTime(1000)

      expect(job.status).toBe('done')
      expect(job.exitCode).toBe(1)
    })

    it('should detect job termination by signal', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)
      const job = jobManager.getJob(jobId)!

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(null, 'SIGTERM')
      vi.advanceTimersByTime(1000)

      expect(job.status).toBe('done')
      expect(job.signal).toBe('SIGTERM')
    })
  })

  describe('Job Event Emission During Monitoring', () => {
    it('should emit jobCompleted event when job finishes successfully', (done) => {
      const jobId = jobManager.addJob('echo hello', mockChildProcess as ChildProcess, true)

      jobManager.on('jobCompleted', (event) => {
        expect(event.job.id).toBe(jobId)
        expect(event.job.status).toBe('done')
        expect(event.job.exitCode).toBe(0)
        done()
      })

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(0, null)
      vi.advanceTimersByTime(1000)
    })

    it('should emit jobFailed event when job exits with error', (done) => {
      const jobId = jobManager.addJob('false', mockChildProcess as ChildProcess, true)

      jobManager.on('jobFailed', (event) => {
        expect(event.job.id).toBe(jobId)
        expect(event.job.status).toBe('done')
        expect(event.job.exitCode).toBe(1)
        done()
      })

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(1, null)
      vi.advanceTimersByTime(1000)
    })

    it('should emit jobTerminated event when job is killed by signal', (done) => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      jobManager.on('jobTerminated', (event) => {
        expect(event.job.id).toBe(jobId)
        expect(event.job.status).toBe('done')
        expect(event.job.signal).toBe('SIGKILL')
        done()
      })

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(null, 'SIGKILL')
      vi.advanceTimersByTime(1000)
    })

    it('should emit jobStatusChanged event for any status change', (done) => {
      const jobId = jobManager.addJob('echo hello', mockChildProcess as ChildProcess, true)

      jobManager.on('jobStatusChanged', (event) => {
        expect(event.job.id).toBe(jobId)
        expect(event.oldStatus).toBe('running')
        expect(event.newStatus).toBe('done')
        done()
      })

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(0, null)
      vi.advanceTimersByTime(1000)
    })
  })

  describe('Automatic Job Cleanup', () => {
    it('should automatically remove completed jobs after monitoring', () => {
      const jobId = jobManager.addJob('echo hello', mockChildProcess as ChildProcess, true)

      expect(jobManager.getJob(jobId)).toBeDefined()

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(0, null)
      vi.advanceTimersByTime(1000)

      // Job should still exist immediately after completion
      expect(jobManager.getJob(jobId)).toBeDefined()
      expect(jobManager.getJob(jobId)?.status).toBe('done')
    })

    it('should keep failed jobs for inspection', () => {
      const jobId = jobManager.addJob('false', mockChildProcess as ChildProcess, true)

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(1, null)
      vi.advanceTimersByTime(1000)

      const job = jobManager.getJob(jobId)
      expect(job).toBeDefined()
      expect(job?.status).toBe('done')
      expect(job?.exitCode).toBe(1)
    })

    it('should keep terminated jobs for inspection', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(null, 'SIGTERM')
      vi.advanceTimersByTime(1000)

      const job = jobManager.getJob(jobId)
      expect(job).toBeDefined()
      expect(job?.status).toBe('done')
      expect(job?.signal).toBe('SIGTERM')
    })
  })

  describe('Multiple Job Monitoring', () => {
    it('should monitor multiple background jobs simultaneously', () => {
      const job1Id = jobManager.addJob('sleep 5', mockChildProcess as ChildProcess, true)
      const job2Id = jobManager.addJob('sleep 10', createMockChildProcess(12346) as ChildProcess, true)
      const job3Id = jobManager.addJob('echo hello', createMockChildProcess(12347) as ChildProcess, true)

      expect(jobManager.getJobs()).toHaveLength(3)

      // Complete job 3 first
      const job3ExitCallback = (createMockChildProcess(12347).on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      job3ExitCallback?.(0, null)
      vi.advanceTimersByTime(1000)

      const job3 = jobManager.getJob(job3Id)!
      expect(job3.status).toBe('done')

      // Other jobs should still be running
      expect(jobManager.getJob(job1Id)?.status).toBe('running')
      expect(jobManager.getJob(job2Id)?.status).toBe('running')
    })

    it('should handle mixed foreground and background job monitoring', () => {
      const bgJobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)
      const fgJobId = jobManager.addJob('vim file.txt', createMockChildProcess(12346) as ChildProcess, false)

      // Complete background job
      const bgExitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      bgExitCallback(0, null)
      vi.advanceTimersByTime(1000)

      expect(jobManager.getJob(bgJobId)?.status).toBe('done')
      expect(jobManager.getJob(fgJobId)?.status).toBe('running')
    })
  })

  describe('Monitoring Performance and Resource Management', () => {
    it('should use single monitoring interval for all jobs', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

      jobManager.addJob('sleep 1', mockChildProcess as ChildProcess, true)
      jobManager.addJob('sleep 2', createMockChildProcess(12346) as ChildProcess, true)
      jobManager.addJob('sleep 3', createMockChildProcess(12347) as ChildProcess, true)

      // Should only have one interval set
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    })

    it('should stop monitoring when no jobs remain', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

      const jobId = jobManager.addJob('echo hello', mockChildProcess as ChildProcess, true)

      // Complete and remove the job
      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(0, null)
      vi.advanceTimersByTime(1000)

      // Remove the completed job
      jobManager.removeJob(jobId)
      vi.advanceTimersByTime(1000)

      expect(clearIntervalSpy).toHaveBeenCalled()
    })

    it('should handle monitoring interval errors gracefully', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      // Mock an error in the monitoring function
      const originalConsoleError = console.error
      console.error = vi.fn()

      // Simulate an error during monitoring
      const job = jobManager.getJob(jobId)!
      job.childProcess = null as any // Force an error

      expect(() => {
        vi.advanceTimersByTime(1000)
      }).not.toThrow()

      console.error = originalConsoleError
    })
  })

  describe('Job Status Transition Tracking', () => {
    it('should track job duration correctly', () => {
      const startTime = Date.now()
      vi.setSystemTime(startTime)

      const jobId = jobManager.addJob('sleep 5', mockChildProcess as ChildProcess, true)

      // Advance time by 5 seconds
      vi.setSystemTime(startTime + 5000)

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(0, null)
      vi.advanceTimersByTime(1000)

      const job = jobManager.getJob(jobId)!
      expect(job.endTime).toBeDefined()
      expect(job.endTime! - job.startTime).toBeGreaterThanOrEqual(5000)
    })

    it('should preserve job history for completed jobs', () => {
      const jobId = jobManager.addJob('echo "test output"', mockChildProcess as ChildProcess, true)

      const exitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      exitCallback(0, null)
      vi.advanceTimersByTime(1000)

      const job = jobManager.getJob(jobId)!
      expect(job.status).toBe('done')
      expect(job.exitCode).toBe(0)
      expect(job.startTime).toBeDefined()
      expect(job.endTime).toBeDefined()
      expect(job.command).toBe('echo "test output"')
    })
  })

  describe('Monitoring Lifecycle Management', () => {
    it('should clean up monitoring on shutdown', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

      jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)
      jobManager.shutdown()

      expect(clearIntervalSpy).toHaveBeenCalled()
    })

    it('should not start new monitoring after shutdown', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

      jobManager.shutdown()
      jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      // Should not set new interval after shutdown
      expect(setIntervalSpy).not.toHaveBeenCalled()
    })

    it('should handle multiple shutdown calls gracefully', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

      jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      expect(() => {
        jobManager.shutdown()
        jobManager.shutdown() // Second shutdown should not crash
      }).not.toThrow()

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Real-time Notifications', () => {
    it('should provide real-time job completion notifications', (done) => {
      const notifications: string[] = []

      jobManager.on('jobCompleted', (event) => {
        notifications.push(`Job ${event.job.id} completed: ${event.job.command}`)
      })

      jobManager.on('jobFailed', (event) => {
        notifications.push(`Job ${event.job.id} failed: ${event.job.command}`)
      })

      const job1Id = jobManager.addJob('echo success', mockChildProcess as ChildProcess, true)
      const job2Id = jobManager.addJob('false', createMockChildProcess(12346) as ChildProcess, true)

      // Complete first job successfully
      const job1ExitCallback = (mockChildProcess.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      job1ExitCallback(0, null)
      vi.advanceTimersByTime(1000)

      // Fail second job
      const job2ExitCallback = (createMockChildProcess(12346).on as any).mock.calls.find(
        (call: any[]) => call[0] === 'exit',
      )?.[1]

      job2ExitCallback?.(1, null)
      vi.advanceTimersByTime(1000)

      setTimeout(() => {
        expect(notifications).toContain(`Job ${job1Id} completed: echo success`)
        expect(notifications).toContain(`Job ${job2Id} failed: false`)
        done()
      }, 100)
    })
  })
})
