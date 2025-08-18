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
      if (isNaN(id)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `fg: ${args[0]}: no such job\n`,
          duration: performance.now() - start,
        }
      }
      jobId = id
    }

    // Find the job
    const job = shell.getJob(jobId)
    if (!job) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `fg: ${jobId}: no such job\n`,
        duration: performance.now() - start,
      }
    }

    // Mark the job as running in the foreground
    shell.setJobStatus(jobId, 'running')

    // In a real shell, this would actually bring the process to the foreground
    // For now, we'll just update the job status

    return {
      exitCode: 0,
      stdout: `${job.command}\n`,
      stderr: '',
      duration: performance.now() - start,
    }
  },
}
