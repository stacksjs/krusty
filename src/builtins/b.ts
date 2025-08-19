import type { BuiltinCommand, CommandResult, Shell } from './types'

export const bCommand: BuiltinCommand = {
  name: 'b',
  description: 'Run build via bun run build',
  usage: 'b',
  async execute(_args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    const prev = shell.config.streamOutput
    shell.config.streamOutput = false
    try {
      const hasBun = await shell.executeCommand('sh', ['-c', 'command -v bun >/dev/null 2>&1'])
      if (hasBun.exitCode !== 0)
        return { exitCode: 1, stdout: '', stderr: 'b: bun not found\n', duration: performance.now() - start }

      // Prefer package.json script if present
      const scriptCheck = await shell.executeCommand('sh', ['-c', 'test -f package.json && jq -e .scripts.build package.json >/dev/null 2>&1'])
      if (scriptCheck.exitCode === 0)
        return await shell.executeCommand('bun', ['run', 'build'])

      // Fallback to bun build src/index.ts
      const entry = 'src/index.ts'
      const res = await shell.executeCommand('bun', ['build', entry])
      if (res.exitCode === 0)
        return { exitCode: 0, stdout: res.stdout, stderr: '', duration: performance.now() - start }
      return { exitCode: res.exitCode || 1, stdout: '', stderr: res.stderr || 'b: build failed\n', duration: performance.now() - start }
    }
    finally {
      shell.config.streamOutput = prev
    }
  },
}
