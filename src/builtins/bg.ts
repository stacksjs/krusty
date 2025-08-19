import type { BuiltinCommand, CommandResult, Shell } from './types'

/**
 * Background command - resumes a suspended job in the background
 * Usage: bg [%job_id]
 */
export const bgCommand: BuiltinCommand = {
  name: 'bg',
  description: 'Resume suspended jobs in the background',
  usage: 'bg [%job_id]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    if (shell.config.verbose)
      shell.log.debug('[bg] args: %o', args)

    // Parse job ID from argument
    let jobId: number | undefined
    if (args.length > 0) {
      const arg = args[0]
      if (arg.startsWith('%')) {
        jobId = Number.parseInt(arg.slice(1), 10)
      }
      else {
        jobId = Number.parseInt(arg, 10)
      }

      if (Number.isNaN(jobId)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `bg: invalid job id: ${arg}\n`,
          duration: performance.now() - start,
        }
      }
    }
    else {
      // Find the most recent stopped job
      const jobs = shell.getJobs()
      const stoppedJobs = jobs.filter(job => job.status === 'stopped')
      if (stoppedJobs.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'bg: no stopped jobs\n',
          duration: performance.now() - start,
        }
      }
      jobId = stoppedJobs[stoppedJobs.length - 1].id
    }

    if (shell.config.verbose)
      shell.log.debug('[bg] resuming job %d', jobId)

    // Find the job
    const job = shell.getJob(jobId)
    if (!job) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `bg: job not found: ${jobId}\n`,
        duration: performance.now() - start,
      }
    }

    if (job.status !== 'stopped') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `bg: job ${jobId} is not stopped\n`,
        duration: performance.now() - start,
      }
    }

    // Resume the job in background using enhanced job control
    const success = shell.resumeJobBackground?.(jobId)
    if (success) {
      return {
        exitCode: 0,
        stdout: `[${jobId}] ${job.command} &\n`,
        stderr: '',
        duration: performance.now() - start,
      }
    }
    else {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `bg: failed to resume job ${jobId}\n`,
        duration: performance.now() - start,
      }
    }
  },
}
