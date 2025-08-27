import type { Shell } from '../types'
import type { AutoSuggestOptions } from './types'
import process from 'node:process'
import * as readline from 'node:readline'
import { sharedHistory } from '../history'
import { renderHighlighted } from './highlighting'
import { ReverseSearchManager } from './reverse-search'

export type { AutoSuggestOptions } from './types'

interface CursorPosition {
  line: number
  col: number
}

export class AutoSuggestInput {
  // Core dependencies
  private readonly shell: Shell
  private readonly options: Required<AutoSuggestOptions>
  private rl: readline.Interface | null = null
  private readonly reverseSearchManager: ReverseSearchManager
  private handleKeypress!: (str: string, key: { name: string, ctrl: boolean, meta: boolean, shift: boolean } | undefined) => void

  // Input state
  private currentInput: string = ''
  private cursorPosition: number = 0
  private historyIndex: number = -1
  private originalInput: string = ''
  private isShowingSuggestions: boolean = false
  private testMode: boolean = false
  private suggestions: string[] = []
  private selectedIndex: number = 0
  private currentSuggestion: string = ''
  private historyBrowseActive: boolean = false
  private groupedActive: boolean = false

  // Configuration defaults
  private static readonly DEFAULT_OPTIONS: Required<AutoSuggestOptions> = {
    maxSuggestions: 10,
    showInline: true,
    highlightColor: '\x1B[90m',
    suggestionColor: '\x1B[90m',
    keymap: 'emacs',
    syntaxHighlight: true,
    syntaxColors: {},
  }

  constructor(shell: Shell, options: AutoSuggestOptions = {}) {
    this.shell = shell
    this.options = { ...AutoSuggestInput.DEFAULT_OPTIONS, ...options }
    this.reverseSearchManager = new ReverseSearchManager(() => this.shell.history)
    this.initializeKeypressHandler()
  }

  // ===== Test Helpers =====
  public setInputForTesting(input: string, cursorPos?: number): void {
    this.currentInput = input
    this.cursorPosition = cursorPos !== undefined ? cursorPos : input.length
    // Reset history browsing when input changes
    this.historyBrowseActive = false
    this.historyIndex = -1
  }

  public setCursorPositionForTesting(pos: number): void {
    this.cursorPosition = Math.max(0, Math.min(pos, this.currentInput.length))
  }

  // ===== Cursor and Line Editing =====
  private lineColToIndex(line: number, col: number | string): number {
    const lines = this.currentInput.split('\n')
    let index = 0

    // Handle negative line numbers (count from end)
    const lineNum = line < 0 ? Math.max(0, lines.length + line) : line

    // Sum lengths of previous lines
    for (let i = 0; i < lineNum && i < lines.length; i++) {
      index += lines[i].length + 1 // +1 for newline
    }

    // Handle column
    const colNum = typeof col === 'string'
      ? lines[lineNum]?.indexOf(col) ?? 0
      : col

    return Math.min(index + Math.max(0, colNum), this.currentInput.length)
  }

  private indexToLineCol(index: number): CursorPosition {
    const lines = this.currentInput.split('\n')
    let pos = 0

    for (let line = 0; line < lines.length; line++) {
      const lineLength = lines[line].length
      if (pos + lineLength >= index) {
        return { line, col: index - pos }
      }
      pos += lineLength + 1 // +1 for newline
    }

    // If we get here, return position at end of last line
    return {
      line: Math.max(0, lines.length - 1),
      col: lines[lines.length - 1]?.length ?? 0,
    }
  }

  public moveCursorUp(): void {
    const { line, col } = this.indexToLineCol(this.cursorPosition)
    if (line > 0) {
      const lines = this.currentInput.split('\n')
      const prevLineLength = lines[line - 1].length
      const newCol = Math.min(col, prevLineLength)
      this.cursorPosition = this.lineColToIndex(line - 1, newCol)
    }
  }

  public moveCursorDown(): void {
    const { line, col } = this.indexToLineCol(this.cursorPosition)
    const lines = this.currentInput.split('\n')
    if (line < lines.length - 1) {
      const nextLineLength = lines[line + 1].length
      const newCol = Math.min(col, nextLineLength)
      this.cursorPosition = this.lineColToIndex(line + 1, newCol)
    }
  }

  public moveToLineStart(): void {
    const { line } = this.indexToLineCol(this.cursorPosition)
    this.cursorPosition = this.lineColToIndex(line, 0)
  }

  public moveToLineEnd(): void {
    const { line } = this.indexToLineCol(this.cursorPosition)
    const lines = this.currentInput.split('\n')
    const lineLength = lines[line].length
    this.cursorPosition = this.lineColToIndex(line, lineLength)
  }

  public backspaceOneForTesting(): void {
    if (this.cursorPosition > 0) {
      const before = this.currentInput.slice(0, this.cursorPosition - 1)
      const after = this.currentInput.slice(this.cursorPosition)
      this.currentInput = before + after
      this.cursorPosition--
    }
  }

  public deleteOneForTesting(): void {
    if (this.cursorPosition < this.currentInput.length) {
      const before = this.currentInput.slice(0, this.cursorPosition)
      const after = this.currentInput.slice(this.cursorPosition + 1)
      this.currentInput = before + after
    }
  }

  // Navigation and display methods
  private navigateHistory(direction: 'up' | 'down'): void {
    if (direction === 'up') {
      if (this.historyIndex === -1) {
        // Starting history navigation
        this.originalInput = this.currentInput
        this.historyBrowseActive = true

        // Clear suggestions when entering history mode
        this.currentSuggestion = ''
        this.isShowingSuggestions = false

        // For empty input, get the most recent command
        if (this.currentInput === '') {
          if (this.shell.history.length > 0) {
            this.historyIndex = 0
            this.currentInput = this.shell.history[this.shell.history.length - 1]
            this.cursorPosition = this.currentInput.length
          }
          return
        }
      }

      // Find next matching history item (including duplicates)
      const prefix = this.originalInput
      let newIndex = this.historyIndex + 1

      while (newIndex < this.shell.history.length) {
        const historyItem = this.shell.history[this.shell.history.length - 1 - newIndex]
        if (historyItem.startsWith(prefix)) {
          this.historyIndex = newIndex
          this.currentInput = historyItem
          this.cursorPosition = this.currentInput.length
          return
        }
        newIndex++
      }
    }
    else {
      // Moving down in history
      if (this.historyIndex > 0) {
        // Find previous matching history item
        const prefix = this.originalInput
        let newIndex = this.historyIndex - 1

        while (newIndex >= 0) {
          const historyItem = this.shell.history[this.shell.history.length - 1 - newIndex]
          if (historyItem.startsWith(prefix)) {
            this.historyIndex = newIndex
            this.currentInput = historyItem
            this.cursorPosition = this.currentInput.length
            return
          }
          newIndex--
        }

        // No more matching history, restore original input
        this.historyIndex = -1
        this.currentInput = this.originalInput
        this.cursorPosition = this.currentInput.length
        this.historyBrowseActive = false
      }
      else if (this.historyIndex === 0) {
        // At the most recent history item, restore original input
        this.historyIndex = -1
        this.currentInput = this.originalInput
        this.cursorPosition = this.currentInput.length
        this.historyBrowseActive = false
      }
      else if (!this.historyBrowseActive && this.currentInput === '') {
        // Down on empty prompt when not browsing - do nothing
      }
    }
  }

  private updateDisplay(prompt: string): void {
    if (this.testMode)
      return

    // Clear the current line and any suggestion lines below
    process.stdout.write('\r\x1B[2K')

    // Apply syntax highlighting if enabled
    const displayText = this.options.syntaxHighlight
      ? this.applySyntaxHighlighting(this.currentInput)
      : this.currentInput

    // Show inline suggestion only if not browsing history, not showing suggestions list, and not in reverse search
    let inlineSuggestion = ''
    if (!this.historyBrowseActive && !this.isShowingSuggestions && !this.reverseSearchManager.isActive() && this.currentSuggestion) {
      inlineSuggestion = `${this.options.suggestionColor}${this.currentSuggestion}\x1B[0m`
    }

    // Write the prompt, current input, and inline suggestion
    const fullText = prompt + displayText + inlineSuggestion
    process.stdout.write(fullText)

    // Handle suggestions list display
    if (this.isShowingSuggestions && this.suggestions.length > 0) {
      for (let i = 0; i < this.suggestions.length; i++) {
        const suggestion = this.suggestions[i]
        const isSelected = i === this.selectedIndex
        const prefix = isSelected ? '> ' : '  '
        const color = isSelected ? '\x1B[7m' : '' // Reverse video for selected
        const reset = isSelected ? '\x1B[0m' : ''
        process.stdout.write(`\n\x1B[2K${prefix}${color}${suggestion}${reset}`)
      }
    }

    // Position the cursor correctly (after prompt + input, before inline suggestion)
    const cursorPos = prompt.length + this.cursorPosition
    process.stdout.write(`\x1B[${cursorPos + 1}G`) // Move to column (1-based)
  }

  private applySyntaxHighlighting(input: string): string {
    if (!this.options.syntaxHighlight)
      return input
    return renderHighlighted(input, this.options.syntaxColors, this.options.highlightColor)
  }

  // Initialize keypress handler
  private initializeKeypressHandler(): void {
    this.handleKeypress = (str: string, key: { name: string, ctrl: boolean, meta: boolean, shift: boolean } | undefined): void => {
      if (!key)
        return

      // Handle Ctrl+C
      if (key.ctrl && key.name === 'c') {
        process.stdout.write('\n')
        this.reset()
      }
      // Handle arrow keys
      else if (key.name === 'up') {
        this.moveCursorUp()
      }
      else if (key.name === 'down') {
        this.moveCursorDown()
      }
      else if (key.name === 'left') {
        this.cursorPosition = Math.max(0, this.cursorPosition - 1)
      }
      else if (key.name === 'right') {
        this.cursorPosition = Math.min(this.currentInput.length, this.cursorPosition + 1)
      }
      // Handle home/end
      else if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
        this.moveToLineStart()
      }
      else if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        this.moveToLineEnd()
      }
      // Handle backspace
      else if (key.name === 'backspace') {
        if (this.cursorPosition > 0) {
          const before = this.currentInput.slice(0, this.cursorPosition - 1)
          const after = this.currentInput.slice(this.cursorPosition)
          this.currentInput = before + after
          this.cursorPosition--
        }
      }
      // Handle delete
      else if (key.name === 'delete') {
        if (this.cursorPosition < this.currentInput.length) {
          const before = this.currentInput.slice(0, this.cursorPosition)
          const after = this.currentInput.slice(this.cursorPosition + 1)
          this.currentInput = before + after
        }
      }
      // Handle enter
      else if (key.name === 'return') {
        process.stdout.write('\n')
        this.rl?.close()
      }
    }
  }

  // Public methods
  public async readLine(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '',
        terminal: true,
        historySize: 0, // We handle history ourselves
      })

      // Set up keypress listener with custom handler for Ctrl+C
      const onKeypress = (str: string, key: { name: string, ctrl: boolean, meta?: boolean, shift?: boolean }) => {
        if (key.ctrl && key.name === 'c') {
          process.stdout.write('\n')
          this.cleanup()
          resolve('') // Resolve with empty string on Ctrl+C
          return
        }
        this.handleKeypress(str, { ...key, meta: key.meta || false, shift: key.shift || false })
      }
      process.stdin.on('keypress', onKeypress)

      // Initial display
      this.updateDisplay(prompt)

      // Handle line input
      this.rl.on('line', (input) => {
        this.currentInput = input
        resolve(this.currentInput)
        this.cleanup()
      })

      // Handle close
      this.rl.on('close', () => {
        resolve('') // Resolve with empty string on close
        this.cleanup()
      })
    })
  }

  // Clean up resources
  private cleanup(): void {
    if (this.rl) {
      process.stdin.removeListener('keypress', this.handleKeypress)
      this.rl.close()
      this.rl = null
    }
  }

  // Reset input state
  public reset(): void {
    this.currentInput = ''
    this.cursorPosition = 0
    this.historyIndex = -1
    this.originalInput = ''
    this.isShowingSuggestions = false
    this.suggestions = []
    this.selectedIndex = 0
    this.currentSuggestion = ''
  }

  // Get completion text from various completion types
  private getCompletionText(comp: string | { text: string } | { items: Array<string | { text: string }> }): string {
    if (typeof comp === 'string')
      return comp
    if ('text' in comp)
      return comp.text
    if ('items' in comp && comp.items.length > 0) {
      const first = comp.items[0]
      return typeof first === 'string' ? first : first.text
    }
    return ''
  }

  // Reverse search functionality
  public startReverseSearch(): void {
    this.reverseSearchManager.start()
    this.currentInput = this.reverseSearchManager.getCurrentMatch()
    this.cursorPosition = this.currentInput.length
    this.updateReverseSearch()
  }

  public cycleReverseSearch(): void {
    const result = this.reverseSearchManager.cycle()
    if (result) {
      this.currentInput = result
      this.cursorPosition = this.currentInput.length
      this.updateReverseSearch()
    }
  }

  public cancelReverseSearch(): void {
    this.reverseSearchManager.cancel()
    this.currentInput = ''
    this.cursorPosition = 0
  }

  public updateReverseSearch(query?: string): void {
    if (query !== undefined) {
      const result = this.reverseSearchManager.update(query)
      if (result) {
        this.currentInput = result
        this.cursorPosition = this.currentInput.length
      }
    }
    this.updateReverseSearchDisplay()
  }

  private updateReverseSearchDisplay(): void {
    if (!this.reverseSearchManager.isActive()) {
      return
    }

    const status = this.reverseSearchStatus()
    process.stdout.write(`\r${status}`)
    readline.cursorTo(process.stdout, process.stdout.columns - 1)
  }

  public reverseSearchStatus(): string {
    return this.reverseSearchManager.getStatus()
  }

  // Get the current input for testing
  public getCurrentInputForTesting(): string {
    return this.currentInput
  }

  // Get the current cursor position for testing
  public getCursorPositionForTesting(): number {
    return this.cursorPosition
  }

  /**
   * Expands history references in the input string
   * @param input Input string containing history references
   * @returns Expanded string with history references replaced
   */
  private expandHistory(input: string): string {
    if (!input.includes('!'))
      return input

    // Use shell history if available, otherwise fall back to shared history
    const history = this.shell.history || sharedHistory.getHistory()

    // Handle !! - replace with last command
    input = input.replace(/!!/g, () => {
      return history[history.length - 1] || ''
    })

    // Handle !n (where n is a number) - replace with nth command (1-based)
    input = input.replace(/!(\d+)/g, (match, n) => {
      const index = Number.parseInt(n, 10) - 1
      return (index >= 0 && index < history.length)
        ? history[index]
        : ''
    })

    // Handle !prefix - replace with most recent matching command
    input = input.replace(/!([^\s!]+)/g, (match, prefix) => {
      // Find the most recent command that starts with the prefix
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].startsWith(prefix)) {
          return history[i]
        }
      }
      // If no match, remove the !prefix
      return ''
    })

    return input
  }

  // Update display for testing
  public updateDisplayForTesting(prompt: string): void {
    this.updateDisplay(prompt)
  }

  // Apply selected completion
  public applySelectedCompletion(): void {
    if (this.suggestions.length === 0)
      return

    const completion = this.suggestions[this.selectedIndex]
    if (!completion)
      return

    this.currentInput = completion
    this.cursorPosition = completion.length
    this.suggestions = []
    this.selectedIndex = 0
  }

  // Key helper methods
  public moveCursorLeft(): void {
    this.cursorPosition = Math.max(0, this.cursorPosition - 1)
  }

  public moveCursorRight(): void {
    this.cursorPosition = Math.min(this.currentInput.length, this.cursorPosition + 1)
  }

  public moveWordLeft(): void {
    if (this.cursorPosition === 0)
      return

    let pos = this.cursorPosition - 1
    const input = this.currentInput

    // Skip any whitespace
    while (pos > 0 && /\s/.test(input[pos])) {
      pos--
    }

    // If we're at the start of input, we're done
    if (pos === 0) {
      this.cursorPosition = 0
      return
    }

    // Special case: if we're at a non-word char (like -), move past it
    if (!/\w/.test(input[pos]) && pos > 0) {
      pos--
    }

    // Now find the start of the word
    while (pos > 0) {
      // Break if we hit whitespace
      if (/\s/.test(input[pos - 1]))
        break

      // Break if we hit a word boundary
      const current = input[pos]
      const prev = input[pos - 1]

      // If current is word char and prev is not (or vice versa), we've found a boundary
      const currentIsWord = /\w/.test(current)
      const prevIsWord = /\w/.test(prev)
      if (currentIsWord !== prevIsWord) {
        // If we're at the start of a word, stop here
        if (currentIsWord && !prevIsWord)
          break
        // If we're at the end of a word, move to the start of it
        if (!currentIsWord && prevIsWord) {
          pos--
          break
        }
      }

      pos--
    }

    this.cursorPosition = Math.max(0, pos)
  }

  public moveWordRight(): void {
    if (this.cursorPosition >= this.currentInput.length)
      return

    let pos = this.cursorPosition
    const input = this.currentInput

    // Skip any leading whitespace
    while (pos < input.length && /\s/.test(input[pos])) {
      pos++
    }

    // If we're at a word character, skip to the end of the word
    if (pos < input.length) {
      // Handle word characters
      while (pos < input.length && /[\w-]/.test(input[pos])) {
        pos++
      }
      // Handle non-word, non-whitespace characters (like punctuation)
      while (pos < input.length && !/[\w\s-]/.test(input[pos])) {
        pos++
      }
    }

    this.cursorPosition = Math.min(pos, input.length)
  }

  public deleteCharUnderCursor(): void {
    if (this.cursorPosition < this.currentInput.length) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition)
        + this.currentInput.slice(this.cursorPosition + 1)
    }
  }

  public killToEnd(): void {
    this.currentInput = this.currentInput.slice(0, this.cursorPosition)
  }

  public killToStart(): void {
    this.currentInput = this.currentInput.slice(this.cursorPosition)
    this.cursorPosition = 0
  }

  public deleteWordLeft(): void {
    if (this.cursorPosition === 0)
      return

    const beforeCursor = this.currentInput.slice(0, this.cursorPosition)
    const afterCursor = this.currentInput.slice(this.cursorPosition)

    // Find the start of the previous word
    // Using [^\w\s-] to match non-word characters (except spaces and hyphens)
    const match = beforeCursor.match(/([\w-]+|[^\w\s-]+)\s*$/)
    if (match) {
      this.currentInput = beforeCursor.slice(0, match.index) + afterCursor
      this.cursorPosition = match.index || 0
    }
  }

  public deleteWordRight(): void {
    if (this.cursorPosition >= this.currentInput.length)
      return

    const beforeCursor = this.currentInput.slice(0, this.cursorPosition)
    const afterCursor = this.currentInput.slice(this.cursorPosition)

    // Find the end of the next word
    const match = afterCursor.match(/^(\s*[^\w-]\s*|\s*\w+)/)
    if (match) {
      this.currentInput = beforeCursor + afterCursor.slice(match[0].length)
    }
  }

  // History navigation for testing
  public historyUpForTesting(): void {
    this.navigateHistory('up')
  }

  public historyDownForTesting(): void {
    this.navigateHistory('down')
  }

  // Shell mode management
  public setShellMode(_enabled: boolean): void {
    // This method is called by the shell to indicate it manages the prompt
    // Currently we don't need to store this state, but the method needs to exist
    // for compatibility with the shell initialization
  }
}
