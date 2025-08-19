import type { BuiltinCommand, CommandResult, Shell } from './types'

export const disownCommand: BuiltinCommand = {
  name: 'disown',
  description: 'Remove jobs from the job table',
  usage: 'disown [job_id...]',
  examples: [
    'disown             # disown the most recent job',
    'disown %1 %2       # disown jobs by id',
  ],
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    const jobs = shell.getJobs()

    if (jobs.length === 0) {
      return { exitCode: 0, stdout: '', stderr: '', duration: performance.now() - start }
    }

    const jobIds: number[] = args.length > 0
      ? args
          .map(a => (a.startsWith('%') ? Number.parseInt(a.slice(1), 10) : Number.parseInt(a, 10)))
          .filter((n): n is number => !Number.isNaN(n))
      : [jobs[jobs.length - 1]?.id]
          .filter((n): n is number => typeof n === 'number')

    const errors: string[] = []
    if (shell.config.verbose)
      shell.log.debug('[disown] requested ids:', args.join(' '))
    for (const jid of jobIds) {
      const job = shell.getJob(jid)
      if (!job) {
        errors.push(`disown: ${jid}: no such job`)
        continue
      }
      if (typeof job.pid !== 'number') {
        errors.push(`disown: ${jid}: job has no pid`)
        continue
      }
      // Remove the job by its ID, not its PID
      const removed = shell.removeJob(job.id)
      if (!removed) {
        errors.push(`disown: ${jid}: failed to remove job`)
      }
    }

    return {
      exitCode: errors.length ? 1 : 0,
      stdout: '',
      stderr: errors.length ? `${errors.join('\n')}\n` : '',
      duration: performance.now() - start,
    }
  },
}
