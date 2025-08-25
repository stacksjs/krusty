import type { BuiltinCommand, CommandResult, Shell } from './types'

export const bbCommand: BuiltinCommand = {
  name: 'bb',
  description: 'Run build script via bun run build',
  usage: 'bb [args...]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    const prev = shell.config.streamOutput
    shell.config.streamOutput = false
    try {
      const hasBun = await shell.executeCommand('sh', ['-c', 'command -v bun >/dev/null 2>&1'])
      if (hasBun.exitCode !== 0)
        return { exitCode: 1, stdout: '', stderr: 'bb: bun not found\n', duration: performance.now() - start }

      // Always use bun run build with any passed args
      const cmd = ['bun', 'run', 'build', ...args]
      const echo = `$ ${cmd.join(' ')}\n`
      const res = await shell.executeCommand('bun', ['run', 'build', ...args])
      if (res.exitCode === 0)
        return { exitCode: 0, stdout: echo + (res.stdout || ''), stderr: '', duration: performance.now() - start }
      return { exitCode: res.exitCode || 1, stdout: echo + (res.stdout || ''), stderr: res.stderr || 'bb: build failed\n', duration: performance.now() - start }
    }
    finally {
      shell.config.streamOutput = prev
    }
  },
}
