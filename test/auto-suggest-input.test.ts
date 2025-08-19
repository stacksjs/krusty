import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test'
import { AutoSuggestInput } from '../src/input/auto-suggest-input'

// Mock shell interface
const mockShell = {
  getCompletions: mock(() => ['bundle', 'build', 'run']),
  config: { completion: { enabled: true } },
  history: ['git status', 'npm install'],
  aliases: { ll: 'ls -la' }
}

// Mock stdout for testing
let mockOutput = ''
const originalWrite = process.stdout.write

function mockStdout() {
  mockOutput = ''
  process.stdout.write = mock((chunk: any) => {
    mockOutput += chunk.toString()
    return true
  })
}

function restoreStdout() {
  process.stdout.write = originalWrite
}

describe('AutoSuggestInput', () => {
  let autoSuggestInput: AutoSuggestInput

  beforeEach(() => {
    autoSuggestInput = new AutoSuggestInput(mockShell as any)
    mockStdout()
  })

  afterEach(() => {
    restoreStdout()
  })

  describe('updateDisplay', () => {
    it('should not create new lines when updating display', () => {
      const prompt = '~/test ❯ '
      
      // Simulate typing 'b'
      autoSuggestInput['currentInput'] = 'b'
      autoSuggestInput['cursorPosition'] = 1
      autoSuggestInput['updateDisplay'](prompt)
      
      // Should not contain newline characters
      expect(mockOutput).not.toContain('\n')
      
      // Should contain the prompt and input
      expect(mockOutput).toContain(prompt)
      expect(mockOutput).toContain('b')
    })

    it('should clear and rewrite line properly', () => {
      const prompt = '~/test ❯ '
      
      autoSuggestInput['currentInput'] = 'bu'
      autoSuggestInput['cursorPosition'] = 2
      autoSuggestInput['updateDisplay'](prompt)
      
      // Should start with carriage return and clear sequence
      expect(mockOutput).toStartWith('\r\x1B[2K')
      
      // Should not create multiple lines
      const lines = mockOutput.split('\n')
      expect(lines.length).toBe(1)
    })

    it('should handle backspace without creating new lines', () => {
      const prompt = '~/test ❯ '
      
      // Start with 'bu'
      autoSuggestInput['currentInput'] = 'bu'
      autoSuggestInput['cursorPosition'] = 2
      autoSuggestInput['updateDisplay'](prompt)
      
      const firstOutput = mockOutput
      mockOutput = ''
      
      // Backspace to 'b'
      autoSuggestInput['currentInput'] = 'b'
      autoSuggestInput['cursorPosition'] = 1
      autoSuggestInput['updateDisplay'](prompt)
      
      // Neither output should contain newlines
      expect(firstOutput).not.toContain('\n')
      expect(mockOutput).not.toContain('\n')
    })

    it('should position cursor correctly after input', () => {
      const prompt = '~/test ❯ '
      
      autoSuggestInput['currentInput'] = 'b'
      autoSuggestInput['cursorPosition'] = 1
      autoSuggestInput['currentSuggestion'] = 'undle'
      autoSuggestInput['updateDisplay'](prompt)
      
      // Should contain cursor positioning escape sequence
      expect(mockOutput).toContain('\x1B[')
      
      // Should not create new lines
      expect(mockOutput).not.toContain('\n')
    })
  })

  describe('character input simulation', () => {
    it('should handle multiple character inputs without line breaks', () => {
      const prompt = '~/test ❯ '
      
      // Simulate typing 'bun' character by character
      const chars = ['b', 'u', 'n']
      
      for (let i = 0; i < chars.length; i++) {
        mockOutput = '' // Reset for each character
        
        autoSuggestInput['currentInput'] = chars.slice(0, i + 1).join('')
        autoSuggestInput['cursorPosition'] = i + 1
        autoSuggestInput['updateDisplay'](prompt)
        
        // Each update should not create new lines
        expect(mockOutput).not.toContain('\n')
        expect(mockOutput).toContain(prompt)
      }
    })
  })
})
