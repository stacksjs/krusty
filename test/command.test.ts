import type { KrustyConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { defaultConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

describe('command builtin', () => {
  let shell: KrustyShell
  let testConfig: KrustyConfig

  beforeEach(() => {
    testConfig = {
      ...defaultConfig,
      verbose: false,
      history: {
        ...defaultConfig.history,
        file: `/tmp/test_history_command_${Math.random().toString(36).slice(2)}`,
      },
    }
    shell = new KrustyShell(testConfig)
  })

  afterEach(() => {
    shell.stop()
  })

  it('errors when no arguments are provided', async () => {
    const res = await shell.execute('command')
    expect(res.exitCode).toBe(2)
    expect(res.stderr).toContain('command: name required')
  })

  it('executes the provided command string (current behavior: aliases still expand)', async () => {
    // Given an alias ll -> echo hi
    shell.aliases.ll = 'echo hi'

    // Using command ll still goes through shell.execute(), which expands aliases currently
    const res = await shell.execute('command ll')
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toBe('hi')

    // Note: once a real bypass is implemented in shell.execute(), this test should be updated
    // to assert that aliases/functions are skipped (e.g., command ll should NOT expand alias).
  })
})
