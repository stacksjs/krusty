import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test'

// Test to debug the actual shell newline issue
describe('Shell Newline Debug', () => {
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

  it('should track what causes newlines in shell interaction', async () => {
    // Import and create shell components
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')
    
    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {}
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○1] via 🧅 1.2.21❯ '

    // Test sequence: write prompt, then simulate typing
    console.log('=== Initial prompt write ===')
    process.stdout.write(prompt)
    
    console.log('=== Simulating typing "b" ===')
    autoSuggestInput['currentInput'] = 'b'
    autoSuggestInput['cursorPosition'] = 1
    autoSuggestInput['updateDisplay'](prompt)
    
    console.log('=== Simulating typing "u" ===')
    autoSuggestInput['currentInput'] = 'bu'
    autoSuggestInput['cursorPosition'] = 2
    autoSuggestInput['updateDisplay'](prompt)

    // Analyze the output
    const writes = mockOutput.split('')
    const newlineCount = writes.filter(char => char === '\n').length
    const carriageReturnCount = writes.filter(char => char === '\r').length
    
    console.log(`Total writes: ${writeCallCount}`)
    console.log(`Newlines found: ${newlineCount}`)
    console.log(`Carriage returns: ${carriageReturnCount}`)
    console.log(`Full output: ${JSON.stringify(mockOutput)}`)
    
    // The issue might be that we're writing the prompt multiple times
    const promptOccurrences = (mockOutput.match(new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    console.log(`Prompt written ${promptOccurrences} times`)
    
    expect(newlineCount).toBe(0) // Should not create any newlines
  })
})
