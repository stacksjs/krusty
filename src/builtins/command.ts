import type { BuiltinCommand, CommandResult, Shell } from './types'

// Minimal `command`: execute the given name and arguments.
// Note: true bypass of functions/aliases is not supported in current Shell API.
export const commandCommand: BuiltinCommand = {
  name: 'command',
  description: 'Run a command ignoring functions and aliases',
  usage: 'command name [args...]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    if (args.length === 0)
      return { exitCode: 2, stdout: '', stderr: 'command: name required\n', duration: performance.now() - start }

    // Reconstruct command string and execute via shell
    const cmd = args.join(' ')
    const res = await shell.execute(cmd)
    return { ...res, duration: performance.now() - start }
  },
}
