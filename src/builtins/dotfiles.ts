import type { BuiltinCommand, CommandResult, Shell } from './types'
import process from 'node:process'

export const dotfilesCommand: BuiltinCommand = {
  name: 'dotfiles',
  description: 'Open $DOTFILES in VS Code when available, otherwise try macOS open, else print the path',
  usage: 'dotfiles',
  async execute(_args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    const dotfiles = shell.environment.DOTFILES || process.env.DOTFILES
    if (!dotfiles) {
      return { exitCode: 1, stdout: '', stderr: 'dotfiles: DOTFILES environment variable is not set\n', duration: performance.now() - start }
    }

    const prevStream = shell.config.streamOutput
    shell.config.streamOutput = false

    try {
      // Prefer 'code' CLI if present
      const hasCode = await shell.executeCommand('sh', ['-c', 'command -v code >/dev/null 2>&1'])
      if (hasCode.exitCode === 0) {
        await shell.executeCommand('code', [dotfiles])
        return { exitCode: 0, stdout: `${dotfiles}\n`, stderr: '', duration: performance.now() - start }
      }

      // Fallback to macOS open
      const hasOpen = await shell.executeCommand('sh', ['-c', 'command -v open >/dev/null 2>&1'])
      if (hasOpen.exitCode === 0) {
        await shell.executeCommand('open', ['-a', 'Visual Studio Code', dotfiles])
        return { exitCode: 0, stdout: `${dotfiles}\n`, stderr: '', duration: performance.now() - start }
      }

      // Otherwise just print the path (user can act on it)
      return { exitCode: 0, stdout: `${dotfiles}\n`, stderr: '', duration: performance.now() - start }
    }
    finally {
      shell.config.streamOutput = prevStream
    }
  },
}
