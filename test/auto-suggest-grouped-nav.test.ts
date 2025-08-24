/* eslint-disable dot-notation */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { AutoSuggestInput } from '../src/input/auto-suggest'

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

describe('Grouped suggestion navigation', () => {
  beforeEach(() => {
    mockStdout()
  })
  afterEach(() => {
    restoreStdout()
  })

  it('Up/Down switch groups preserving row; Left/Right move within current group', () => {
    const groups = [
      { title: 'A', items: ['a1', 'a2', 'a3'] },
      { title: 'B', items: ['b1', 'b2'] },
      { title: 'C', items: ['c1'] },
    ]
    const shell = {
      getCompletions: mock((_s: string) => groups),
      config: { completion: { enabled: true, maxSuggestions: 50 } },
      history: [],
    } as any

    const inp = new AutoSuggestInput(shell)

    // Seed input to trigger suggestions
    ;(inp as any).setInputForTesting('bun run ', undefined)

    // Open list and mark grouped state
    ;(inp as any)['isShowingSuggestions'] = true
    ;(inp as any)['selectedIndex'] = 0 // A:a1

    // Right within group A (a1 -> a2)
    expect((inp as any)['navigateGrouped']('right')).toBe(true)
    expect((inp as any)['getCurrentInputForTesting']()).toBe('bun run ')
    expect((inp as any)['selectedIndex']).toBe(1)

    // Left within group A (a2 -> a1)
    expect((inp as any)['navigateGrouped']('left')).toBe(true)
    expect((inp as any)['selectedIndex']).toBe(0)

    // Move to a2 (row = 1) using Right
    expect((inp as any)['navigateGrouped']('right')).toBe(true)
    expect((inp as any)['selectedIndex']).toBe(1)

    // Down to group B preserving row (row 1 -> b2)
    expect((inp as any)['navigateGrouped']('down')).toBe(true)
    // B starts after A allocation; find label via rendering to ensure index mapped
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('B:'.toUpperCase())
    // Selected item should be b2 (row 1 in group B) without brackets
    expect(mockOutput).toContain('b2')
    expect(mockOutput).not.toContain('[b2]')

    // Up back to A preserving row (row 1 -> a2)
    expect((inp as any)['navigateGrouped']('up')).toBe(true)
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('A:'.toUpperCase())
    expect(mockOutput).toContain('a2')
    expect(mockOutput).not.toContain('[a2]')

    // Down to C (row 1 clamped to last available -> c1 row 0)
    expect((inp as any)['navigateGrouped']('down')).toBe(true) // to B
    expect((inp as any)['navigateGrouped']('down')).toBe(true) // to C
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('C:'.toUpperCase())
    expect(mockOutput).toContain('c1')
    expect(mockOutput).not.toContain('[c1]')
  })

  it('Multi-column: Down moves within rows, crosses to next group preserving column, clamps on short last rows', () => {
    // Force a predictable 2-column layout in computeLayout: colWidth+gap ~= 5, 12/5 => 2 columns
    const originalCols = (process.stdout as any).columns
    Object.defineProperty(process.stdout, 'columns', { value: 12, configurable: true })

    const groups = [
      { title: 'A', items: ['a1', 'a2', 'a3', 'a4', 'a5'] }, // 5 items -> 2 cols -> rows: 3 (2,2,1)
      { title: 'B', items: ['b1', 'b2', 'b3'] }, // 3 items -> rows: 2 (2,1)
      { title: 'C', items: ['c1', 'c2'] },
    ]
    const shell = {
      getCompletions: mock((_s: string) => groups),
      config: { completion: { enabled: true, maxSuggestions: 50 } },
      history: [],
    } as any

    const inp = new AutoSuggestInput(shell)
    ;(inp as any).setInputForTesting('bun run ', undefined)
    ;(inp as any)['isShowingSuggestions'] = true

    // Start on A:a2 (row 0, col 1)
    ;(inp as any)['selectedIndex'] = 1

    // Down -> A:a4 (row 1, col 1)
    expect((inp as any)['navigateGrouped']('down')).toBe(true)
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('A:'.toUpperCase())
    expect(mockOutput).toContain('a4')

    // Down -> A:a5 (row 2, col clamped to 0 since last row has 1 item)
    expect((inp as any)['navigateGrouped']('down')).toBe(true)
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('a5')

    // Down from bottom of A -> first row of B, preserve column (col 1) => B:b2
    expect((inp as any)['navigateGrouped']('down')).toBe(true)
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('B:'.toUpperCase())
    expect(mockOutput).toContain('b2')

    // Cleanup
    Object.defineProperty(process.stdout, 'columns', { value: originalCols, configurable: true })
  })

  it('Up from top row goes to previous group last row preserving column; Left/Right wrap within group', () => {
    const originalCols = (process.stdout as any).columns
    Object.defineProperty(process.stdout, 'columns', { value: 12, configurable: true })

    const groups = [
      { title: 'A', items: ['a1', 'a2', 'a3', 'a4', 'a5'] },
      { title: 'B', items: ['b1', 'b2', 'b3'] },
    ]
    const shell = {
      getCompletions: mock((_s: string) => groups),
      config: { completion: { enabled: true, maxSuggestions: 50 } },
      history: [],
    } as any

    const inp = new AutoSuggestInput(shell)
    ;(inp as any).setInputForTesting('bun run ', undefined)
    ;(inp as any)['isShowingSuggestions'] = true

    // Select B:b1 (first item in group B)
    // Group A has 5 items; indices A:0..4, then B:5..7 (depending on sort, which keeps a1..)
    ;(inp as any)['selectedIndex'] = 5

    // Up from B top row (row 0, col 0) -> A last row preserving col => A:a5
    expect((inp as any)['navigateGrouped']('up')).toBe(true)
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('A:'.toUpperCase())
    expect(mockOutput).toContain('a5')

    // Right from A:a5 wraps within group to A:a1 (row-major wrap)
    expect((inp as any)['navigateGrouped']('right')).toBe(true)
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('a1')

    // Left from A:a1 wraps back to last item A:a5
    expect((inp as any)['navigateGrouped']('left')).toBe(true)
    mockOutput = ''
    ;(inp as any).updateDisplayForTesting('❯ ')
    expect(mockOutput).toContain('a5')

    // Cleanup
    Object.defineProperty(process.stdout, 'columns', { value: originalCols, configurable: true })
  })
})
