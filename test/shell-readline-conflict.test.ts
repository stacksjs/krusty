/* eslint-disable no-console */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to verify readline interface conflict is fixed
describe('Shell Readline Interface Conflict', () => {
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

  it('should not have readline interface conflicting with AutoSuggestInput', async () => {
    console.log('=== Testing without readline interface ===')

    const prompt = '~/Code/krusty ⎇ main [●1○8?7] via 🧅 1.2.21❯ '

    // Shell writes prompt
    console.log('=== Shell writes prompt ===')
    process.stdout.write(prompt)

    // AutoSuggestInput handles input (no readline interface)
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)

    console.log('=== User types b ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    console.log(`Output: ${JSON.stringify(mockOutput)}`)

    // Should only have one 'b'
    const bCount = (mockOutput.match(/b/g) || []).length
    console.log(`Character 'b' count: ${bCount}`)
    expect(bCount).toBe(1)

    // Should have clean output pattern
    expect(mockOutput).toMatch(/❯ \x1B\[Kb$/)
  })

  it('should demonstrate the readline conflict issue', () => {
    console.log('=== Demonstrating readline conflict ===')

    const prompt = '~/Code/krusty ⎇ main [●1○8?7] via 🧅 1.2.21❯ '

    // Simulate what happens with readline interface active
    console.log('=== Shell writes prompt ===')
    process.stdout.write(prompt)

    console.log('=== Readline interface echoes character ===')
    process.stdout.write('b') // Readline echoes the character

    console.log('=== AutoSuggestInput also writes character ===')
    process.stdout.write('\x1B[K') // Clear
    process.stdout.write('b') // AutoSuggestInput writes it again

    console.log(`Conflict output: ${JSON.stringify(mockOutput)}`)

    // This shows how we get 'bb' - readline echoes + AutoSuggestInput writes
    const bCount = (mockOutput.match(/b/g) || []).length
    console.log(`Character 'b' count with conflict: ${bCount}`)
    expect(bCount).toBe(2) // This demonstrates the problem
  })
})
