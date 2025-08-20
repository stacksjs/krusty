import type { BuiltinCommand, CommandResult, Shell } from '../types'

export const envCommand: BuiltinCommand = {
  name: 'env',
  description: 'Print the environment',
  usage: 'env',
  async execute(_args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    // Ensure PWD is present and correct
    try {
      if (shell.cwd)
        shell.environment.PWD = shell.cwd
    }
    catch {}

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
  },
}
