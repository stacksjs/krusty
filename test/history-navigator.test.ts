import { describe, expect, it } from 'bun:test'
import { HistoryNavigator } from '../src/history/history-navigator'

describe('HistoryNavigator - basic browsing', () => {
  it('cycles through all entries including duplicates (most-recent first)', () => {
    const hist = ['ls', 'echo hi', 'ls', 'git status']
    const nav = new HistoryNavigator(hist)

    // initial state: not browsing, current is prefix (empty)
    expect(nav.isBrowsing()).toBeFalse()
    expect(nav.current()).toBe('')

    // up traverses most-recent first
    expect(nav.up()).toBe('git status') // index 3
    expect(nav.isBrowsing()).toBeTrue()
    expect(nav.up()).toBe('ls') // index 2 (duplicate kept)
    expect(nav.up()).toBe('echo hi') // index 1
    expect(nav.up()).toBe('ls') // index 0 (oldest)

    // boundary: further up stays on oldest
    expect(nav.up()).toBe('ls')

    // navigate down back towards editing state
    expect(nav.down()).toBe('echo hi') // 3 -> 2
    expect(nav.down()).toBe('ls') // 2 -> 1
    expect(nav.down()).toBe('git status')// 1 -> 0
    expect(nav.down()).toBe('') // 0 -> -1 (editing prefix)

    // boundary: further down stays at editing
    expect(nav.down()).toBe('')
  })
})

describe('HistoryNavigator - prefix filtering', () => {
  it('filters by prefix and resets browsing when prefix changes', () => {
    const hist = ['git status', 'grep foo', 'git commit', 'echo hi']
    const nav = new HistoryNavigator(hist)

    // Set prefix to 'g' -> matches 'git commit', 'grep foo', 'git status' (most-recent first)
    nav.setPrefix('g')
    expect(nav.isBrowsing()).toBeFalse()
    expect(nav.current()).toBe('g')

    // Up sequence over matches: most recent among matches is index 2 ('git commit')
    expect(nav.up()).toBe('git commit')
    expect(nav.up()).toBe('grep foo')
    expect(nav.up()).toBe('git status')
    // boundary on up
    expect(nav.up()).toBe('git status')
    // down sequence back to editing state
    expect(nav.down()).toBe('grep foo')
    expect(nav.down()).toBe('git commit')
    expect(nav.down()).toBe('g')

    // Change prefix -> resets browsing and recomputes list
    nav.setPrefix('gi')
    expect(nav.isBrowsing()).toBeFalse()
    expect(nav.current()).toBe('gi')
    expect(nav.up()).toBe('git commit')
    expect(nav.up()).toBe('git status')
    expect(nav.down()).toBe('git commit')
    expect(nav.down()).toBe('gi')
  })
})

describe('HistoryNavigator - boundaries and reset', () => {
  it('handles empty history and reset()', () => {
    const nav = new HistoryNavigator([])
    expect(nav.current()).toBe('')
    expect(nav.up()).toBe('')
    expect(nav.down()).toBe('')

    nav.setHistory(['a'])
    expect(nav.up()).toBe('a')
    expect(nav.down()).toBe('')

    nav.reset()
    expect(nav.isBrowsing()).toBeFalse()
    expect(nav.current()).toBe('')
  })
})

describe('HistoryNavigator - de-duplicates when keepDuplicates=false', () => {
  it('omits duplicate values while browsing', () => {
    const hist = ['a', 'a', 'b', 'a']
    const nav = new HistoryNavigator(hist, '', { keepDuplicates: false })

    expect(nav.up()).toBe('a')
    // further up should jump to 'b' (no second 'a')
    expect(nav.up()).toBe('b')
    // boundary at oldest unique
    expect(nav.up()).toBe('b')
    // down back towards editing state
    expect(nav.down()).toBe('a')
    expect(nav.down()).toBe('')
  })
})
