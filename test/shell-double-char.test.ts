import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to verify no character duplication after fix
describe('Shell Character Duplication Fix', () => {
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

  it('should not duplicate characters when typing', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○1] via 🧅 1.2.21❯ '

    console.log('=== AutoSuggestInput writes initial prompt ===')
    // This simulates readLine() being called
    // The prompt gets written initially

    console.log('=== User types "b" ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    console.log(`Complete output: ${JSON.stringify(mockOutput)}`)

    // Count occurrences of 'b' - should only be 1
    const bCount = (mockOutput.match(/b/g) || []).length
    console.log(`Character 'b' appears ${bCount} times`)

    // Should have prompt visible
    expect(mockOutput).toContain('❯')

    // Should only have one 'b'
    expect(bCount).toBe(1)

    // Should not have multiple prompt writes causing visual duplication
    const promptCount = (mockOutput.match(/❯/g) || []).length
    console.log(`Prompt symbol appears ${promptCount} times`)
    expect(promptCount).toBeLessThanOrEqual(2) // Initial + rewrite is acceptable
  })

  it('should handle backspace correctly without duplication', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○1] via 🧅 1.2.21❯ '

    console.log('=== Type "bu" then backspace to "b" ===')

    // Type 'bu'
    autoSuggestInput.currentInput = 'bu'
    autoSuggestInput.cursorPosition = 2
    autoSuggestInput.updateDisplay(prompt)

    mockOutput = '' // Reset to track backspace operation

    // Backspace to 'b'
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    console.log(`Backspace output: ${JSON.stringify(mockOutput)}`)

    // Should show 'b' only once after backspace
    const bCount = (mockOutput.match(/b/g) || []).length
    expect(bCount).toBe(1)

    // Should not show 'u' anymore
    expect(mockOutput).not.toContain('bu')
  })
})
