import type { KrustyConfig } from '../src/types'
import { beforeEach, describe, expect, it } from 'bun:test'
import { KrustyShell } from '../src'

describe('pipeline streaming and redirections', () => {
  let shell: KrustyShell
  let config: KrustyConfig

  beforeEach(() => {
    config = {
      verbose: false,
      streamOutput: false,
      prompt: { format: '$ ' },
      history: { maxEntries: 100 },
      completion: { enabled: true },
      aliases: {},
      environment: {},
      plugins: [],
      theme: {},
      modules: {},
      hooks: {},
      logging: {},
    }
    shell = new KrustyShell(config)
  })

  it('streams external -> external (echo | tr)', async () => {
    const res = await shell.execute('/bin/echo hello | tr a-z A-Z')
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toBe('HELLO')
  })

  it('pseudo-streams builtin -> external (echo builtin -> wc -c)', async () => {
    const res = await shell.execute('echo hello | wc -c')
    expect(res.exitCode).toBe(0)
    // wc -c includes newline from echo -> 6
    expect(Number.parseInt(res.stdout.trim(), 10)).toBe(6)
  })

  it('respects stdout redirection on middle stage (do not double-pipe)', async () => {
    // Redirect middle stage stdout to a file; final stage should see nothing from it
    const cmd = 'printf \'a\n\' | sh -c \'cat > /tmp/krusty_mid.txt; echo X\' | wc -l'
    const res = await shell.execute(cmd)
    expect(res.exitCode).toBe(0)
    // Only the literal 'X' from the middle stage goes to pipe -> wc -l should be 1
    expect(Number.parseInt(res.stdout.trim(), 10)).toBe(1)
  })

  it('supports FD duplication 2>&1 across pipeline', async () => {
    const res = await shell.execute('sh -c \'echo out; echo err 1>&2\' 2>&1 | wc -l')
    expect(res.exitCode).toBe(0)
    // Both lines forwarded to stdout, then piped to wc -l -> 2
    expect(Number.parseInt(res.stdout.trim(), 10)).toBe(2)
  })

  it('supports here-string as stdin source (<<<)', async () => {
    const res = await shell.execute('tr a-z A-Z <<< "abc"')
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toBe('ABC')
  })
})
