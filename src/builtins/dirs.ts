import type { BuiltinCommand, CommandResult, Shell } from './types'

function getStack(shell: Shell): string[] {
  return (shell as any)._dirStack ?? ((shell as any)._dirStack = [])
}

export const dirsCommand: BuiltinCommand = {
  name: 'dirs',
  description: 'Display the directory stack',
  usage: 'dirs',
  examples: [
    'dirs',
  ],
  async execute(_args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    const stack = getStack(shell)
    const list = [shell.cwd, ...stack]
    if (shell.config.verbose)
      shell.log.debug('[dirs] stack', list)
    return { exitCode: 0, stdout: `${list.join(' ')}\n`, stderr: '', duration: performance.now() - start }
  },
}
