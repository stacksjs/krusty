import type { Shell } from '../types'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'

export interface AutoSuggestOptions {
  maxSuggestions?: number
  showInline?: boolean
  highlightColor?: string
  suggestionColor?: string
}

export class AutoSuggestInput {
  private shell: Shell
  private options: AutoSuggestOptions
  private currentInput = ''
  private currentSuggestion = ''
  private cursorPosition = 0
  private suggestions: string[] = []
  private selectedIndex = 0
  private isShowingSuggestions = false
  private isNavigatingSuggestions = false

  constructor(shell: Shell, options: AutoSuggestOptions = {}) {
    this.shell = shell
    this.options = {
      maxSuggestions: 10,
      showInline: true,
      highlightColor: '\x1B[90m', // Gray
      suggestionColor: '\x1B[36m', // Cyan
      ...options,
    }
  }

  async readLine(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      const stdin = process.stdin
      const stdout = process.stdout

      // Enable raw mode for character-by-character input
      stdin.setRawMode(true)
      stdin.resume()
      emitKeypressEvents(stdin)

      this.currentInput = ''
      this.currentSuggestion = ''
      this.cursorPosition = 0
      this.suggestions = []
      this.selectedIndex = 0
      this.isShowingSuggestions = false
      this.isNavigatingSuggestions = false

      // Don't write prompt - shell already wrote it via renderPrompt()
      // If shell mode is enabled, mark prompt as already written
      if (this.shellMode) {
        this.promptAlreadyWritten = true
      }

      const cleanup = () => {
        stdin.setRawMode(false)
        stdin.removeAllListeners('keypress')
      }

      const handleKeypress = (str: string, key: any) => {
        if (!key)
          return

        try {
          // Handle Ctrl+C
          if (key.ctrl && key.name === 'c') {
            cleanup()
            process.emit('SIGINT')
            return
          }

          // Handle Ctrl+D (EOF)
          if (key.ctrl && key.name === 'd') {
            cleanup()
            stdout.write('\n')
            resolve(null)
            return
          }

          // Handle Enter
          if (key.name === 'return') {
            const result = this.currentInput.trim()
            cleanup()
            stdout.write('\n')
            resolve(result || null)
            return
          }

          // Handle Tab - accept current suggestion
          if (key.name === 'tab') {
            if (this.currentSuggestion) {
              this.acceptSuggestion()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle Arrow keys for suggestion navigation
          if (key.name === 'down' && this.suggestions.length > 0) {
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1)
            this.updateSuggestion()
            this.updateDisplay(prompt)
            return
          }

          if (key.name === 'up' && this.suggestions.length > 0) {
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
            this.updateSuggestion()
            this.updateDisplay(prompt)
            return
          }

          // Handle Backspace
          if (key.name === 'backspace') {
            if (this.cursorPosition > 0) {
              this.currentInput = this.currentInput.slice(0, this.cursorPosition - 1)
                + this.currentInput.slice(this.cursorPosition)
              this.cursorPosition--
              this.updateSuggestions()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle Delete
          if (key.name === 'delete') {
            if (this.cursorPosition < this.currentInput.length) {
              this.currentInput = this.currentInput.slice(0, this.cursorPosition)
                + this.currentInput.slice(this.cursorPosition + 1)
              this.updateSuggestions()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle Left/Right arrow keys
          if (key.name === 'left') {
            if (this.cursorPosition > 0) {
              this.cursorPosition--
              this.updateDisplay(prompt)
            }
            return
          }

          if (key.name === 'right') {
            if (this.cursorPosition < this.currentInput.length) {
              this.cursorPosition++
              this.updateDisplay(prompt)
            }
            else if (this.currentSuggestion) {
              // Accept suggestion when moving right at end
              this.acceptSuggestion()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle regular character input
          if (str && str.length === 1 && !key.ctrl && !key.meta) {
            this.currentInput = this.currentInput.slice(0, this.cursorPosition)
              + str
              + this.currentInput.slice(this.cursorPosition)
            this.cursorPosition++
            this.updateSuggestions()
            this.updateDisplay(prompt)
          }
        }
        catch (error) {
          // Silently handle errors to prevent crashes
          console.error('Keypress error:', error)
        }
      }

      stdin.on('keypress', handleKeypress)
    })
  }

  private updateSuggestions() {
    try {
      // Get suggestions from shell (includes plugin completions)
      this.suggestions = this.shell.getCompletions(this.currentInput, this.cursorPosition)
      this.selectedIndex = 0
      this.updateSuggestion()
    }
    catch {
      this.suggestions = []
      this.currentSuggestion = ''
    }
  }

  private updateSuggestion() {
    if (this.suggestions.length > 0) {
      const selected = this.suggestions[this.selectedIndex]
      const inputBeforeCursor = this.currentInput.slice(0, this.cursorPosition)

      // Handle different completion scenarios
      if (inputBeforeCursor.trim() === '') {
        // Empty input - show full suggestion
        this.currentSuggestion = selected
      }
      else {
        // Find the last token to complete
        const tokens = inputBeforeCursor.trim().split(/\s+/)
        const lastToken = tokens[tokens.length - 1] || ''

        // Only show suggestion if it starts with the current token
        if (selected.toLowerCase().startsWith(lastToken.toLowerCase())) {
          this.currentSuggestion = selected.slice(lastToken.length)
        }
        else {
          this.currentSuggestion = ''
        }
      }
    }
    else {
      this.currentSuggestion = ''
    }
  }

  private acceptSuggestion() {
    if (this.currentSuggestion) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition)
        + this.currentSuggestion
        + this.currentInput.slice(this.cursorPosition)
      this.cursorPosition += this.currentSuggestion.length
      this.currentSuggestion = ''
      this.updateSuggestions()
    }
  }

  private lastDisplayedInput = ''
  private lastDisplayedSuggestion = ''
  private promptAlreadyWritten = false
  private shellMode = false

  private updateDisplay(prompt: string) {
    const stdout = process.stdout

    // Only update if input or suggestion actually changed
    if (this.currentInput === this.lastDisplayedInput && 
        this.currentSuggestion === this.lastDisplayedSuggestion) {
      return
    }

    // Calculate visible prompt length (excluding ANSI escape sequences)
    const visiblePromptLength = this.getVisibleLength(prompt)

    if (this.shellMode && this.promptAlreadyWritten) {
      // Shell mode: only update input area, don't rewrite prompt
      // Move to start of input area and clear to end of line
      const inputStartColumn = visiblePromptLength + 1
      stdout.write(`\x1B[${inputStartColumn}G\x1B[K`)
      stdout.write(this.currentInput)
    } else {
      // Isolated mode: always clear line and write prompt + input
      stdout.write('\r\x1B[2K')
      stdout.write(prompt + this.currentInput)
      this.promptAlreadyWritten = true
    }

    // Show inline suggestion if available
    if (this.options.showInline && this.currentSuggestion) {
      stdout.write(`${this.options.highlightColor}${this.currentSuggestion}\x1B[0m`)
    }

    // Move cursor to correct position using absolute positioning
    // Terminal columns are 1-based, cursorPosition indicates position within input
    const cursorColumn = visiblePromptLength + this.cursorPosition
    stdout.write(`\x1B[${cursorColumn}G`)

    // Remember what we displayed
    this.lastDisplayedInput = this.currentInput
    this.lastDisplayedSuggestion = this.currentSuggestion
  }

  // Helper method to calculate visible length of text (excluding ANSI escape sequences)
  private getVisibleLength(text: string): number {
    // Remove ANSI escape sequences to get actual visible length
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1B\[[0-9;]*[mGKH]/g, '').length
  }

  // Method to enable shell mode where prompt is managed externally
  setShellMode(enabled: boolean): void {
    this.shellMode = enabled
    if (enabled) {
      this.promptAlreadyWritten = true
    }
  }

  // Method to reset state when starting fresh input
  reset(): void {
    this.currentInput = ''
    this.currentSuggestion = ''
    this.cursorPosition = 0
    this.lastDisplayedInput = ''
    this.lastDisplayedSuggestion = ''
    this.promptAlreadyWritten = false
  }

  // Method for testing - allows setting input state directly
  setInputForTesting(input: string, cursorPos?: number): void {
    this.currentInput = input
    this.cursorPosition = cursorPos ?? input.length
    this.updateSuggestions()
  }

  // Method for testing - triggers display update with given prompt
  updateDisplayForTesting(prompt: string): void {
    this.updateDisplay(prompt)
  }

  // Removed all suggestion list display methods to prevent UI clutter
}
