import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to reproduce the 'bbu' issue when typing 'bu' sequentially
describe('Shell BBU Bug Reproduction', () => {
  let mockOutput = ''
  let writeCallCount = 0
  let keypressHandlers: Array<(str: string, key: any) => void> = []
  const originalWrite = process.stdout.write
  const originalOn = process.stdin.on
  const originalSetRawMode = process.stdin.setRawMode

  beforeEach(() => {
    mockOutput = ''
    writeCallCount = 0
    keypressHandlers = []
    
    process.stdout.write = mock((chunk: any) => {
      writeCallCount++
      const str = chunk.toString()
      mockOutput += str
      console.log(`Write #${writeCallCount}: ${JSON.stringify(str)}`)
      return true
    })

    // Mock stdin to capture keypress handlers
    process.stdin.on = mock((event: string, handler: any) => {
      if (event === 'keypress') {
        keypressHandlers.push(handler)
      }
      return process.stdin
    })

    process.stdin.setRawMode = mock(() => process.stdin)
    process.stdin.removeAllListeners = mock(() => process.stdin)
  })

  afterEach(() => {
    process.stdout.write = originalWrite
    process.stdin.on = originalOn
    process.stdin.setRawMode = originalSetRawMode
  })

  it('should reproduce the bbu issue when typing b then u', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')
    
    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○11?10] via 🧅 1.2.21❯ '

    console.log('=== Testing sequential character input ===')
    
    // Start readLine
    const readLinePromise = autoSuggestInput.readLine(prompt)
    const keypressHandler = keypressHandlers[0]
    
    console.log('=== Initial state ===')
    console.log(`Output: ${JSON.stringify(mockOutput)}`)
    
    // Type 'b'
    console.log('=== User types "b" ===')
    keypressHandler('b', { name: 'b', sequence: 'b', ctrl: false, meta: false })
    
    console.log(`After 'b': ${JSON.stringify(mockOutput)}`)
    
    // Type 'u' 
    console.log('=== User types "u" ===')
    keypressHandler('u', { name: 'u', sequence: 'u', ctrl: false, meta: false })
    
    console.log(`After 'u': ${JSON.stringify(mockOutput)}`)
    
    // Check for the 'bbu' issue
    const finalOutput = mockOutput
    console.log(`Final output analysis: ${JSON.stringify(finalOutput)}`)
    
    // Count occurrences
    const bCount = (finalOutput.match(/b/g) || []).length
    const uCount = (finalOutput.match(/u/g) || []).length
    
    console.log(`'b' appears ${bCount} times (should be 1)`)
    console.log(`'u' appears ${uCount} times (should be 1)`)
    
    // Should not have 'bbu' pattern
    expect(finalOutput).not.toContain('bbu')
    expect(bCount).toBe(1)
    expect(uCount).toBe(1)
    
    // Clean up
    keypressHandler('', { name: 'return' })
    await readLinePromise
  })

  it('should test the updateDisplay logic for sequential inputs', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')
    
    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○11?10] via 🧅 1.2.21❯ '

    console.log('=== Testing updateDisplay sequence ===')
    
    // Shell writes prompt
    process.stdout.write(prompt)
    
    console.log('=== After prompt write ===')
    console.log(`Output: ${JSON.stringify(mockOutput)}`)
    
    // Simulate typing 'b'
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)
    
    console.log('=== After typing "b" ===')
    console.log(`Output: ${JSON.stringify(mockOutput)}`)
    
    // Simulate typing 'u' (should result in 'bu')
    autoSuggestInput.currentInput = 'bu'
    autoSuggestInput.cursorPosition = 2
    autoSuggestInput.updateDisplay(prompt)
    
    console.log('=== After typing "u" ===')
    console.log(`Output: ${JSON.stringify(mockOutput)}`)
    
    // Analyze the issue
    const parts = mockOutput.split('\x1B[K') // Split by clear sequences
    console.log(`Output parts: ${JSON.stringify(parts)}`)
    
    // The issue might be that we're not clearing properly between updates
    const bCount = (mockOutput.match(/b/g) || []).length
    const uCount = (mockOutput.match(/u/g) || []).length
    
    console.log(`'b' count: ${bCount}, 'u' count: ${uCount}`)
    
    // Should end with 'bu', not 'bbu'
    expect(mockOutput).toContain('bu')
    expect(mockOutput).not.toContain('bbu')
  })
})
