/* eslint-disable no-console */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to reproduce the exact newline issue from shell interaction
describe('Shell Newline Issue Reproduction', () => {
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

  it('should reproduce the exact shell flow that creates new lines', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○6?5] via 🧅 1.2.21❯ '

    console.log('=== Simulating exact shell flow ===')

    // Step 1: Shell calls renderPrompt() and gets the prompt
    console.log('=== Shell renders prompt ===')
    // Shell would write the prompt here, but we're testing AutoSuggestInput

    // Step 2: Shell calls readLine(prompt) which calls AutoSuggestInput.readLine()
    console.log('=== AutoSuggestInput.readLine() starts ===')
    // This writes the prompt initially
    process.stdout.write(prompt)

    // Step 3: User types 'b' - this triggers updateDisplay
    console.log('=== User types "b" ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    // Analyze the output to see what causes the newline effect
    console.log(`Complete output: ${JSON.stringify(mockOutput)}`)

    // Check for patterns that would cause visual newlines
    const lines = mockOutput.split('\n')
    const carriageReturns = (mockOutput.match(/\r/g) || []).length
    const clearSequences = (mockOutput.match(/\x1B\[2K/g) || []).length
    const promptWrites = (mockOutput.match(new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length

    console.log(`Lines created: ${lines.length}`)
    console.log(`Carriage returns: ${carriageReturns}`)
    console.log(`Clear sequences: ${clearSequences}`)
    console.log(`Prompt written ${promptWrites} times`)

    // The issue: prompt is written twice, creating visual duplication
    expect(promptWrites).toBe(1) // Should only write prompt once
    expect(lines.length).toBe(1) // Should not create actual newlines
  })

  it('should test the complete shell REPL loop simulation', async () => {
    console.log('=== Testing complete REPL loop ===')

    // Simulate what happens in shell.ts main loop
    const prompt = '~/Code/krusty ⎇ main [●1○6?5] via 🧅 1.2.21❯ '

    // Shell renders prompt
    console.log('=== Shell.renderPrompt() ===')
    // renderPrompt() returns the prompt string but doesn't write it

    // Shell calls readLine(prompt)
    console.log('=== Shell.readLine(prompt) ===')
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)

    // readLine writes the prompt (this might be the duplicate)
    process.stdout.write(prompt)

    // User types - this triggers updateDisplay which rewrites prompt + input
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    console.log(`REPL output: ${JSON.stringify(mockOutput)}`)

    // This should show the duplication issue
    const promptCount = (mockOutput.match(/❯/g) || []).length
    console.log(`Prompt symbols: ${promptCount}`)

    // The problem: we write prompt twice (once in readLine, once in updateDisplay)
    expect(promptCount).toBe(1) // This will fail, showing the issue
  })
})
