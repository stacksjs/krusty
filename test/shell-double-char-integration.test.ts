/* eslint-disable no-console */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to reproduce the actual double character issue in shell integration
describe('Shell Double Character Integration Bug', () => {
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

  it('should reproduce the bb issue when typing b', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle', 'build'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○8?7] via 🧅 1.2.21❯ '

    console.log('=== Simulating actual shell interaction ===')

    // Start readLine (this sets up keypress handlers)
    const readLinePromise = autoSuggestInput.readLine(prompt)

    // Verify keypress handler was registered
    expect(keypressHandlers.length).toBe(1)
    const keypressHandler = keypressHandlers[0]

    console.log('=== Initial state after readLine setup ===')
    console.log(`Output so far: ${JSON.stringify(mockOutput)}`)

    // Simulate user typing 'b' - this is what happens in real shell
    console.log('=== User types "b" ===')
    keypressHandler('b', { name: 'b', sequence: 'b' })

    console.log(`Output after typing b: ${JSON.stringify(mockOutput)}`)

    // Check if 'b' appears twice (the bb issue)
    const bCount = (mockOutput.match(/b/g) || []).length
    console.log(`Character 'b' appears ${bCount} times`)

    // This should fail if we have the bb issue
    expect(bCount).toBe(1) // Should only appear once, not twice

    // Clean up
    keypressHandler('', { name: 'return' })
    await readLinePromise
  })

  it('should test the complete keypress flow that causes duplication', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')

    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○8?7] via 🧅 1.2.21❯ '

    console.log('=== Testing complete keypress flow ===')

    // Start readLine
    const readLinePromise = autoSuggestInput.readLine(prompt)
    const keypressHandler = keypressHandlers[0]

    console.log('=== After readLine setup ===')
    console.log(`Initial output: ${JSON.stringify(mockOutput)}`)

    // The issue might be that the character gets processed twice:
    // 1. Once by the keypress handler updating currentInput
    // 2. Once by updateDisplay writing it again

    console.log('=== Simulating keypress for "b" ===')
    keypressHandler('b', {
      name: 'b',
      sequence: 'b',
      ctrl: false,
      meta: false,
    })

    console.log(`Final output: ${JSON.stringify(mockOutput)}`)

    // Analyze what happened
    const writes = []
    let tempOutput = ''
    for (let i = 1; i <= writeCallCount; i++) {
      // This is a simplified analysis - in real test we'd track each write
    }

    // The key insight: check if character appears in multiple writes
    const outputParts = mockOutput.split('\x1B[K') // Split by clear sequences
    console.log(`Output parts: ${JSON.stringify(outputParts)}`)

    const bCount = (mockOutput.match(/b/g) || []).length
    expect(bCount).toBe(1)

    // Clean up
    keypressHandler('', { name: 'return' })
    await readLinePromise
  })
})
