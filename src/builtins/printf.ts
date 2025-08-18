import type { BuiltinCommand, CommandResult, Shell } from './types'

function format(spec: string, args: string[]): string {
  let i = 0
  return spec.replace(/%[sdq%]/g, (m) => {
    if (m === '%%')
      return '%'
    const arg = args[i++] ?? ''
    switch (m) {
      case '%s': return String(arg)
      case '%d': return String(Number(arg))
      case '%q': return JSON.stringify(String(arg))
      default: return m
    }
  })
}

export const printfCommand: BuiltinCommand = {
  name: 'printf',
  description: 'Format and print data',
  usage: 'printf format [arguments...]',
  examples: [
    'printf "%s %d" hello 42',
    'printf %q "a b"',
    'printf "%%s is literal"',
  ],
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    if (shell.config.verbose)
      shell.log.debug('[printf] args:', args.join(' '))
    if (args.length === 0)
      return { exitCode: 1, stdout: '', stderr: 'printf: missing format string\n', duration: performance.now() - start }

    const fmt = args.shift()!
    const out = format(fmt, args)
    if (shell.config.verbose)
      shell.log.debug('[printf] format:', fmt, 'out.len:', out.length)
    return { exitCode: 0, stdout: out, stderr: '', duration: performance.now() - start }
  },
}
