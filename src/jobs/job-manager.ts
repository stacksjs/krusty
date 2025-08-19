import type { ChildProcess } from 'node:child_process'
import type { Shell } from '../types'
import { EventEmitter } from 'node:events'
import process from 'node:process'

export interface Job {
  id: number
  pid: number
  pgid: number
  command: string
  status: 'running' | 'stopped' | 'done'
  process?: ChildProcess
  background: boolean
  startTime: number
  endTime?: number
  exitCode?: number
  signal?: string
}

export interface JobEvent {
  job: Job
  previousStatus?: Job['status']
  signal?: string
  exitCode?: number
}

/**
 * Enhanced Job Manager with robust signal handling, process groups, and real-time monitoring
 */
export class JobManager extends EventEmitter {
  private jobs = new Map<number, Job>()
  private nextJobId = 1
  private shell: Shell
  private signalHandlers = new Map<string, (signal: string) => void>()
  private monitoringInterval?: NodeJS.Timeout
  private foregroundJob?: Job

  constructor(shell: Shell) {
    super()
    this.shell = shell
    this.setupSignalHandlers()
    this.startBackgroundMonitoring()
  }

  /**
   * Setup robust signal handling for job control
   */
  private setupSignalHandlers(): void {
    // Handle Ctrl+Z (SIGTSTP) - suspend foreground job
    const sigtstpHandler = () => {
      if (this.foregroundJob && this.foregroundJob.status === 'running') {
        this.suspendJob(this.foregroundJob.id)
        this.shell.log.info(`\n[${this.foregroundJob.id}]+ Stopped ${this.foregroundJob.command}`)
      } else {
        // If no foreground job, just show message
        this.shell.log.info('\n(To exit, press Ctrl+D or type "exit")')
      }
    }

    // Handle Ctrl+C (SIGINT) - terminate foreground job
    const sigintHandler = () => {
      if (this.foregroundJob && this.foregroundJob.status === 'running') {
        this.terminateJob(this.foregroundJob.id, 'SIGINT')
      } else {
        this.shell.log.info('\n(To exit, press Ctrl+D or type "exit")')
      }
    }

    // Store handlers for cleanup
    this.signalHandlers.set('SIGTSTP', sigtstpHandler)
    this.signalHandlers.set('SIGINT', sigintHandler)

    // Register signal handlers
    process.on('SIGTSTP', sigtstpHandler)
    process.on('SIGINT', sigintHandler)

    // Handle child process signals
    process.on('SIGCHLD', () => {
      this.checkJobStatuses()
    })
  }

  /**
   * Start real-time background process monitoring
   */
  private startBackgroundMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.checkJobStatuses()
    }, 1000) // Check every second
  }

  /**
   * Check and update job statuses
   */
  private checkJobStatuses(): void {
    for (const job of this.jobs.values()) {
      if (job.status === 'done') continue

      try {
        // Check if process is still running
        if (job.pid) {
          process.kill(job.pid, 0) // Signal 0 just checks if process exists
        }
      } catch (error: any) {
        if (error.code === 'ESRCH') {
          // Process no longer exists
          const previousStatus = job.status
          job.status = 'done'
          job.endTime = Date.now()
          
          this.emit('jobStatusChanged', {
            job,
            previousStatus,
          } as JobEvent)

          // Notify about completed background jobs
          if (job.background && previousStatus === 'running') {
            this.shell.log.info(`[${job.id}] Done ${job.command}`)
          }
        }
      }
    }
  }

  /**
   * Add a new job with proper process group management
   */
  addJob(command: string, childProcess?: ChildProcess, background = false): number {
    const jobId = this.nextJobId++
    const pid = childProcess?.pid || 0
    
    // Create new process group for job control
    let pgid = pid
    if (childProcess && pid > 0) {
      try {
        // Set process group ID to enable job control using setgid as a fallback
        // Note: setpgid is not available in Node.js process API, using alternative approach
        if (typeof (process as any).setpgid === 'function') {
          (process as any).setpgid(pid, pid)
        }
        pgid = pid
      } catch (error) {
        this.shell.log.warn(`Failed to set process group for job ${jobId}:`, error)
        pgid = pid
      }
    }

    const job: Job = {
      id: jobId,
      pid,
      pgid,
      command,
      status: 'running',
      process: childProcess,
      background,
      startTime: Date.now(),
    }

    this.jobs.set(jobId, job)

    // Set as foreground job if not background
    if (!background) {
      this.foregroundJob = job
    }

    // Setup process event handlers
    if (childProcess) {
      childProcess.on('exit', (code, signal) => {
        this.handleJobExit(jobId, code, signal)
      })

      childProcess.on('error', (error) => {
        this.shell.log.error(`Job ${jobId} error:`, error)
        this.handleJobExit(jobId, 1, null)
      })
    }

    this.emit('jobAdded', { job } as JobEvent)
    return jobId
  }

  /**
   * Handle job exit
   */
  private handleJobExit(jobId: number, exitCode: number | null, signal: string | null): void {
    const job = this.jobs.get(jobId)
    if (!job) return

    const previousStatus = job.status
    job.status = 'done'
    job.endTime = Date.now()
    job.exitCode = exitCode || 0
    job.signal = signal || undefined

    // Clear foreground job if this was it
    if (this.foregroundJob?.id === jobId) {
      this.foregroundJob = undefined
    }

    this.emit('jobStatusChanged', {
      job,
      previousStatus,
      exitCode: exitCode || 0,
      signal: signal || undefined,
    } as JobEvent)

    // Notify about completed background jobs
    if (job.background && previousStatus !== 'done') {
      const statusMsg = signal ? `terminated by ${signal}` : `exited with code ${exitCode}`
      this.shell.log.info(`[${job.id}] ${statusMsg} ${job.command}`)
    }
  }

  /**
   * Suspend a job (Ctrl+Z functionality)
   */
  suspendJob(jobId: number): boolean {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== 'running') {
      return false
    }

    try {
      if (job.pgid > 0) {
        // Send SIGSTOP to the entire process group
        process.kill(-job.pgid, 'SIGSTOP')
      } else if (job.pid > 0) {
        process.kill(job.pid, 'SIGSTOP')
      }

      const previousStatus = job.status
      job.status = 'stopped'
      job.background = true // Suspended jobs become background jobs

      // Clear foreground job
      if (this.foregroundJob?.id === jobId) {
        this.foregroundJob = undefined
      }

      this.emit('jobStatusChanged', {
        job,
        previousStatus,
        signal: 'SIGSTOP',
      } as JobEvent)

      return true
    } catch (error) {
      this.shell.log.error(`Failed to suspend job ${jobId}:`, error)
      return false
    }
  }

  /**
   * Resume a job in background
   */
  resumeJobBackground(jobId: number): boolean {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== 'stopped') {
      return false
    }

    try {
      if (job.pgid > 0) {
        // Send SIGCONT to the entire process group
        process.kill(-job.pgid, 'SIGCONT')
      } else if (job.pid > 0) {
        process.kill(job.pid, 'SIGCONT')
      }

      const previousStatus = job.status
      job.status = 'running'
      job.background = true

      this.emit('jobStatusChanged', {
        job,
        previousStatus,
        signal: 'SIGCONT',
      } as JobEvent)

      return true
    } catch (error) {
      this.shell.log.error(`Failed to resume job ${jobId} in background:`, error)
      return false
    }
  }

  /**
   * Resume a job in foreground
   */
  resumeJobForeground(jobId: number): boolean {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== 'stopped') {
      return false
    }

    try {
      if (job.pgid > 0) {
        // Send SIGCONT to the entire process group
        process.kill(-job.pgid, 'SIGCONT')
      } else if (job.pid > 0) {
        process.kill(job.pid, 'SIGCONT')
      }

      const previousStatus = job.status
      job.status = 'running'
      job.background = false
      this.foregroundJob = job

      this.emit('jobStatusChanged', {
        job,
        previousStatus,
        signal: 'SIGCONT',
      } as JobEvent)

      return true
    } catch (error) {
      this.shell.log.error(`Failed to resume job ${jobId} in foreground:`, error)
      return false
    }
  }

  /**
   * Terminate a job with specified signal
   */
  terminateJob(jobId: number, signal: string = 'SIGTERM'): boolean {
    const job = this.jobs.get(jobId)
    if (!job || job.status === 'done') {
      return false
    }

    try {
      if (job.pgid > 0) {
        // Send signal to the entire process group
        process.kill(-job.pgid, signal)
      } else if (job.pid > 0) {
        process.kill(job.pid, signal)
      }

      // If it's the foreground job, clear it
      if (this.foregroundJob?.id === jobId) {
        this.foregroundJob = undefined
      }

      return true
    } catch (error) {
      this.shell.log.error(`Failed to terminate job ${jobId}:`, error)
      return false
    }
  }

  /**
   * Remove a job from the job table
   */
  removeJob(jobId: number): boolean {
    const job = this.jobs.get(jobId)
    if (!job) {
      return false
    }

    // Can only remove completed jobs
    if (job.status !== 'done') {
      return false
    }

    this.jobs.delete(jobId)
    this.emit('jobRemoved', { job } as JobEvent)
    return true
  }

  /**
   * Get a specific job
   */
  getJob(jobId: number): Job | undefined {
    return this.jobs.get(jobId)
  }

  /**
   * Get all jobs
   */
  getJobs(): Job[] {
    return Array.from(this.jobs.values())
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: Job['status']): Job[] {
    return Array.from(this.jobs.values()).filter(job => job.status === status)
  }

  /**
   * Get the current foreground job
   */
  getForegroundJob(): Job | undefined {
    return this.foregroundJob
  }

  /**
   * Wait for a specific job to complete
   */
  async waitForJob(jobId: number): Promise<Job | null> {
    const job = this.jobs.get(jobId)
    if (!job) {
      return null
    }

    if (job.status === 'done') {
      return job
    }

    return new Promise((resolve) => {
      const handler = (event: JobEvent) => {
        if (event.job.id === jobId && event.job.status === 'done') {
          this.off('jobStatusChanged', handler)
          resolve(event.job)
        }
      }
      this.on('jobStatusChanged', handler)
    })
  }

  /**
   * Clean up completed jobs
   */
  cleanupJobs(): number {
    const completedJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.status === 'done')
    
    for (const [jobId] of completedJobs) {
      this.jobs.delete(jobId)
    }

    return completedJobs.length
  }

  /**
   * Shutdown job manager and cleanup
   */
  shutdown(): void {
    // Clear monitoring interval
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
    }

    // Remove signal handlers
    for (const [signal, handler] of this.signalHandlers) {
      process.off(signal as any, handler)
    }

    // Terminate all running jobs
    for (const job of this.jobs.values()) {
      if (job.status === 'running' || job.status === 'stopped') {
        this.terminateJob(job.id, 'SIGTERM')
      }
    }

    this.removeAllListeners()
  }
}
