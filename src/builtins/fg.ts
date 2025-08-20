import type { BuiltinCommand, CommandResult, Shell } from './types'

/**
 * Fg command - bring a background job to the foreground
 * Resumes a stopped job or brings a background job to the foreground
 */
export const fgCommand: BuiltinCommand = {
  name: 'fg',
  description: 'Bring a background job to the foreground',
  usage: 'fg [job_id]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    // Get all jobs
    const jobs = shell.getJobs()

    if (jobs.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'fg: no current job\n',
        duration: performance.now() - start,
      }
    }

    let jobId: number

    // If no job ID is provided, use the most recent job
    if (args.length === 0) {
      const lastJob = jobs[jobs.length - 1]
      if (!lastJob) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'fg: no current job\n',
          duration: performance.now() - start,
        }
      }
      jobId = lastJob.id
    }
    else {
      // Parse the job ID from the argument
      const id = Number.parseInt(args[0], 10)
      if (Number.isNaN(id)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `fg: ${args[0]}: no such job\n`,
          duration: performance.now() - start,
        }
      }
      jobId = id
    }
    if (shell.config.verbose)
      shell.log.debug('[fg] parsed jobId=%s', String(jobId))

    // Find the job
    const job = shell.getJob(jobId)
    if (!job) {
      if (shell.config.verbose)
        shell.log.debug('[fg] job not found: %d', jobId)
      return {
        exitCode: 1,
        stdout: '',
        stderr: `fg: ${jobId}: no such job\n`,
        duration: performance.now() - start,
      }
    }

    // Resume the job in foreground using enhanced job control
    const success = shell.resumeJobForeground?.(jobId)
    if (success) {
      if (shell.config.verbose)
        shell.log.debug('[fg] set job %d to running (foreground)', jobId)

      // Wait for the job to complete if waitForJob is available
      if (shell.waitForJob) {
        try {
          const completedJob = await shell.waitForJob(jobId)
          if (completedJob) {
            return {
              exitCode: completedJob.exitCode || 0,
              stdout: `${job.command}\n`,
              stderr: '',
              duration: performance.now() - start,
            }
          }
        }
        catch (error) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `fg: error waiting for job ${jobId}: ${error}\n`,
            duration: performance.now() - start,
          }
        }
      }

      const res: CommandResult = {
        exitCode: 0,
        stdout: `${job.command}\n`,
        stderr: '',
        duration: performance.now() - start,
      }
      if (shell.config.verbose)
        shell.log.debug('[fg] done in %dms', Math.round(res.duration))
      return res
    }
    else {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `fg: failed to resume job ${jobId}\n`,
        duration: performance.now() - start,
      }
    }
  },
}
