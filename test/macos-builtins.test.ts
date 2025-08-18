import { describe, expect, it } from 'bun:test'
import { createBuiltins } from '../src/builtins'
import type { Shell } from '../src/types'

// Minimal shell stub shared with other tests
function makeShell(): Shell {
  return {
    config: { verbose: false, streamOutput: false },
    cwd: process.cwd(),
    environment: process.env as unknown as Record<string, string>,
    history: [],
    aliases: {},
    builtins: createBuiltins(),
    log: console as any,

    async execute(cmd: string) {
      return this.executeCommand('sh', ['-c', cmd])
    },
    async executeCommand(command: string, args: string[]) {
      const proc = Bun.spawn([command, ...args], { stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const exitCode = await proc.exited
      return { exitCode, stdout, stderr, duration: 0 }
    },
    parseCommand: () => ({ commands: [] }),
    changeDirectory: () => true,
    reload: async () => ({ exitCode: 0, stdout: '', stderr: '', duration: 0 }),

    start: async () => {},
    stop: () => {},

    renderPrompt: async () => '$ ',

    addToHistory: () => {},
    searchHistory: () => [],

    getCompletions: () => [],

    jobs: [],
    addJob: () => 0,
    removeJob: () => {},
    getJob: () => undefined,
    getJobs: () => [],
    setJobStatus: () => {},
  }
}

function runBuiltin(shell: Shell, name: string, args: string[] = []) {
  const cmd = shell.builtins.get(name)
  if (!cmd) throw new Error(`Builtin not found: ${name}`)
  return cmd.execute(args, shell)
}

describe('macOS helper builtins', () => {
  it('reloaddns should complete or provide guidance', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'reloaddns')
    if (res.exitCode === 0) {
      expect(res.stdout).toContain('DNS cache')
    } else {
      expect(res.stderr).toMatch(/reloaddns:/)
    }
  })

  it('show should toggle Finder setting or fail gracefully', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'show')
    if (res.exitCode === 0)
      expect(res.stdout).toContain('Finder hidden files: ON')
    else
      expect(res.stderr).toMatch(/show:|unsupported/)
  })

  it('hide should toggle Finder setting or fail gracefully', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'hide')
    if (res.exitCode === 0)
      expect(res.stdout).toContain('Finder hidden files: OFF')
    else
      expect(res.stderr).toMatch(/hide:|unsupported/)
  })

  it('ft should attempt to restart Touch Bar or fail gracefully', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'ft')
    if (res.exitCode === 0)
      expect(res.stdout).toContain('Touch Bar')
    else
      expect(res.stderr).toMatch(/ft:|unsupported/)
  })

  it('emptytrash should run without throwing and be safe', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'emptytrash')
    if (res.exitCode === 0)
      expect(res.stdout).toContain('Trash')
    else
      expect(res.stderr).toMatch(/emptytrash:/)
  })

  it('dotfiles should print path or open it', async () => {
    const shell = makeShell()
    // Don’t rely on DOTFILES existence; builtin should still behave gracefully when missing
    const res = await runBuiltin(shell, 'dotfiles')
    if (res.exitCode === 0)
      expect(res.stdout.trim().length).toBeGreaterThan(0)
    else
      expect(res.stderr).toMatch(/dotfiles:/)
  })

  it('code should open current directory or return a helpful error', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'code')
    if (res.exitCode === 0)
      expect(res.stdout.trim().length).toBeGreaterThan(0)
    else
      expect(res.stderr).toMatch(/code:|not found/)
  })

  it('pstorm should open current directory or return a helpful error', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'pstorm')
    if (res.exitCode === 0)
      expect(res.stdout.trim().length).toBeGreaterThan(0)
    else
      expect(res.stderr).toMatch(/pstorm:|not found/)
  })
})
