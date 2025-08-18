import type { Shell } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { createBuiltins } from '../src/builtins'

// Minimal shell stub
function makeShell(): Shell {
  return {
    config: { verbose: false, streamOutput: false },
    cwd: process.cwd(),
    environment: process.env as unknown as Record<string, string>,
    history: [],
    aliases: {},
    builtins: createBuiltins(),
    log: console as any,

    // Core methods (basic stubs sufficient for builtin execution)
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

    // REPL methods
    start: async () => {},
    stop: () => {},

    // Prompt methods
    renderPrompt: async () => '$ ',

    // History
    addToHistory: () => {},
    searchHistory: () => [],

    // Completion
    getCompletions: () => [],

    // Jobs API
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
  if (!cmd)
    throw new Error(`Builtin not found: ${name}`)
  return cmd.execute(args, shell)
}

describe('Network builtins', () => {
  it('ip should either fetch or fail gracefully', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'ip')
    if (res.exitCode === 0) {
      // Expect an IPv4 or IPv6 in output
      expect(/^(?:\d{1,3}\.){3}\d{1,3}|[a-f0-9:]+/im.test(res.stdout)).toBeTrue()
    }
    else {
      expect(res.stderr).toContain('ip:')
    }
  })

  it('localip should either list IPs or fail gracefully', async () => {
    const shell = makeShell()
    const res = await runBuiltin(shell, 'localip')
    if (res.exitCode === 0) {
      expect(res.stdout.trim().length).toBeGreaterThan(0)
    }
    else {
      expect(res.stderr).toContain('localip:')
    }
  })
})
