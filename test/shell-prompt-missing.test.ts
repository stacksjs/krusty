import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to debug missing prompt and character duplication
describe('Shell Prompt Missing Debug', () => {
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

  it('should show prompt and not duplicate characters', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○1] via 🧅 1.2.21❯ '

    console.log('=== Testing current behavior ===')

    // Simulate what happens when shell calls readLine
    // (This would normally be async, but we're testing the display logic)

    console.log('=== Initial state (no prompt written by AutoSuggestInput) ===')
    // Current code doesn't write prompt initially

    console.log('=== User types "b" ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    // Check what was actually written
    console.log(`Total output: ${JSON.stringify(mockOutput)}`)

    // The issue: no prompt is visible, and we might have character duplication
    const hasPrompt = mockOutput.includes(prompt.replace('❯ ', ''))
    const characterCount = (mockOutput.match(/b/g) || []).length

    console.log(`Prompt visible: ${hasPrompt}`)
    console.log(`Character 'b' appears ${characterCount} times`)

    // Current behavior is broken - no prompt and potentially doubled chars
    expect(hasPrompt).toBe(true) // This will fail, showing the issue
    expect(characterCount).toBe(1) // Should only appear once
  })

  it('should test the complete shell interaction flow', async () => {
    console.log('=== Testing complete flow ===')

    const prompt = '~/Code/krusty ⎇ main [●1○1] via 🧅 1.2.21❯ '

    // Step 1: Shell writes prompt (this is what shell.ts does)
    console.log('=== Shell writes initial prompt ===')
    process.stdout.write(prompt)

    // Step 2: AutoSuggestInput handles input without rewriting prompt
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')
    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)

    console.log('=== User types "b" ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    // Verify the complete output looks correct
    console.log(`Complete output: ${JSON.stringify(mockOutput)}`)

    // Should have: prompt + clear + "b"
    expect(mockOutput).toContain(prompt)
    expect(mockOutput).toContain('b')

    // Should not have doubled characters
    const bCount = (mockOutput.match(/b/g) || []).length
    expect(bCount).toBe(1)
  })
})
