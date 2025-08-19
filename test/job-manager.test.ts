import type { MockedFunction } from 'bun:test'
import type { Job, JobEvent } from '../src/jobs/job-manager'
import type { Shell } from '../src/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { EventEmitter } from 'node:events'
import { JobManager } from '../src/jobs/job-manager'

// Mock child process
const mockChildProcess = {
  pid: 12345,
  on: vi.fn(),
  kill: vi.fn(),
  stdout: new EventEmitter(),
  stderr: new EventEmitter(),
  stdin: {
    write: vi.fn(),
    end: vi.fn(),
  },
}

// Mock shell
const mockShell = {
  config: { verbose: false },
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
} as unknown as Shell

// Mock process methods
const originalKill = process.kill
const originalSetpgid = (process as any).setpgid

describe('jobManager', () => {
  let jobManager: JobManager
  let mockKill: MockedFunction<typeof process.kill>

  beforeEach(() => {
    vi.clearAllMocks()
    mockKill = vi.fn()
    process.kill = mockKill
    ;(process as any).setpgid = vi.fn()

    jobManager = new JobManager(mockShell)
  })

  afterEach(() => {
    jobManager.shutdown()
    process.kill = originalKill
    ;(process as any).setpgid = originalSetpgid
  })

  describe('job Creation and Management', () => {
    it('should add a new job and return job ID', () => {
      const jobId = jobManager.addJob('test command', mockChildProcess as any, false)

      expect(jobId).toBe(1)
      expect(jobManager.getJob(jobId)).toMatchObject({
        id: 1,
        pid: 12345,
        command: 'test command',
        status: 'running',
        background: false,
      })
    })

    it('should add background job correctly', () => {
      const jobId = jobManager.addJob('background command', mockChildProcess as any, true)
      const job = jobManager.getJob(jobId)

      expect(job?.background).toBe(true)
    })

    it('should increment job IDs for multiple jobs', () => {
      const jobId1 = jobManager.addJob('command 1', mockChildProcess as any)
      const jobId2 = jobManager.addJob('command 2', mockChildProcess as any)

      expect(jobId1).toBe(1)
      expect(jobId2).toBe(2)
    })

    it('should handle jobs without child process', () => {
      const jobId = jobManager.addJob('test command')
      const job = jobManager.getJob(jobId)

      expect(job?.pid).toBe(0)
      expect(job?.command).toBe('test command')
    })

    it('should emit jobAdded event when adding job', (done) => {
      jobManager.on('jobAdded', (event: JobEvent) => {
        expect(event.job.command).toBe('test command')
        done()
      })

      jobManager.addJob('test command', mockChildProcess as any)
    })
  })

  describe('job Status Management', () => {
    let jobId: number

    beforeEach(() => {
      jobId = jobManager.addJob('test command', mockChildProcess as any)
    })

    it('should get job by ID', () => {
      const job = jobManager.getJob(jobId)
      expect(job?.id).toBe(jobId)
      expect(job?.command).toBe('test command')
    })

    it('should return undefined for non-existent job', () => {
      const job = jobManager.getJob(999)
      expect(job).toBeUndefined()
    })

    it('should get all jobs', () => {
      const jobId2 = jobManager.addJob('command 2', mockChildProcess as any)
      const jobs = jobManager.getJobs()

      expect(jobs).toHaveLength(2)
      expect(jobs.map(j => j.id)).toEqual([jobId, jobId2])
    })

    it('should get jobs by status', () => {
      const job = jobManager.getJob(jobId)!
      job.status = 'stopped'

      const runningJobs = jobManager.getJobsByStatus('running')
      const stoppedJobs = jobManager.getJobsByStatus('stopped')

      expect(runningJobs).toHaveLength(0)
      expect(stoppedJobs).toHaveLength(1)
      expect(stoppedJobs[0].id).toBe(jobId)
    })
  })

  describe('job Control Operations', () => {
    let jobId: number

    beforeEach(() => {
      jobId = jobManager.addJob('test command', mockChildProcess as any)
    })

    it('should suspend a running job', () => {
      const success = jobManager.suspendJob(jobId)
      const job = jobManager.getJob(jobId)

      expect(success).toBe(true)
      expect(job?.status).toBe('stopped')
      expect(job?.background).toBe(true)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGSTOP')
    })

    it('should not suspend non-running job', () => {
      const job = jobManager.getJob(jobId)!
      job.status = 'stopped'

      const success = jobManager.suspendJob(jobId)
      expect(success).toBe(false)
    })

    it('should resume job in background', () => {
      const job = jobManager.getJob(jobId)!
      job.status = 'stopped'

      const success = jobManager.resumeJobBackground(jobId)

      expect(success).toBe(true)
      expect(job.status).toBe('running')
      expect(job.background).toBe(true)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGCONT')
    })

    it('should resume job in foreground', () => {
      const job = jobManager.getJob(jobId)!
      job.status = 'stopped'

      const success = jobManager.resumeJobForeground(jobId)

      expect(success).toBe(true)
      expect(job.status).toBe('running')
      expect(job.background).toBe(false)
      expect(jobManager.getForegroundJob()?.id).toBe(jobId)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGCONT')
    })

    it('should not resume non-stopped job', () => {
      const success = jobManager.resumeJobBackground(jobId)
      expect(success).toBe(false)
    })

    it('should terminate job with signal', () => {
      const success = jobManager.terminateJob(jobId, 'SIGTERM')

      expect(success).toBe(true)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGTERM')
    })

    it('should terminate job with default signal', () => {
      const success = jobManager.terminateJob(jobId)

      expect(success).toBe(true)
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGTERM')
    })

    it('should not terminate non-existent job', () => {
      const success = jobManager.terminateJob(999)
      expect(success).toBe(false)
    })

    it('should emit jobStatusChanged event on status change', (done) => {
      jobManager.on('jobStatusChanged', (event: JobEvent) => {
        expect(event.job.id).toBe(jobId)
        expect(event.previousStatus).toBe('running')
        expect(event.signal).toBe('SIGSTOP')
        done()
      })

      jobManager.suspendJob(jobId)
    })
  })

  describe('job Removal and Cleanup', () => {
    let jobId: number

    beforeEach(() => {
      jobId = jobManager.addJob('test command', mockChildProcess as any)
    })

    it('should remove completed job', () => {
      const job = jobManager.getJob(jobId)!
      job.status = 'done'

      const success = jobManager.removeJob(jobId)

      expect(success).toBe(true)
      expect(jobManager.getJob(jobId)).toBeUndefined()
    })

    it('should not remove running job', () => {
      const success = jobManager.removeJob(jobId)

      expect(success).toBe(false)
      expect(jobManager.getJob(jobId)).toBeDefined()
    })

    it('should cleanup completed jobs', () => {
      const jobId2 = jobManager.addJob('command 2', mockChildProcess as any)
      const job1 = jobManager.getJob(jobId)!
      const job2 = jobManager.getJob(jobId2)!

      job1.status = 'done'
      job2.status = 'running'

      const cleanedCount = jobManager.cleanupJobs()

      expect(cleanedCount).toBe(1)
      expect(jobManager.getJob(jobId)).toBeUndefined()
      expect(jobManager.getJob(jobId2)).toBeDefined()
    })

    it('should emit jobRemoved event when removing job', (done) => {
      const job = jobManager.getJob(jobId)!
      job.status = 'done'

      jobManager.on('jobRemoved', (event: JobEvent) => {
        expect(event.job.id).toBe(jobId)
        done()
      })

      jobManager.removeJob(jobId)
    })
  })

  describe('job Waiting', () => {
    let jobId: number

    beforeEach(() => {
      jobId = jobManager.addJob('test command', mockChildProcess as any)
    })

    it('should return immediately for completed job', async () => {
      const job = jobManager.getJob(jobId)!
      job.status = 'done'
      job.exitCode = 0

      const result = await jobManager.waitForJob(jobId)

      expect(result).toBe(job)
    })

    it('should wait for job completion', async () => {
      const waitPromise = jobManager.waitForJob(jobId)

      // Simulate job completion
      setTimeout(() => {
        const job = jobManager.getJob(jobId)!
        job.status = 'done'
        job.exitCode = 0
        jobManager.emit('jobStatusChanged', { job, previousStatus: 'running' })
      }, 10)

      const result = await waitPromise
      expect(result?.status).toBe('done')
    })

    it('should return null for non-existent job', async () => {
      const result = await jobManager.waitForJob(999)
      expect(result).toBeNull()
    })
  })

  describe('foreground Job Management', () => {
    it('should track foreground job', () => {
      const jobId = jobManager.addJob('fg command', mockChildProcess as any, false)

      expect(jobManager.getForegroundJob()?.id).toBe(jobId)
    })

    it('should not set background job as foreground', () => {
      jobManager.addJob('bg command', mockChildProcess as any, true)

      expect(jobManager.getForegroundJob()).toBeUndefined()
    })

    it('should clear foreground job when suspended', () => {
      const jobId = jobManager.addJob('fg command', mockChildProcess as any, false)

      jobManager.suspendJob(jobId)

      expect(jobManager.getForegroundJob()).toBeUndefined()
    })

    it('should set foreground job when resumed in foreground', () => {
      const jobId = jobManager.addJob('test command', mockChildProcess as any, false)
      jobManager.suspendJob(jobId)

      jobManager.resumeJobForeground(jobId)

      expect(jobManager.getForegroundJob()?.id).toBe(jobId)
    })
  })

  describe('error Handling', () => {
    it('should handle signal errors gracefully', () => {
      mockKill.mockImplementation(() => {
        throw new Error('Process not found')
      })

      const jobId = jobManager.addJob('test command', mockChildProcess as any)
      const success = jobManager.suspendJob(jobId)

      expect(success).toBe(false)
      expect(mockShell.log.error).toHaveBeenCalled()
    })

    it('should handle missing process gracefully', () => {
      const jobId = jobManager.addJob('test command')
      const success = jobManager.suspendJob(jobId)

      expect(success).toBe(false)
    })
  })

  describe('shutdown', () => {
    it('should terminate all running jobs on shutdown', () => {
      const jobId1 = jobManager.addJob('command 1', mockChildProcess as any)
      const jobId2 = jobManager.addJob('command 2', mockChildProcess as any)

      jobManager.shutdown()

      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGTERM')
      expect(mockKill).toHaveBeenCalledTimes(2)
    })

    it('should remove all event listeners on shutdown', () => {
      const removeAllListenersSpy = vi.spyOn(jobManager, 'removeAllListeners')

      jobManager.shutdown()

      expect(removeAllListenersSpy).toHaveBeenCalled()
    })
  })
})
