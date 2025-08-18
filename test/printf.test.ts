import type { KrustyConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { defaultConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

describe('printf builtin', () => {
  let shell: KrustyShell
  let testConfig: KrustyConfig

  beforeEach(() => {
    testConfig = {
      ...defaultConfig,
      verbose: false,
      history: { ...defaultConfig.history, file: `/tmp/test_history_printf_${Math.random().toString(36).slice(2)}` },
    }
    shell = new KrustyShell(testConfig)
  })

  afterEach(() => {
    shell.stop()
  })

  it('errors when no format is provided', async () => {
    const res = await shell.execute('printf')
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('printf: missing format string\n')
  })

  it('prints strings and numbers with %s and %d', async () => {
    const res = await shell.execute('printf "%s %d" hello 42')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe('hello 42')
  })

  it('prints literal percent with %%', async () => {
    const res = await shell.execute('printf "%%s %%" ignored')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe('%s %')
  })

  it('quotes with %q', async () => {
    const res = await shell.execute('printf %q "a b"')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe('"a b"')
  })
})
