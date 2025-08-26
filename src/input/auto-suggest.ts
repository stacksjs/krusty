import type { Shell } from '../types'
import type { AutoSuggestOptions } from './types'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { visibleLength } from './ansi'
import { CursorMovement } from './cursor-movement'
import { InputHistoryManager } from './history-manager'
import { renderSingleLineIsolated, renderSingleLineShell } from './render'
import { ReverseSearchManager } from './reverse-search'
import { SuggestionManager } from './suggestion-manager'

export type { AutoSuggestOptions } from './types'

export class AutoSuggestInput {
  private shell: Shell
  private options: AutoSuggestOptions

  // Modular managers
  private historyManager: InputHistoryManager
  private reverseSearchManager: ReverseSearchManager
  private cursorMovement: CursorMovement
  private suggestionManager: SuggestionManager

  // Core state
  private currentInput = ''
  private cursorPosition = 0
  private shellMode = false
  private promptAlreadyWritten = false

  constructor(shell: Shell, options: AutoSuggestOptions = {}) {
    this.shell = shell
    this.options = {
      maxSuggestions: 10,
      showInline: true,
      highlightColor: '\x1B[90m',
      suggestionColor: '\x1B[90m',
      keymap: 'emacs',
      syntaxHighlight: true,
      ...options,
    }

    // Initialize managers
    this.historyManager = new InputHistoryManager(shell)
    this.reverseSearchManager = new ReverseSearchManager(() => this.historyManager.getHistoryArray())
    this.suggestionManager = new SuggestionManager(shell, this.options)

    this.cursorMovement = new CursorMovement(
      () => this.currentInput,
      () => this.cursorPosition,
      (pos: number) => { this.cursorPosition = pos },
    )
  }

  async readLine(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      const stdin = process.stdin
      const stdout = process.stdout

      // Enable raw mode for character-by-character input
      const canRaw = typeof (stdin as any).setRawMode === 'function' && (stdin as any).isTTY
      if (canRaw)
        (stdin as any).setRawMode(true)
      stdin.resume()
      emitKeypressEvents(stdin)

      // Reset state
      this.currentInput = ''
      this.cursorPosition = 0
      this.shellMode = true
      this.promptAlreadyWritten = true

      this.historyManager.resetHistoryBrowsing()
      this.reverseSearchManager.cancel()
      this.suggestionManager.reset()

      const cleanup = () => {
        try {
          if (typeof (stdin as any).setRawMode === 'function' && (stdin as any).isTTY)
            (stdin as any).setRawMode(false)
        }
        catch {}
        stdin.removeAllListeners('keypress')
      }

      const handleKeypress = (str: string, key: any) => {
        if (!key)
          return

        try {
          // Handle Ctrl+C
          if (key.ctrl && key.name === 'c') {
            stdout.write('\n')
            cleanup()
            resolve('')
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
            const expanded = this.historyManager.expandHistory(this.currentInput)
            const result = expanded.trim()
            cleanup()
            stdout.write('\n')
            resolve(result || null)
            return
          }

          // Handle regular character input
          if (str && str.length === 1 && !key.ctrl && !key.meta) {
            this.currentInput = this.currentInput.slice(0, this.cursorPosition) + str + this.currentInput.slice(this.cursorPosition)
            this.cursorPosition++
            this.updateDisplay(prompt)
            return
          }

          // Handle Backspace
          if (key.name === 'backspace') {
            if (this.cursorPosition > 0) {
              this.currentInput = this.currentInput.slice(0, this.cursorPosition - 1) + this.currentInput.slice(this.cursorPosition)
              this.cursorPosition--
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle arrow keys for history
          if (key.name === 'up') {
            const result = this.historyManager.navigateHistory('up', this.currentInput)
            this.currentInput = result.input
            this.cursorPosition = this.currentInput.length
            this.updateDisplay(prompt)
            return
          }

          if (key.name === 'down') {
            const result = this.historyManager.navigateHistory('down', this.currentInput)
            this.currentInput = result.input
            this.cursorPosition = this.currentInput.length
            this.updateDisplay(prompt)
            return
          }

          // Handle left/right arrows
          if (key.name === 'left') {
            this.cursorMovement.moveLeft()
            this.updateDisplay(prompt)
            return
          }

          if (key.name === 'right') {
            this.cursorMovement.moveRight()
            this.updateDisplay(prompt)
          }
        }
        catch (error) {
          console.error('Keypress error:', error)
        }
      }

      // Initial display
      this.updateDisplay(prompt)
      stdin.on('keypress', handleKeypress)
    })
  }

  private updateDisplay(prompt: string): void {
    const stdout = process.stdout
    const promptLastLine = prompt.slice(prompt.lastIndexOf('\n') + 1)
    const visiblePromptLastLen = visibleLength(promptLastLine)
    const cursorColumn = visiblePromptLastLen + this.cursorPosition + 1

    if (this.shellMode && this.promptAlreadyWritten) {
      // Shell mode: only update input area
      renderSingleLineShell(
        stdout,
        this.currentInput,
        this.options,
        visiblePromptLastLen,
        cursorColumn,
        false, // showInline
        '', // suggestion
        '', // reverseStatus
        0, // lastInputLength
      )
    }
    else {
      // Isolated mode: render prompt + input
      renderSingleLineIsolated(
        stdout,
        prompt,
        this.currentInput,
        this.options,
        visiblePromptLastLen,
        cursorColumn,
        false, // showInline
        '', // suggestion
        '', // reverseStatus
      )
      this.promptAlreadyWritten = true
    }
  }

  // Public method for shells to refresh the prompt
  public refreshPrompt(prompt: string): void {
    const stdout = process.stdout
    stdout.write(prompt)

    this.promptAlreadyWritten = true
    this.currentInput = ''
    this.cursorPosition = 0

    this.historyManager.resetHistoryBrowsing()
    this.reverseSearchManager.cancel()
    this.suggestionManager.reset()
  }

  // Method to enable shell mode
  setShellMode(enabled: boolean): void {
    this.shellMode = enabled
    this.promptAlreadyWritten = false
  }

  // Method to reset state
  reset(): void {
    this.currentInput = ''
    this.cursorPosition = 0
    this.promptAlreadyWritten = false
  }
}
