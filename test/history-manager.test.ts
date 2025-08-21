import { describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HistoryManager } from '../src/history'

function tmpHistoryFile(name: string) {
  return join(tmpdir(), `krusty-test-${name}-${randomUUID()}.history`)
}

describe('HistoryManager - ignore rules and max entries', () => {
  it('respects ignoreSpace and ignoreDuplicates, and enforces maxEntries', async () => {
    const mgr = new HistoryManager({
      file: tmpHistoryFile('ignore'),
      ignoreSpace: true,
      ignoreDuplicates: true,
      maxEntries: 3,
      searchMode: 'exact',
    })

    await mgr.add('echo a')
    await mgr.add(' echo b') // leading space -> ignored
    await mgr.add('echo a') // consecutive duplicate -> ignored
    expect(mgr.getHistory()).toEqual(['echo a'])

    // Non-consecutive duplicate is allowed
    await mgr.add('ls')
    await mgr.add('echo a')
    expect(mgr.getHistory()).toEqual(['echo a', 'ls', 'echo a'])

    // Exceed maxEntries -> trims oldest
    await mgr.add('pwd')
    expect(mgr.getHistory()).toEqual(['ls', 'echo a', 'pwd'])
  })
})

describe('HistoryManager - search modes', () => {
  it('supports fuzzy, exact, startswith, and regex searches', async () => {
    const mgr = new HistoryManager({ file: tmpHistoryFile('search-modes') })

    await mgr.add('git status')
    await mgr.add('git commit')
    await mgr.add('grep foo')
    await mgr.add('echo hi')

    // Fuzzy (default): 'gs' should match 'git status'
    expect(mgr.search('gs')).toEqual(['git status'])

    // Exact (substring)
    ;(mgr as any).config.searchMode = 'exact'
    expect(mgr.search('it')).toEqual(['git status', 'git commit'])

    // Startswith
    ;(mgr as any).config.searchMode = 'startswith'
    expect(mgr.search('gi')).toEqual(['git status', 'git commit'])
    expect(mgr.search('g')).toEqual(['git status', 'git commit', 'grep foo'])

    // Regex
    ;(mgr as any).config.searchMode = 'regex'
    expect(mgr.search('g.*t\\s+status')).toEqual(['git status'])

    // Invalid regex -> empty results
    expect(mgr.search('[')).toEqual([])
  })
})

describe('HistoryManager - search limits', () => {
  it('applies config.searchLimit and per-call limit override', async () => {
    const mgr = new HistoryManager({
      file: tmpHistoryFile('search-limits'),
      searchMode: 'startswith',
      searchLimit: 1,
    })

    await mgr.add('git status')
    await mgr.add('git commit')
    await mgr.add('grep foo')

    // config.searchLimit=1 should clamp results when no explicit limit supplied
    expect(mgr.search('g')).toHaveLength(1)

    // Explicit limit should override config
    expect(mgr.search('g', 2)).toEqual(['git status', 'git commit'])
  })
})
