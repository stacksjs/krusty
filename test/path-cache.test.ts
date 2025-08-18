import type { Shell } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompletionProvider } from '../src/completion'

function createExecutable(dir: string, name: string, content = '#!/bin/sh\necho ok\n') {
  const p = join(dir, name)
  writeFileSync(p, content, { encoding: 'utf8' })
  chmodSync(p, 0o755)
  return p
}

describe('PATH command cache', () => {
  let tmp1: string
  let tmp2: string
  let originalPATH: string | undefined

  const makeShell = (): Shell => ({
    config: { completion: { enabled: true, caseSensitive: false, maxSuggestions: 100 } } as any,
    cwd: process.cwd(),
    builtins: new Map(),
    aliases: {},
    environment: {},
  } as any)

  beforeEach(() => {
    tmp1 = mkdtempSync(join(tmpdir(), 'krusty-path-1-'))
    tmp2 = mkdtempSync(join(tmpdir(), 'krusty-path-2-'))
    originalPATH = process.env.PATH
  })

  afterEach(() => {
    try {
      rmSync(tmp1, { recursive: true, force: true })
    }
    catch {}
    try {
      rmSync(tmp2, { recursive: true, force: true })
    }
    catch {}
    if (originalPATH !== undefined)
      process.env.PATH = originalPATH
  })

  it('uses cached PATH results within 30s and refreshes after expiry', () => {
    // Setup first PATH dir with foo
    createExecutable(tmp1, 'foo')
    process.env.PATH = `${tmp1}`

    const shell = makeShell()
    const provider = new CompletionProvider(shell)

    // First query populates cache
    const first = (provider as any).getCompletions('f', 1)
    expect(first).toContain('foo')

    // Change PATH to new dir with bar; within cache window should still return foo
    createExecutable(tmp2, 'bar')
    process.env.PATH = `${tmp2}`

    const second = (provider as any).getCompletions('b', 1)
    // Should NOT see bar yet due to cache; also since prefix is 'b', builtins/aliases none
    expect(second.includes('bar')).toBe(false)

    // Expire cache by rewinding lastCacheUpdate
    ;(provider as any).lastCacheUpdate = Date.now() - 31000

    const third = (provider as any).getCompletions('b', 1)
    expect(third).toContain('bar')
  })
})
