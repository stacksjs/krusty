/* eslint-disable dot-notation */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { AutoSuggestInput } from '../src/input/auto-suggest-input'

// Mock shell interface
const mockShell = {
  getCompletions: mock(() => ['bundle', 'build', 'run']),
  config: { completion: { enabled: true } },
  history: ['git status', 'npm install'],
  aliases: { ll: 'ls -la' },
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

  describe('key helper behaviors', () => {
    it('moveToLineStart and moveToLineEnd adjust cursor correctly', () => {
      autoSuggestInput['currentInput'] = 'echo hello'
      autoSuggestInput['cursorPosition'] = 5
      autoSuggestInput['moveToLineStart']()
      expect(autoSuggestInput['cursorPosition']).toBe(0)
      autoSuggestInput['moveToLineEnd']()
      expect(autoSuggestInput['cursorPosition']).toBe('echo hello'.length)
    })

    it('moveCursorLeft/Right moves within bounds', () => {
      autoSuggestInput['currentInput'] = 'abc'
      autoSuggestInput['cursorPosition'] = 1
      autoSuggestInput['moveCursorLeft']()
      expect(autoSuggestInput['cursorPosition']).toBe(0)
      autoSuggestInput['moveCursorLeft']() // stays at 0
      expect(autoSuggestInput['cursorPosition']).toBe(0)
      autoSuggestInput['moveCursorRight']()
      expect(autoSuggestInput['cursorPosition']).toBe(1)
      autoSuggestInput['moveCursorRight']()
      autoSuggestInput['moveCursorRight']()
      expect(autoSuggestInput['cursorPosition']).toBe(3)
      autoSuggestInput['moveCursorRight']() // stays at end
      expect(autoSuggestInput['cursorPosition']).toBe(3)
    })

    it('moveWordLeft/Right respects word boundaries', () => {
      autoSuggestInput['currentInput'] = 'git   commit --amend'
      autoSuggestInput['cursorPosition'] = 3 // after git
      autoSuggestInput['moveWordRight']()
      // skip spaces to start of 'commit', then over word
      expect(autoSuggestInput['cursorPosition']).toBe('git   commit'.length)

      autoSuggestInput['moveWordRight']()
      // over space to '--amend' and through word characters until end of amend
      expect(autoSuggestInput['cursorPosition']).toBe('git   commit --amend'.length)

      autoSuggestInput['moveWordLeft']()
      // back to start of '--amend' (non-space then word)
      // our word char set treats letters/digits/underscore as words; '-' are separators
      // so we should land right before 'amend'
      expect(autoSuggestInput['currentInput'][autoSuggestInput['cursorPosition']]).toBe('a')
    })

    it('deleteCharUnderCursor removes character at cursor', () => {
      autoSuggestInput['currentInput'] = 'abcd'
      autoSuggestInput['cursorPosition'] = 1 // at 'b'
      autoSuggestInput['deleteCharUnderCursor']()
      expect(autoSuggestInput['currentInput']).toBe('acd')
      expect(autoSuggestInput['cursorPosition']).toBe(1)
    })

    it('killToEnd truncates at cursor', () => {
      autoSuggestInput['currentInput'] = 'abcdef'
      autoSuggestInput['cursorPosition'] = 3
      autoSuggestInput['killToEnd']()
      expect(autoSuggestInput['currentInput']).toBe('abc')
      expect(autoSuggestInput['cursorPosition']).toBe(3)
    })

    it('killToStart removes from start to cursor and moves cursor to 0', () => {
      autoSuggestInput['currentInput'] = 'abcdef'
      autoSuggestInput['cursorPosition'] = 4
      autoSuggestInput['killToStart']()
      expect(autoSuggestInput['currentInput']).toBe('ef')
      expect(autoSuggestInput['cursorPosition']).toBe(0)
    })

    it('deleteWordLeft deletes previous word', () => {
      autoSuggestInput['currentInput'] = 'hello world'
      autoSuggestInput['cursorPosition'] = 11
      autoSuggestInput['deleteWordLeft']()
      expect(autoSuggestInput['currentInput']).toBe('hello ')
      expect(autoSuggestInput['cursorPosition']).toBe(6)
    })

    it('deleteWordRight deletes next word', () => {
      autoSuggestInput['currentInput'] = 'echo   test file'
      autoSuggestInput['cursorPosition'] = 7 // between spaces before 'test'
      autoSuggestInput['deleteWordRight']()
      expect(autoSuggestInput['currentInput']).toBe('echo    file')
      expect(autoSuggestInput['cursorPosition']).toBe(7)
    })
  })

  describe('multi-line navigation', () => {
    it('moveCursorUp/Down preserves column across lines', () => {
      autoSuggestInput['currentInput'] = 'first line\nsecond\nthird line'
      // Place cursor at column 3 (0-based) of second line ("second")
      const idxSecondLineCol3 = autoSuggestInput['lineColToIndex'](1, 3)
      autoSuggestInput['cursorPosition'] = idxSecondLineCol3

      // Move up -> should go to line 0, col 3
      autoSuggestInput['moveCursorUp']()
      let pos = autoSuggestInput['cursorPosition']
      let lc = autoSuggestInput['indexToLineCol'](pos)
      expect(lc.line).toBe(0)
      expect(lc.col).toBe(3)

      // Move down twice -> to line 2, preserving col 3
      autoSuggestInput['moveCursorDown']()
      autoSuggestInput['moveCursorDown']()
      pos = autoSuggestInput['cursorPosition']
      lc = autoSuggestInput['indexToLineCol'](pos)
      expect(lc.line).toBe(2)
      // line 2 is "third line" length 10, col 3 valid
      expect(lc.col).toBe(3)
    })

    it('moveCursorUp/Down clamps to line length when necessary', () => {
      autoSuggestInput['currentInput'] = 'short\na bit longer\nmid'
      // Choose a column beyond length of line 0 and 2, e.g., col 8
      const startIdx = autoSuggestInput['lineColToIndex'](1, 8) // line 1 has enough length
      autoSuggestInput['cursorPosition'] = startIdx

      // Move up -> line 0 length is 5 ("short"), expect col clamped to 5
      autoSuggestInput['moveCursorUp']()
      let lc = autoSuggestInput['indexToLineCol'](autoSuggestInput['cursorPosition'])
      expect(lc.line).toBe(0)
      expect(lc.col).toBe('short'.length)

      // Move down twice -> line 2 is "mid" length 3, expect col clamped to 3
      autoSuggestInput['moveCursorDown']()
      autoSuggestInput['moveCursorDown']()
      lc = autoSuggestInput['indexToLineCol'](autoSuggestInput['cursorPosition'])
      expect(lc.line).toBe(2)
      expect(lc.col).toBe('mid'.length)
    })

    it('Home/End (line-aware) move to start/end of current line', () => {
      autoSuggestInput['currentInput'] = 'alpha beta\ngamma\ndelta'
      // Put cursor on line 1, col 2
      autoSuggestInput['cursorPosition'] = autoSuggestInput['lineColToIndex'](1, 2)

      // Home -> start of line 1
      autoSuggestInput['moveToLineStart']()
      let lc = autoSuggestInput['indexToLineCol'](autoSuggestInput['cursorPosition'])
      expect(lc.line).toBe(1)
      expect(lc.col).toBe(0)

      // End -> end of line 1 ("gamma")
      autoSuggestInput['moveToLineEnd']()
      lc = autoSuggestInput['indexToLineCol'](autoSuggestInput['cursorPosition'])
      expect(lc.line).toBe(1)
      expect(lc.col).toBe('gamma'.length)
    })
  })

  describe('multi-line backspace/delete', () => {
    it('backspace at start of a line joins with previous line and moves cursor to previous line end', () => {
      autoSuggestInput['setInputForTesting']('foo\nbar', undefined)
      // Place cursor at start of second line
      const startSecond = autoSuggestInput['lineColToIndex'](1, 0)
      autoSuggestInput['setCursorPositionForTesting'](startSecond)

      autoSuggestInput['backspaceOneForTesting']()

      expect(autoSuggestInput['getCurrentInputForTesting']()).toBe('foobar')
      const { line, col } = autoSuggestInput['indexToLineCol'](autoSuggestInput['getCursorPositionForTesting']())
      expect(line).toBe(0)
      expect(col).toBe('foo'.length)
    })

    it('delete at end of a line joins with next line and keeps cursor at join point', () => {
      autoSuggestInput['setInputForTesting']('abc\ndef', undefined)
      // Cursor at end of first line
      const endFirst = autoSuggestInput['lineColToIndex'](0, 'abc'.length)
      autoSuggestInput['setCursorPositionForTesting'](endFirst)

      autoSuggestInput['deleteOneForTesting']()

      expect(autoSuggestInput['getCurrentInputForTesting']()).toBe('abcdef')
      const { line, col } = autoSuggestInput['indexToLineCol'](autoSuggestInput['getCursorPositionForTesting']())
      expect(line).toBe(0)
      expect(col).toBe('abc'.length)
    })

    it('backspace/delete inside a line behaves normally', () => {
      autoSuggestInput['setInputForTesting']('hello\nworld', undefined)
      // Inside first line: remove the second character 'e'
      const pos = autoSuggestInput['lineColToIndex'](0, 1)
      autoSuggestInput['setCursorPositionForTesting'](pos + 1) // place after 'e'
      autoSuggestInput['backspaceOneForTesting']()
      expect(autoSuggestInput['getCurrentInputForTesting']()).toBe('hllo\nworld')

      // Now delete the 'l' under cursor
      autoSuggestInput['deleteOneForTesting']()
      expect(autoSuggestInput['getCurrentInputForTesting']()).toBe('hlo\nworld')
    })
  })
})
