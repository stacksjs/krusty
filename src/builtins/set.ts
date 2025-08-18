import type { BuiltinCommand, CommandResult, Shell } from '../types'

export const setCommand: BuiltinCommand = {
  name: 'set',
  description: 'Set shell options and positional parameters or display variables',
  usage: 'set [-e] [name=value ...]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    // If no args: print all environment variables as KEY=VALUE, sorted
    if (args.length === 0) {
      const lines = Object.keys(shell.environment)
        .sort((a, b) => a.localeCompare(b))
        .map(k => `${k}=${shell.environment[k]}`)
        .join('\n')
      return {
        exitCode: 0,
        stdout: lines + (lines ? '\n' : ''),
        stderr: '',
        duration: performance.now() - start,
      }
    }

    // Simple option support: -e (ignored for now but succeed)
    let i = 0
    let sawE = false
    while (i < args.length && args[i].startsWith('-')) {
      const opt = args[i]
      if (opt === '--') {
        i++
        break
      }
      // handle combined flags like -ex; only -e recognized
      for (let j = 1; j < opt.length; j++) {
        const flag = opt[j]
        switch (flag) {
          case 'e':
            // could set a flag on shell.options if exists
            sawE = true
            break
          default:
            // ignore unknown flags for compatibility; continue
            break
        }
      }
      i++
    }

    // Remaining args should be NAME=VALUE pairs
    const assignments: Array<{ name: string, value: string }> = []
    for (; i < args.length; i++) {
      const tok = args[i]
      if (!tok)
        continue
      const eq = tok.indexOf('=')
      if (eq === -1)
        continue
      const name = tok.slice(0, eq)
      let value = tok.slice(eq + 1)
      // If value is wrapped in matching quotes, strip them
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1)
      }
      if (name)
        shell.environment[name] = value
      assignments.push({ name, value })
    }

    if (shell.config.verbose) {
      shell.log.debug('[set] flags: -e=%s, assignments: %o', String(sawE), assignments)
    }

    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: performance.now() - start,
    }
  },
}
