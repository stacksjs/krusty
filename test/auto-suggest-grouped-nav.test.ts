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
})
