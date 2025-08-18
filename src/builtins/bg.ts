import type { BuiltinCommand, CommandResult, Shell } from './types'

/**
 * Bg command - run a job in the background
 * Resumes a stopped job in the background
 */
export const bgCommand: BuiltinCommand = {
  name: 'bg',
  description: 'Run a job in the background',
  usage: 'bg [job_id...]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    // Get all jobs
    const jobs = shell.getJobs()

    if (jobs.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'bg: no current job\n',
        duration: performance.now() - start,
      }
    }

    // If no job IDs provided, use the most recent stopped job
    const jobIds = args.length > 0
      ? args.map(id => Number.parseInt(id, 10)).filter(id => !Number.isNaN(id))
      : [jobs[jobs.length - 1]?.id].filter(Boolean) as number[]
    if (shell.config.verbose)
      shell.log.debug('[bg] parsed jobIds=%o', jobIds)

    if (jobIds.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'bg: no current job\n',
        duration: performance.now() - start,
      }
    }

    const results: string[] = []
    let hasError = false

    for (const jobId of jobIds) {
      const job = shell.getJob(jobId)

      if (!job) {
        hasError = true
        results.push(`bg: ${jobId}: no such job`)
        continue
      }

      if (job.status === 'running') {
        results.push(`[${jobId}] ${job.command} (already running)`)
      }
      else {
        // Mark the job as running in the background
        shell.setJobStatus(jobId, 'running')
        if (shell.config.verbose)
          shell.log.debug('[bg] set job %d to running (background)', jobId)
        results.push(`[${jobId}] ${job.command} &`)
      }
    }

    const res: CommandResult = {
      exitCode: hasError ? 1 : 0,
      stdout: `${results.join('\n')}\n`,
      stderr: hasError ? `${results.filter(r => r.startsWith('bg: ')).join('\n')}\n` : '',
      duration: performance.now() - start,
    }
    if (shell.config.verbose)
      shell.log.debug('[bg] done hasError=%s in %dms', String(hasError), Math.round(res.duration))
    return res
  },
}
