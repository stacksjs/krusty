import type { BuiltinCommand, CommandResult, Job, Shell } from './types'

/**
 * Jobs command - lists background jobs
 * Shows job ID, status, and command for each background job
 */
export const jobsCommand: BuiltinCommand = {
  name: 'jobs',
  description: 'List background jobs',
  usage: 'jobs [-l]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    const showPid = args.includes('-l') || args.includes('--long')
    
    // Get all jobs
    const jobs = shell.getJobs()
    
    if (jobs.length === 0) {
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
      }
    }

    // Format job entries
    const jobEntries = jobs.map((job: Job) => {
      const statusSymbol = 
        job.status === 'running' ? 'running' :
        job.status === 'stopped' ? 'stopped' : 'done'
      
      let line = `[${job.id}] ${statusSymbol}`
      
      if (showPid && job.pid) {
        line += ` ${job.pid}`
      }
      
      line += ` ${job.command}`
      
      if (job.fg) {
        line += ' &'
      }
      
      return line
    })

    return {
      exitCode: 0,
      stdout: jobEntries.join('\n') + '\n',
      stderr: '',
      duration: performance.now() - start,
    }
  },
}
