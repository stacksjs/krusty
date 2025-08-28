import type { KrustyConfig } from '../src/types'
import { beforeEach, describe, expect, it } from 'bun:test'
import { KrustyShell } from '../src'

describe('pipefail option', () => {
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
      execution: {
        defaultTimeoutMs: 2000, // Shorter timeout for faster test execution
      },
    }
    shell = new KrustyShell(config)
  })

  it('defaults to non-pipefail behavior (exit code of last command)', async () => {
    const res = await shell.execute('false | true')
    expect(res.exitCode).toBe(0)
  }, 3000) // 3 second test timeout

  it('uses last non-zero exit when pipefail is enabled', async () => {
    // enable pipefail
    const setOn = await shell.execute('set -o pipefail')
    expect(setOn.exitCode).toBe(0)
    expect(shell.pipefail).toBe(true)

    const res1 = await shell.execute('false | true')
    expect(res1.exitCode).toBe(1)

    const res2 = await shell.execute('true | false | true')
    expect(res2.exitCode).toBe(1)

    // disable pipefail
    const setOff = await shell.execute('set +o pipefail')
    expect(setOff.exitCode).toBe(0)
    expect(shell.pipefail).toBe(false)

    const res3 = await shell.execute('false | true')
    expect(res3.exitCode).toBe(0)
  }, 5000) // 5 second test timeout
})
