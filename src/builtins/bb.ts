import type { BuiltinCommand, CommandResult, Shell } from './types'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

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

      // Build styled echo lines with nested script expansion
      const echoLines: string[] = []
      const styleEcho = (line: string) => {
        // Light purple-ish for '$', dim for the command
        const purple = '\x1B[38;2;199;146;234m'
        const dim = '\x1B[2m'
        const reset = '\x1B[0m'
        return `${purple}$${reset} ${dim}${line}${reset}`
      }

      echoLines.push(styleEcho(cmd.join(' ')))

      // Try to read package.json scripts to expand nested scripts
      try {
        const pkgPath = join(process.cwd(), 'package.json')
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
          const scripts = pkg.scripts || {}
          const buildScript = scripts.build
          if (buildScript) {
            echoLines.push(styleEcho(buildScript))
            // Heuristic: if build script triggers 'bun run compile', also echo compile script
            if (/\bbun\s+run\s+compile\b/.test(buildScript)) {
              const compileScript = scripts.compile
              if (compileScript)
                echoLines.push(styleEcho(compileScript))
            }
          }
        }
      }
      catch {
        // ignore echo expansion errors
      }

      const echo = `${echoLines.join('\n')}\n`
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
