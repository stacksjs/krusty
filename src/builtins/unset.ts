import type { BuiltinCommand, CommandResult, Shell } from './types'

export const unsetCommand: BuiltinCommand = {
  name: 'unset',
  description: 'Unset (remove) shell variables',
  usage: 'unset name [name ...]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    for (const name of args) {
      if (!name)
        continue
      // Remove from environment if present
      delete (shell.environment as Record<string, unknown>)[name]
    }

    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: performance.now() - start,
    }
  },
}
