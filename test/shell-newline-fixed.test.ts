/* eslint-disable no-console */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to verify the newline fix works correctly
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

  it('should fix the shell flow to write prompt only once', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○6?5] via 🧅 1.2.21❯ '

    console.log('=== Fixed shell flow ===')

    // Step 1: Shell writes prompt (like shell.ts does now)
    console.log('=== Shell writes prompt ===')
    process.stdout.write(prompt)

    // Step 2: User types 'b' - updateDisplay should NOT rewrite prompt
    console.log('=== User types "b" ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    console.log(`Fixed output: ${JSON.stringify(mockOutput)}`)

    // Verify the fix
    const promptWrites = (mockOutput.match(new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    const clearSequences = (mockOutput.match(/\x1B\[K/g) || []).length
    const fullLineClearSequences = (mockOutput.match(/\r\x1B\[2K/g) || []).length

    console.log(`Prompt written ${promptWrites} times (should be 1)`)
    console.log(`Partial clears: ${clearSequences} (should be 1)`)
    console.log(`Full line clears: ${fullLineClearSequences} (should be 0)`)

    // Should only write prompt once
    expect(promptWrites).toBe(1)

    // Should use partial clear, not full line clear
    expect(clearSequences).toBe(1)
    expect(fullLineClearSequences).toBe(0)

    // Should contain the input
    expect(mockOutput).toContain('b')
  })

  it('should handle multiple characters without prompt duplication', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○6?5] via 🧅 1.2.21❯ '

    console.log('=== Testing multiple characters ===')

    // Shell writes prompt once
    process.stdout.write(prompt)

    // Type 'b'
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    // Type 'u'
    autoSuggestInput.currentInput = 'bu'
    autoSuggestInput.cursorPosition = 2
    autoSuggestInput.updateDisplay(prompt)

    // Type 'n'
    autoSuggestInput.currentInput = 'bun'
    autoSuggestInput.cursorPosition = 3
    autoSuggestInput.updateDisplay(prompt)

    console.log(`Multiple chars output: ${JSON.stringify(mockOutput)}`)

    // Should still only have one prompt
    const promptCount = (mockOutput.match(/❯/g) || []).length
    console.log(`Prompt symbols: ${promptCount} (should be 1)`)
    expect(promptCount).toBe(1)

    // Should end with 'bun'
    expect(mockOutput).toContain('bun')
  })
})
