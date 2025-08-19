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

    // Test the 'bbu' bug by simulating typing 'b' then 'u'
    // Use the public interface to set input
    ;(autoSuggestInput as any).currentInput = 'b'
    ;(autoSuggestInput as any).cursorPosition = 1
    ;(autoSuggestInput as any).updateDisplay('❯ ')

    console.log(`After first 'b': ${JSON.stringify(mockOutput)}`)

    // Now type 'u' to make it 'bu'
    ;(autoSuggestInput as any).currentInput = 'bu'
    ;(autoSuggestInput as any).cursorPosition = 2
    ;(autoSuggestInput as any).updateDisplay('❯ ')

    console.log(`After 'bu': ${JSON.stringify(mockOutput)}`)

    // Count character occurrences in final output
    const bCount = (mockOutput.match(/b/g) || []).length
    const uCount = (mockOutput.match(/u/g) || []).length

    console.log(`Final 'b' count: ${bCount}`)
    console.log(`Final 'u' count: ${uCount}`)

    // Should only have one 'b' and one 'u' in the final visible state
    // The key insight: we need to check what would actually be visible on screen
    // after all the escape sequences are processed

    // Parse the output    // Simulate terminal behavior with proper cursor tracking
    let simulatedScreen = ''
    let cursorPos = 0
    let i = 0

    while (i < mockOutput.length) {
      if (mockOutput[i] === '\x1B' && i + 1 < mockOutput.length && mockOutput[i + 1] === '[') {
        // Find the end of the escape sequence
        let j = i + 2
        let numStr = ''
        while (j < mockOutput.length && /\d/.test(mockOutput[j])) {
          numStr += mockOutput[j]
          j++
        }

        if (j < mockOutput.length) {
          const command = mockOutput[j]
          const num = numStr ? Number.parseInt(numStr, 10) : 1

          if (command === 'K') {
            // Clear to end of line - remove everything from cursor position to end
            simulatedScreen = simulatedScreen.substring(0, cursorPos)
          }
          else if (command === 'D') {
            // Move cursor left
            cursorPos = Math.max(0, cursorPos - num)
          }
          i = j + 1
        }
        else {
          i += 2
        }
      }
      else {
        // Insert character at cursor position
        if (cursorPos >= simulatedScreen.length) {
          simulatedScreen += mockOutput[i]
        }
        else {
          simulatedScreen = simulatedScreen.substring(0, cursorPos)
            + mockOutput[i]
            + simulatedScreen.substring(cursorPos)
        }
        cursorPos++
        i++
      }
    }

    console.log(`Simulated screen: ${JSON.stringify(simulatedScreen)}`)

    // The final screen should show "❯ bu" without duplication
    expect(simulatedScreen).toBe('❯ bu')
  })
})
