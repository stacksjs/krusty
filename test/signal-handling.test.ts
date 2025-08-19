import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { JobManager } from '../src/jobs/job-manager'

// Mock child process for testing
function createMockChildProcess(pid: number = 12345): Partial<ChildProcess> {
  return {
    pid,
    on: mock(),
    kill: mock(),
    stdout: { on: mock() } as any,
    stderr: { on: mock() } as any,
    stdin: { write: mock(), end: mock() } as any,
  }
}

// Mock process methods
const originalKill = process.kill
const originalOn = process.on
const mockKill = mock()
const mockProcessOn = mock()

describe('signal Handling and Job Suspension', () => {
  let jobManager: JobManager
  let mockChildProcess: Partial<ChildProcess>

  beforeEach(() => {
    mockKill.mockClear()
    mockProcessOn.mockClear()
    process.kill = mockKill
    process.on = mockProcessOn

    jobManager = new JobManager()
    mockChildProcess = createMockChildProcess()
  })

  afterEach(() => {
    jobManager.shutdown()
    process.kill = originalKill
    process.on = originalOn
  })

  describe('sIGINT (Ctrl+C) Handling', () => {
    it('should terminate foreground job on SIGINT', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)
      const job = jobManager.getJob(jobId)!

      // Simulate SIGINT signal
      const sigintHandler = mockProcessOn.mock.calls.find(call => call[0] === 'SIGINT')?.[1]
      expect(sigintHandler).toBeDefined()

      sigintHandler()

      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGINT')
    })

    it('should not affect background jobs on SIGINT', () => {
      const bgJobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)
      const fgJobId = jobManager.addJob('vim file.txt', createMockChildProcess(12346) as ChildProcess, false)

      const sigintHandler = mockProcessOn.mock.calls.find(call => call[0] === 'SIGINT')?.[1]
      sigintHandler()

      // Only foreground job should be terminated
      expect(mockKill).toHaveBeenCalledWith(-12346, 'SIGINT')
      expect(mockKill).not.toHaveBeenCalledWith(-12345, 'SIGINT')
    })

    it('should handle SIGINT when no foreground job exists', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      const sigintHandler = mockProcessOn.mock.calls.find(call => call[0] === 'SIGINT')?.[1]

      expect(() => sigintHandler()).not.toThrow()
      expect(mockKill).not.toHaveBeenCalled()
    })
  })

  describe('sIGTSTP (Ctrl+Z) Handling', () => {
    it('should suspend foreground job on SIGTSTP', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)

      const sigtstpHandler = mockProcessOn.mock.calls.find(call => call[0] === 'SIGTSTP')?.[1]
      expect(sigtstpHandler).toBeDefined()

      sigtstpHandler()

      const job = jobManager.getJob(jobId)!
      expect(job.status).toBe('stopped')
      expect(job.background).toBe(true)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGSTOP')
    })

    it('should not affect background jobs on SIGTSTP', () => {
      const bgJobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)
      const fgJobId = jobManager.addJob('vim file.txt', createMockChildProcess(12346) as ChildProcess, false)

      const sigtstpHandler = mockProcessOn.mock.calls.find(call => call[0] === 'SIGTSTP')?.[1]
      sigtstpHandler()

      const bgJob = jobManager.getJob(bgJobId)!
      const fgJob = jobManager.getJob(fgJobId)!

      expect(bgJob.status).toBe('running')
      expect(fgJob.status).toBe('stopped')
      expect(mockKill).toHaveBeenCalledWith(-12346, 'SIGSTOP')
      expect(mockKill).not.toHaveBeenCalledWith(-12345, 'SIGSTOP')
    })

    it('should handle SIGTSTP when no foreground job exists', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, true)

      const sigtstpHandler = mockProcessOn.mock.calls.find(call => call[0] === 'SIGTSTP')?.[1]

      expect(() => sigtstpHandler()).not.toThrow()
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('should emit jobSuspended event on SIGTSTP', (done) => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)

      jobManager.on('jobSuspended', (event) => {
        expect(event.job.id).toBe(jobId)
        expect(event.job.status).toBe('stopped')
        done()
      })

      const sigtstpHandler = mockProcessOn.mock.calls.find(call => call[0] === 'SIGTSTP')?.[1]
      sigtstpHandler()
    })
  })

  describe('job Suspension Methods', () => {
    it('should suspend running job', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)

      const success = jobManager.suspendJob(jobId)
      const job = jobManager.getJob(jobId)!

      expect(success).toBe(true)
      expect(job.status).toBe('stopped')
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGSTOP')
    })

    it('should not suspend already stopped job', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      jobManager.suspendJob(jobId)

      mockKill.mockClear()
      const success = jobManager.suspendJob(jobId)

      expect(success).toBe(false)
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('should not suspend completed job', () => {
      const jobId = jobManager.addJob('echo done', mockChildProcess as ChildProcess, false)
      const job = jobManager.getJob(jobId)!
      job.status = 'done'

      const success = jobManager.suspendJob(jobId)

      expect(success).toBe(false)
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('should handle suspend signal errors gracefully', () => {
      mockKill.mockImplementation(() => {
        throw new Error('No such process')
      })

      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)
      const success = jobManager.suspendJob(jobId)

      expect(success).toBe(false)
    })

    it('should emit jobSuspended event on manual suspension', (done) => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)
      
      // Set up the listener before calling suspendJob
      const onSuspended = (event: any) => {
        try {
          expect(event.job.id).toBe(jobId)
          expect(event.job.status).toBe('stopped')
          jobManager.off('jobSuspended', onSuspended)
          done()
        } catch (err) {
          done(err)
        }
      }
      
      jobManager.on('jobSuspended', onSuspended)
      
      // Call synchronously since we're testing the event emission
      const success = jobManager.suspendJob(jobId)
      expect(success).toBe(true)
    })
  })

  describe('job Resumption After Suspension', () => {
    it('should resume suspended job in background', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      jobManager.suspendJob(jobId)

      mockKill.mockClear()
      const success = jobManager.resumeJobBackground(jobId)
      const job = jobManager.getJob(jobId)!

      expect(success).toBe(true)
      expect(job.status).toBe('running')
      expect(job.background).toBe(true)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGCONT')
    })

    it('should resume suspended job in foreground', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      jobManager.suspendJob(jobId)

      mockKill.mockClear()
      const success = jobManager.resumeJobForeground(jobId)
      const job = jobManager.getJob(jobId)!

      expect(success).toBe(true)
      expect(job.status).toBe('running')
      expect(job.background).toBe(false)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGCONT')
    })

    it('should not resume already running job', () => {
      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)

      const success = jobManager.resumeJobBackground(jobId)

      expect(success).toBe(false)
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('should not resume completed job', () => {
      const jobId = jobManager.addJob('echo done', mockChildProcess as ChildProcess, false)
      const job = jobManager.getJob(jobId)!
      job.status = 'done'

      const success = jobManager.resumeJobBackground(jobId)

      expect(success).toBe(false)
      expect(mockKill).not.toHaveBeenCalled()
    })

    it('should handle resume signal errors gracefully', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      jobManager.suspendJob(jobId)

      mockKill.mockImplementation((pid, signal) => {
        if (signal === 'SIGCONT') {
          throw new Error('No such process')
        }
      })

      const success = jobManager.resumeJobBackground(jobId)

      expect(success).toBe(false)
    })

    it('should emit jobResumed event on resumption', (done) => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      jobManager.suspendJob(jobId)
      
      // Set up the listener before calling resumeJobForeground
      const onResumed = (event: any) => {
        try {
          expect(event.job.id).toBe(jobId)
          expect(event.job.status).toBe('running')
          jobManager.off('jobResumed', onResumed)
          done()
        } catch (err) {
          done(err)
        }
      }
      
      jobManager.on('jobResumed', onResumed)
      
      // Call synchronously since we're testing the event emission
      const success = jobManager.resumeJobForeground(jobId)
      expect(success).toBe(true)
    })
  })

  describe('process Group Management', () => {
    it('should send signals to process group, not individual process', () => {
      const jobId = jobManager.addJob('bash -c "sleep 100 | cat"', mockChildProcess as ChildProcess, false)

      jobManager.suspendJob(jobId)

      // Signal should be sent to negative PID (process group)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGSTOP')
    })

    it('should handle process group creation for child processes', () => {
      const childProcess = {
        ...createMockChildProcess(),
        pid: 12345,
      } as ChildProcess

      const jobId = jobManager.addJob('sleep 100', childProcess, false)

      // Job should be created successfully
      const job = jobManager.getJob(jobId)
      expect(job).toBeDefined()
      expect(job?.pgid).toBe(12345)
    })

    it('should terminate entire process group', () => {
      const jobId = jobManager.addJob('bash -c "sleep 100 | cat"', mockChildProcess as ChildProcess, false)

      jobManager.terminateJob(jobId, 'SIGTERM')

      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGTERM')
    })
  })

  describe('signal Error Handling', () => {
    it('should handle ESRCH (No such process) error gracefully', () => {
      mockKill.mockImplementation(() => {
        const error = new Error('No such process') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        throw error
      })

      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)
      const success = jobManager.suspendJob(jobId)

      expect(success).toBe(false)
    })

    it('should handle EPERM (Operation not permitted) error gracefully', () => {
      mockKill.mockImplementation(() => {
        const error = new Error('Operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      })

      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)
      const success = jobManager.terminateJob(jobId)

      expect(success).toBe(false)
    })

    it('should handle unknown signal errors gracefully', () => {
      mockKill.mockImplementation(() => {
        throw new Error('Unknown error')
      })

      const jobId = jobManager.addJob('sleep 100', mockChildProcess as ChildProcess, false)
      const success = jobManager.suspendJob(jobId)

      expect(success).toBe(false)
    })
  })

  describe('foreground Job Tracking', () => {
    it('should track foreground job correctly', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)

      expect(jobManager.getForegroundJob()?.id).toBe(jobId)
    })

    it('should update foreground job when suspended', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      
      // Verify job was added as foreground
      expect(jobManager.getForegroundJob()?.id).toBe(jobId)
      
      // Suspend and verify foreground job is cleared
      const success = jobManager.suspendJob(jobId)
      expect(success).toBe(true)
      
      // Get the job directly to verify its status
      const job = jobManager.getJob(jobId)
      expect(job?.status).toBe('stopped')
      expect(job?.background).toBe(true)
      
      // Foreground job should be cleared after suspension
      expect(jobManager.getForegroundJob()).toBeUndefined()
    })

    it('should update foreground job when resumed to foreground', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      jobManager.suspendJob(jobId)
      jobManager.resumeJobForeground(jobId)

      expect(jobManager.getForegroundJob()?.id).toBe(jobId)
    })

    it('should not set foreground job when resumed to background', () => {
      const jobId = jobManager.addJob('vim file.txt', mockChildProcess as ChildProcess, false)
      
      // Suspend first
      expect(jobManager.suspendJob(jobId)).toBe(true)
      
      // Resume in background
      expect(jobManager.resumeJobBackground(jobId)).toBe(true)
      
      // Get the job directly to verify its status
      const job = jobManager.getJob(jobId)
      expect(job?.status).toBe('running')
      expect(job?.background).toBe(true)
      
      // Foreground job should remain unset
      expect(jobManager.getForegroundJob()).toBeUndefined()
    })

    it('should handle multiple foreground job transitions', () => {
      // Add first job - should be foreground
      const job1Id = jobManager.addJob('vim file1.txt', mockChildProcess as ChildProcess, false)
      expect(jobManager.getForegroundJob()?.id).toBe(job1Id)
      
      // Add second job - should become foreground
      const job2Id = jobManager.addJob('vim file2.txt', createMockChildProcess(12346) as ChildProcess, false)
      expect(jobManager.getForegroundJob()?.id).toBe(job2Id)
      
      // Suspend second job - should clear foreground
      expect(jobManager.suspendJob(job2Id)).toBe(true)
      expect(jobManager.getForegroundJob()).toBeUndefined()
      
      // Resume first job in foreground
      expect(jobManager.resumeJobForeground(job1Id)).toBe(true)
      
      // Verify first job is now foreground
      expect(jobManager.getForegroundJob()?.id).toBe(job1Id)
      
      // Verify job states
      expect(jobManager.getJob(job1Id)?.status).toBe('running')
      expect(jobManager.getJob(job1Id)?.background).toBe(false)
      expect(jobManager.getJob(job2Id)?.status).toBe('stopped')
    })
  })

  describe('signal Handler Cleanup', () => {
    it('should remove signal handlers on shutdown', () => {
      // Create a new job manager for this test
      const testJobManager = new JobManager()
      
      // Spy on process.removeListener
      const removeListenerSpy = mock()
      const originalRemoveListener = process.removeListener
      process.removeListener = removeListenerSpy
      
      try {
        // Shutdown should remove all registered signal handlers
        testJobManager.shutdown()
        
        // Verify removeListener was called for each signal handler
        expect(removeListenerSpy).toHaveBeenCalledTimes(3) // SIGTSTP, SIGINT, SIGCHLD
      } finally {
        // Restore original implementation
        process.removeListener = originalRemoveListener
      }
    })

    it('should not crash when removing non-existent listeners', () => {
      const jobManager2 = new JobManager()

      expect(() => {
        jobManager2.shutdown()
        jobManager2.shutdown() // Second shutdown should not crash
      }).not.toThrow()
    })
  })
})
