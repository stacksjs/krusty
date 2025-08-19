import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to verify the newline fix
describe('Shell Newline Fix Verification', () => {
  let mockOutput = ''
  let writeCallCount = 0
  const originalWrite = process.stdout.write

  beforeEach(() => {
    mockOutput = ''
    writeCallCount = 0
    process.stdout.write = mock((chunk: any) => {
      writeCallCount++
      const str = chunk.toString()
      mockOutput += str
      console.log(`Write #${writeCallCount}: ${JSON.stringify(str)}`)
      return true
    })
  })

  afterEach(() => {
    process.stdout.write = originalWrite
  })

  it('should only write input portion, not rewrite entire prompt', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○1] via 🧅 1.2.21❯ '

    // Shell writes initial prompt
    console.log('=== Shell writes initial prompt ===')
    process.stdout.write(prompt)

    console.log('=== User types "b" ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    console.log('=== User types "u" ===')
    autoSuggestInput.currentInput = 'bu'
    autoSuggestInput.cursorPosition = 2
    autoSuggestInput.updateDisplay(prompt)

    // Verify the fix
    const promptOccurrences = (mockOutput.match(new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    console.log(`Prompt written ${promptOccurrences} times (should be 1)`)

    // Should only write prompt once (by shell), then only input updates
    expect(promptOccurrences).toBe(1)

    // Should not contain carriage return + clear sequences that rewrite entire line
    const fullLineClearCount = (mockOutput.match(/\r\x1B\[2K/g) || []).length
    console.log(`Full line clears: ${fullLineClearCount} (should be 0)`)
    expect(fullLineClearCount).toBe(0)

    // Should only contain cursor-to-end-of-line clears
    const partialClearCount = (mockOutput.match(/\x1B\[K/g) || []).length
    console.log(`Partial line clears: ${partialClearCount} (should be 2)`)
    expect(partialClearCount).toBe(2)
  })
})
