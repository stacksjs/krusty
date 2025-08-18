import type { BuiltinCommand, CommandResult, Shell } from './types'

export const waitCommand: BuiltinCommand = {
  name: 'wait',
  description: 'Wait for background jobs or PIDs to finish',
  usage: 'wait [job_id|pid]...',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    // Minimal implementation: if specific job ids provided, ensure they exist; otherwise succeed.
    const ids = args.length > 0 ? args : []
    let exitCode = 0
    const errors: string[] = []

    for (const id of ids) {
      if (id.startsWith('%')) {
        const jid = Number.parseInt(id.slice(1), 10)
        const job = shell.getJob(jid)
        if (!job) {
          exitCode = 1
          errors.push(`wait: ${id}: no such job`)
        }
        // In this shell implementation we don't track completion listeners; treat as immediate success if exists
      }
      else {
        const pid = Number.parseInt(id, 10)
        if (Number.isNaN(pid)) {
          exitCode = 1
          errors.push(`wait: ${id}: invalid id`)
        }
        // No direct pid tracking; consider it done
      }
    }

    return {
      exitCode,
      stdout: '',
      stderr: errors.length ? `${errors.join('\n')}\n` : '',
      duration: performance.now() - start,
    }
  },
}
