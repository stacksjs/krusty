import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

describe('Shell Positioning Debug', () => {
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

  it('should debug the actual positioning issue in real shell', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')
    
    const mockShell = {
      getCompletions: () => ['build', 'bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    // Use the exact prompt from the shell output
    const prompt = '~/Code/krusty ⎇ main [●1○13?12] via 🧅 1.2.21❯ '

    console.log('=== Real Shell Prompt Debug ===')
    console.log(`Prompt: ${JSON.stringify(prompt)}`)
    console.log(`Prompt length: ${prompt.length}`)
    console.log(`Prompt visual length: ${prompt.replace(/\x1B\[[0-9;]*m/g, '').length}`)
    
    // Start readLine
    const readLinePromise = autoSuggestInput.readLine(prompt)
    const keypressHandler = keypressHandlers[0]
    
    console.log('=== Type "b" ===')
    keypressHandler('b', { name: 'b', sequence: 'b', ctrl: false, meta: false })
    
    console.log(`After 'b': ${JSON.stringify(mockOutput)}`)
    
    // Parse positioning commands
    const positioningCommands = mockOutput.match(/\x1B\[(\d+)G/g) || []
    console.log(`Positioning commands: ${JSON.stringify(positioningCommands)}`)
    
    const columns = positioningCommands.map(cmd => {
      const match = cmd.match(/\x1B\[(\d+)G/)
      return match ? parseInt(match[1]) : 0
    })
    console.log(`Column positions: ${JSON.stringify(columns)}`)
    
    // The issue might be that we're calculating based on full prompt length
    // but the terminal might be wrapping or handling ANSI differently
    const expectedInputStart = prompt.length + 1
    const actualInputStart = columns[0]
    
    console.log(`Expected input start: ${expectedInputStart}`)
    console.log(`Actual input start: ${actualInputStart}`)
    
    if (expectedInputStart !== actualInputStart) {
      console.log('❌ Input start position mismatch!')
    }
    
    // Clean up
    keypressHandler('', { name: 'return' })
    await readLinePromise
  })

  it('should test with simpler approach - relative positioning', async () => {
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')
    
    const mockShell = {
      getCompletions: () => ['test'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    // Create a test version that uses relative positioning instead of absolute
    class TestAutoSuggestInput extends AutoSuggestInput {
      public testUpdateDisplay(prompt: string) {
        const stdout = process.stdout
        
        // Alternative approach: clear to end and rewrite, then move cursor back
        stdout.write('\x1B[K') // Clear to end of line
        stdout.write(this.currentInput) // Write input
        
        // Move cursor back to correct position
        const moveBack = this.currentInput.length - this.cursorPosition
        if (moveBack > 0) {
          stdout.write(`\x1B[${moveBack}D`)
        }
      }
    }

    const testInput = new TestAutoSuggestInput(mockShell as any)
    const prompt = '~/Code/krusty ⎇ main [●1○13?12] via 🧅 1.2.21❯ '

    console.log('=== Testing relative positioning approach ===')
    
    // Simulate shell writing prompt first
    process.stdout.write(prompt)
    console.log(`After prompt: ${JSON.stringify(mockOutput)}`)
    
    // Test typing 'b'
    testInput.currentInput = 'b'
    testInput.cursorPosition = 1
    testInput.testUpdateDisplay(prompt)
    
    console.log(`After 'b' with relative: ${JSON.stringify(mockOutput)}`)
    
    // Test typing 'bu'
    testInput.currentInput = 'bu'
    testInput.cursorPosition = 2
    testInput.testUpdateDisplay(prompt)
    
    console.log(`After 'bu' with relative: ${JSON.stringify(mockOutput)}`)
    
    // This should show if relative positioning works better
    expect(mockOutput).toContain('bu')
  })
})
