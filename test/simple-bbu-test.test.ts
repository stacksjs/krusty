/* eslint-disable no-console */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

describe('Simple BBU Test', () => {
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

  it('should not accumulate characters when updateDisplay is called multiple times', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '❯ '

    console.log('=== Testing direct updateDisplay calls ===')

    // Simulate shell writing prompt
    process.stdout.write(prompt)
    console.log(`After prompt: ${JSON.stringify(mockOutput)}`)

    // Simulate typing 'b' - first updateDisplay call
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)

    console.log(`After first 'b': ${JSON.stringify(mockOutput)}`)

    // Simulate typing 'u' - second updateDisplay call
    autoSuggestInput.currentInput = 'bu'
    autoSuggestInput.cursorPosition = 2
    autoSuggestInput.updateDisplay(prompt)

    console.log(`After 'bu': ${JSON.stringify(mockOutput)}`)

    // Count character occurrences in final output
    const bCount = (mockOutput.match(/b/g) || []).length
    const uCount = (mockOutput.match(/u/g) || []).length

    console.log(`Final 'b' count: ${bCount}`)
    console.log(`Final 'u' count: ${uCount}`)

    // Should only have one 'b' and one 'u' in the final visible state
    // The key insight: we need to check what would actually be visible on screen
    // after all the escape sequences are processed

    // Parse the output to simulate what terminal would show
    let simulatedScreen = ''
    let i = 0
    while (i < mockOutput.length) {
      if (mockOutput[i] === '\x1B') {
        // Skip escape sequence
        if (mockOutput[i + 1] === '[') {
          let j = i + 2
          while (j < mockOutput.length && !/[a-z]/i.test(mockOutput[j])) {
            j++
          }
          const command = mockOutput[j]
          if (command === 'K') {
            // Clear to end of line - remove everything after current position
            simulatedScreen = simulatedScreen.substring(0, simulatedScreen.length)
          }
          else if (command === 'D') {
            // Move cursor left - for simplicity, just track final state
          }
          i = j + 1
        }
        else {
          i += 2
        }
      }
      else {
        simulatedScreen += mockOutput[i]
        i++
      }
    }

    console.log(`Simulated screen: ${JSON.stringify(simulatedScreen)}`)

    // The final screen should show "❯ bu" without duplication
    expect(simulatedScreen).toBe('❯ bu')
  })
})
