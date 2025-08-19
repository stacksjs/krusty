import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Test to reproduce the ACTUAL shell integration issue
describe('Shell Real Integration Issue', () => {
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

  it('should reproduce the exact shell flow causing bb issue', async () => {
    console.log('=== Reproducing EXACT shell flow ===')
    
    const prompt = '~/Code/krusty ⎇ main [●1○8?7] via 🧅 1.2.21❯ '
    
    // Step 1: Shell.renderPrompt() + Shell writes prompt
    console.log('=== Shell writes prompt ===')
    process.stdout.write(prompt)
    
    // Step 2: Shell calls readLine() which starts AutoSuggestInput
    console.log('=== Shell calls readLine() ===')
    const { AutoSuggestInput } = await import('../src/input/auto-suggest-input')
    
    const mockShell = {
      getCompletions: () => ['bundle'],
      config: { completion: { enabled: true } },
      history: [],
      aliases: {},
    }

    const autoSuggestInput = new AutoSuggestInput(mockShell as any)
    
    // readLine() does NOT write prompt anymore (we fixed that)
    // But the issue might be elsewhere
    
    console.log('=== Before any user input ===')
    console.log(`Output: ${JSON.stringify(mockOutput)}`)
    
    // Step 3: User types 'b' - this calls updateDisplay
    console.log('=== User types b (calls updateDisplay) ===')
    autoSuggestInput.currentInput = 'b'
    autoSuggestInput.cursorPosition = 1
    autoSuggestInput.updateDisplay(prompt)
    
    console.log('=== After updateDisplay ===')
    console.log(`Output: ${JSON.stringify(mockOutput)}`)
    
    // The issue: check if we have duplicate 'b'
    const bCount = (mockOutput.match(/b/g) || []).length
    console.log(`Character 'b' count: ${bCount}`)
    
    // If this fails, we have the bb issue
    expect(bCount).toBe(1)
  })

  it('should test what happens when shell AND readLine both write', async () => {
    console.log('=== Testing shell + readLine interaction ===')
    
    const prompt = '~/Code/krusty ⎇ main [●1○8?7] via 🧅 1.2.21❯ '
    
    // What if BOTH shell and readLine write the prompt?
    console.log('=== Shell writes prompt ===')
    process.stdout.write(prompt)
    
    console.log('=== readLine ALSO writes prompt (bug scenario) ===')
    process.stdout.write(prompt) // This would cause duplication
    
    console.log('=== User types b ===')
    process.stdout.write('\x1B[K') // Clear
    process.stdout.write('b') // Write input
    
    console.log(`Duplicate scenario output: ${JSON.stringify(mockOutput)}`)
    
    // This would show 2 prompts + b = looks like bb
    const promptCount = (mockOutput.match(/❯/g) || []).length
    console.log(`Prompt count: ${promptCount}`)
    
    // This test shows what the bug would look like
    expect(promptCount).toBe(2) // This demonstrates the issue
  })
})
