/* eslint-disable dot-notation */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { AutoSuggestInput } from '../src/input/auto-suggest'

// Shared stdout mocking like in auto-suggest-input.test.ts
let mockOutput = ''
const originalWrite = process.stdout.write
function mockStdout() {
  mockOutput = ''
  process.stdout.write = mock((chunk: any) => {
    mockOutput += chunk.toString()
    return true
  })
}
function restoreStdout() {
  process.stdout.write = originalWrite
}

// Helper to build grouped results
function groupsOf<T extends string | { text: string }>(...defs: Array<{ title: string, items: T[] }>) {
  return defs
}

describe('Grouped completions', () => {
  beforeEach(() => {
    mockStdout()
  })
  afterEach(() => {
    restoreStdout()
  })

  it('renders grouped suggestion list with headers and selection', () => {
    const shell = {
      getCompletions: mock(() => groupsOf(
        { title: 'Commands', items: ['git', 'grep'] },
        { title: 'Files', items: [{ text: 'README.md' }, { text: 'package.json' }] },
      )),
      config: { completion: { enabled: true } },
      history: [],
    } as any
    const inp = new AutoSuggestInput(shell)

    // Seed input state and fetch suggestions
    ;(inp as any).setInputForTesting('g', undefined)

    // Force open list and grouped rendering with first item selected
    ;(inp as any)['isShowingSuggestions'] = true
    ;(inp as any)['selectedIndex'] = 0

    // updateSuggestions should have set groupedActive=true and normalized groups
    // but to be robust, mirror renderer expectations explicitly
    const groupedForRender = groupsOf(
      { title: 'Commands', items: ['git', 'grep'] },
      { title: 'Files', items: ['README.md', 'package.json'] },
    )
    ;(inp as any)['groupedActive'] = true
    ;(inp as any)['groupedForRender'] = groupedForRender

    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('~/t ❯ ')

    expect(mockOutput).toContain('Commands:')
    expect(mockOutput).toContain('Files:')
    // Selected item should be bracketed
    expect(mockOutput).toContain('[git]')
    // Non-selected appear dimmed (contain the label at least)
    expect(mockOutput).toContain('grep')
  })

  it('flattens grouped results and applies selected completion to input', () => {
    const shell = {
      getCompletions: mock(() => groupsOf(
        { title: 'Commands', items: ['git', 'grep'] },
      )),
      config: { completion: { enabled: true } },
      history: [],
    } as any
    const inp = new AutoSuggestInput(shell)

    ;(inp as any).setInputForTesting('g', undefined)
    // Open list and select second item (grep)
    ;(inp as any)['isShowingSuggestions'] = true
    ;(inp as any)['selectedIndex'] = 1

    // Press Enter path in code would call applySelectedCompletion; call directly
    ;(inp as any)['applySelectedCompletion']()

    expect((inp as any)['getCurrentInputForTesting']()).toBe('grep')
  })

  it('computes inline suffix correctly when grouped results active', () => {
    const shell = {
      getCompletions: mock(() => groupsOf(
        { title: 'Commands', items: ['bundle', 'build', 'run'] },
      )),
      config: { completion: { enabled: true } },
      history: [],
    } as any
    const inp = new AutoSuggestInput(shell)

    // Type 'b' to get a suffix suggestion
    ;(inp as any).setInputForTesting('b', undefined)

    // It should pick the selected item (index 0) and show remaining suffix
    // when showInline is true and list is not open
    ;(inp as any)['isShowingSuggestions'] = false
    ;(inp as any)['selectedIndex'] = 0

    // Force a render to compute inline text
    ;(inp as any).updateDisplayForTesting('~/t ❯ ')

    // The inline suggestion should contain the remainder of the selected completion
    // e.g., from 'bundle' with current input 'b', suffix contains 'undle'
    expect(mockOutput).toContain('undle')
  })

  it('merges history as trailing History group (deduped, up to max)', () => {
    const shell = {
      getCompletions: mock(() => groupsOf(
        { title: 'Commands', items: ['git'] },
      )),
      config: { completion: { enabled: true } },
      history: ['git status', 'git commit', 'git status'],
    } as any
    const inp = new AutoSuggestInput(shell, { maxSuggestions: 5 })

    // Prefix 'git ' so history matches should appear
    ;(inp as any).setInputForTesting('git ', undefined)

    ;(inp as any)['isShowingSuggestions'] = true
    ;(inp as any)['selectedIndex'] = 0

    // After updateSuggestions (triggered by setInputForTesting), grouped renderer should include History header
    ;(inp as any)['groupedActive'] = true // ensure grouped path

    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('~/t ❯ ')

    expect(mockOutput).toContain('History:')
    // Should contain both history items (deduped)
    expect(mockOutput).toContain('git status')
    expect(mockOutput).toContain('git commit')
  })
})
