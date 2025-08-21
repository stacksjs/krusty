import type { KrustyConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { KrustyShell } from '../src/shell'

describe('Aliases + Chaining Integration', () => {
  let shell: KrustyShell

  beforeEach(() => {
    const config: KrustyConfig = {
      verbose: false,
      streamOutput: false,
      prompt: { format: '$ ' },
      history: { maxEntries: 100 },
      completion: { enabled: true },
      aliases: {
        a: 'echo A',
        ok: 'true',
        fail: 'false',
      },
      environment: {},
      plugins: [],
      theme: {},
      modules: {},
      hooks: {},
      logging: {},
    }
    shell = new KrustyShell(config)
  })

  afterEach(() => {
    shell.stop()
  })

  it('expands alias on left of && and executes right when success', async () => {
    const res = await shell.execute('a && echo B')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('A')
    expect(res.stdout).toContain('B')
  })

  it('short-circuits && when alias fails', async () => {
    const res = await shell.execute('fail && echo should-not-run')
    expect(res.exitCode).not.toBe(0)
    expect(res.stdout).not.toContain('should-not-run')
  })

  it('uses || fallback when alias fails', async () => {
    const res = await shell.execute('fail || echo Fallback')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Fallback')
  })

  it('handles pipelines within alias-expanded segments', async () => {
    // Use builtin-only consumer to avoid external process stdin edge cases.
    const res = await shell.execute('a | true && echo ok')
    expect(res.exitCode).toBe(0)
    // Last pipeline command is true, so no output from pipeline; only echo ok should appear
    expect(res.stdout).not.toContain('A')
    expect(res.stdout).toContain('ok')
  })
})
