import type { Shell } from '../types'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { sharedHistory } from '../history'

export interface AutoSuggestOptions {
  maxSuggestions?: number
  showInline?: boolean
  highlightColor?: string
  suggestionColor?: string
  // Keymap for line editing controls
  keymap?: 'emacs' | 'vi'
  // Enable lightweight syntax highlighting in input rendering
  syntaxHighlight?: boolean
  // Optional fine-grained colors for syntax tokens
  syntaxColors?: Partial<{
    command: string
    subcommand: string
    string: string
    operator: string
    variable: string
    flag: string
    number: string
    path: string
    comment: string
  }>
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
  // Vi mode state (only used when keymap === 'vi')
  private viMode: 'insert' | 'normal' = 'insert'
  // Reverse search state
  private reverseSearchActive = false
  private reverseSearchQuery = ''
  private reverseSearchMatches: string[] = []
  private reverseSearchIndex = 0

  constructor(shell: Shell, options: AutoSuggestOptions = {}) {
    this.shell = shell
    this.options = {
      maxSuggestions: 10,
      showInline: true,
      highlightColor: '\x1B[90m', // Gray
      suggestionColor: '\x1B[36m', // Cyan
      keymap: 'emacs',
      syntaxHighlight: true,
      syntaxColors: {
        command: '\x1B[36m', // cyan
        subcommand: '\x1B[94m', // bright blue
        string: '\x1B[90m', // gray
        operator: '\x1B[90m', // gray
        variable: '\x1B[90m', // gray
        flag: '\x1B[33m', // yellow
        number: '\x1B[35m', // magenta
        path: '\x1B[32m', // green
        comment: '\x1B[90m', // gray
      },
      ...options,
    }
  }

  // ===== History Expansion and Reverse Search Helpers =====
  // Expand history references: !!, !n, !string
  private expandHistory(input: string): string {
    const hist = this.getHistoryArray()
    if (!hist || hist.length === 0)
      return input

    // !! -> last command (allow space or end after !!)
    input = input.replace(/(^|\s)!!(?=\s|$)/g, (_m: string, pre: string) => {
      const last = hist[hist.length - 1]
      return `${pre}${last ?? ''}`
    })

    // !n -> nth command (1-based)
    input = input.replace(/(^|\s)!(\d+)(?:\b|$)/g, (_m, pre: string, n: string) => {
      const idx = Number.parseInt(n, 10)
      const cmd = idx >= 1 && idx <= hist.length ? hist[idx - 1] : ''
      return `${pre}${cmd}`
    })

    // !string -> most recent command starting with string
    input = input.replace(/(^|\s)!([a-z][\w-]*)(?:\b|$)/gi, (_m, pre: string, prefix: string) => {
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].startsWith(prefix))
          return `${pre}${hist[i]}`
      }
      return `${pre}`
    })

    return input
  }

  private getHistoryArray(): string[] | undefined {
    const arr = (this.shell as any)?.history as string[] | undefined
    if (arr && Array.isArray(arr))
      return arr
    try {
      const shared = sharedHistory as any
      if (shared && typeof shared.getHistory === 'function')
        return shared.getHistory()
    }
    catch {}
    return undefined
  }

  private startReverseSearch() {
    this.reverseSearchActive = true
    this.reverseSearchQuery = ''
    this.reverseSearchMatches = this.computeReverseMatches()
    this.reverseSearchIndex = Math.max(0, this.reverseSearchMatches.length - 1)
  }

  private updateReverseSearch(ch: string) {
    if (ch === '\\b') {
      this.reverseSearchQuery = this.reverseSearchQuery.slice(0, -1)
    }
    else {
      this.reverseSearchQuery += ch
    }
    this.reverseSearchMatches = this.computeReverseMatches()
    this.reverseSearchIndex = Math.max(0, this.reverseSearchMatches.length - 1)
    const cur = this.reverseSearchMatches[this.reverseSearchIndex]
    if (cur) {
      this.currentInput = cur
      this.cursorPosition = this.currentInput.length
    }
  }

  private cycleReverseSearch() {
    if (!this.reverseSearchActive)
      return
    if (this.reverseSearchMatches.length === 0)
      return
    this.reverseSearchIndex = (this.reverseSearchIndex - 1 + this.reverseSearchMatches.length) % this.reverseSearchMatches.length
    const cur = this.reverseSearchMatches[this.reverseSearchIndex]
    if (cur) {
      this.currentInput = cur
      this.cursorPosition = this.currentInput.length
    }
  }

  private cancelReverseSearch() {
    this.reverseSearchActive = false
    this.reverseSearchQuery = ''
    this.reverseSearchMatches = []
    this.reverseSearchIndex = 0
  }

  private computeReverseMatches(): string[] {
    const hist = this.getHistoryArray() || []
    if (!this.reverseSearchQuery)
      return hist.slice()
    const q = this.reverseSearchQuery.toLowerCase()
    return hist.filter(h => h.toLowerCase().includes(q))
  }

  private reverseSearchStatus(): string {
    if (!this.reverseSearchActive)
      return ''
    const q = this.reverseSearchQuery
    const cur = this.reverseSearchMatches[this.reverseSearchIndex] || ''
    return `(reverse-i-search) '${q}': ${cur}`
  }

  // Current line prefix up to cursor (after last newline)
  private getCurrentLinePrefix(): string {
    const upto = this.currentInput.slice(0, this.cursorPosition)
    const nl = upto.lastIndexOf('\n')
    return nl >= 0 ? upto.slice(nl + 1) : upto
  }

  // Suggest from history: entries starting with prefix, most recent first, deduped
  private getHistorySuggestions(prefix: string): string[] {
    const history = ((this.shell as any)?.history as string[] | undefined)
      ?? (sharedHistory?.getHistory ? sharedHistory.getHistory() : undefined)
    if (!history || !prefix)
      return []
    const seen = new Set<string>()
    const out: string[] = []
    // iterate from most recent to oldest
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i]
      if (typeof h !== 'string')
        continue
      if (!h.startsWith(prefix))
        continue
      if (seen.has(h))
        continue
      seen.add(h)
      out.push(h)
      if (out.length >= (this.options.maxSuggestions ?? 10))
        break
    }
    return out
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
            // If reverse search active, accept current match
            if (this.reverseSearchActive) {
              const match = this.reverseSearchMatches[this.reverseSearchIndex]
              if (match) {
                this.currentInput = match
                this.cursorPosition = this.currentInput.length
              }
              this.cancelReverseSearch()
            }
            const expanded = this.expandHistory(this.currentInput)
            const result = expanded.trim()
            cleanup()
            stdout.write('\n')
            resolve(result || null)
            return
          }

          // Handle Ctrl+J: insert newline for multi-line editing
          if (key.ctrl && key.name === 'j') {
            // In vi normal mode, ignore
            if (!(this.options.keymap === 'vi' && this.viMode === 'normal')) {
              this.currentInput = `${this.currentInput.slice(0, this.cursorPosition)}\n${this.currentInput.slice(this.cursorPosition)}`
              this.cursorPosition++
              this.updateSuggestions()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle screen clear (Ctrl+L)
          if (key.ctrl && key.name === 'l') {
            // Clear the screen and re-render prompt+input
            stdout.write('\x1B[2J\x1B[H')
            this.promptAlreadyWritten = false
            this.updateDisplay(prompt)
            return
          }

          // Reverse search (Ctrl+R)
          if (key.ctrl && key.name === 'r') {
            if (!this.reverseSearchActive) {
              this.startReverseSearch()
            }
            else {
              this.cycleReverseSearch()
            }
            this.updateDisplay(prompt)
            return
          }

          // While reverse search active: handle typing/backspace/cancel
          if (this.reverseSearchActive) {
            if (str && str.length === 1 && !key.ctrl && !key.meta && !key.sequence?.startsWith('\u001B')) {
              this.updateReverseSearch(str)
              this.updateDisplay(prompt)
              return
            }
            if (key.name === 'backspace') {
              this.updateReverseSearch('\b')
              this.updateDisplay(prompt)
              return
            }
            if (key.name === 'escape' || (key.ctrl && key.name === 'g')) {
              this.cancelReverseSearch()
              this.updateDisplay(prompt)
              return
            }
          }

          // If using vi keymap, handle mode switches and normal-mode keys
          if (this.options.keymap === 'vi') {
            // ESC enters normal mode
            if (key.name === 'escape') {
              this.viMode = 'normal'
              return
            }
            if (this.viMode === 'normal') {
              // Basic vi normal mode commands
              if (key.name === 'h') {
                this.moveCursorLeft()
                this.updateDisplay(prompt)
                return
              }
              if (key.name === 'l') {
                this.moveCursorRight()
                this.updateDisplay(prompt)
                return
              }
              // Vi vertical movement
              if (key.name === 'k') {
                this.moveCursorUp()
                this.updateDisplay(prompt)
                return
              }
              if (key.name === 'j') {
                this.moveCursorDown()
                this.updateDisplay(prompt)
                return
              }
              if (key.name === 'i') {
                this.viMode = 'insert'
                return
              }
              if (key.name === 'a') {
                this.moveCursorRight()
                this.viMode = 'insert'
                this.updateDisplay(prompt)
                return
              }
              if (key.name === 'x') {
                this.deleteCharUnderCursor()
                this.updateSuggestions()
                this.updateDisplay(prompt)
                return
              }
              if (key.sequence === '0') {
                this.moveToLineStart()
                this.updateDisplay(prompt)
                return
              }
              if (key.shift && key.name === '4') { // Shift+4 is usually '$'
                this.moveToLineEnd()
                this.updateDisplay(prompt)
                return
              }
              // Word motions and deletions: w, b, dw, db
              if (key.name === 'w') {
                this.moveWordRight()
                this.updateDisplay(prompt)
                return
              }
              if (key.name === 'b') {
                this.moveWordLeft()
                this.updateDisplay(prompt)
                return
              }
              // Handle simple delete word forward/back via 'd' prefix
              if (key.name === 'd') {
                // Peek next key synchronously is not trivial; as a simple heuristic,
                // if a suggestion navigation is happening or no next key, delete to end
                // For now, map 'd' to delete to end when followed by nothing
                // and support common combos via Alt+d / Ctrl+w in emacs section
                this.killToEnd()
                this.updateSuggestions()
                this.updateDisplay(prompt)
                return
              }
              // 'I' -> insert at start, 'A' -> insert at end
              if (key.shift && key.name === 'i') {
                this.moveToLineStart()
                this.viMode = 'insert'
                this.updateDisplay(prompt)
                return
              }
              if (key.shift && key.name === 'a') {
                this.moveToLineEnd()
                this.viMode = 'insert'
                this.updateDisplay(prompt)
                return
              }
              // 'dd' delete entire line: emulate by clearing content
              if (key.sequence === 'dd') {
                this.currentInput = ''
                this.cursorPosition = 0
                this.updateSuggestions()
                this.updateDisplay(prompt)
                return
              }
            }
          }

          // Handle Tab - accept current suggestion
          if (key.name === 'tab') {
            if (this.currentSuggestion) {
              this.acceptSuggestion()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle Arrow keys: prefer multi-line cursor movement over suggestions
          if (key.name === 'down') {
            if (this.currentInput.includes('\n')) {
              this.moveCursorDown()
              this.updateDisplay(prompt)
            }
            else if (this.suggestions.length > 0) {
              this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1)
              this.updateSuggestion()
              this.updateDisplay(prompt)
            }
            return
          }

          if (key.name === 'up') {
            if (this.currentInput.includes('\n')) {
              this.moveCursorUp()
              this.updateDisplay(prompt)
            }
            else if (this.suggestions.length > 0) {
              this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
              this.updateSuggestion()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle Backspace (multi-line aware)
          if (key.name === 'backspace') {
            if (this.cursorPosition > 0) {
              // Remove previous char; if it was a newline, we are joining lines
              this.currentInput = this.currentInput.slice(0, this.cursorPosition - 1)
                + this.currentInput.slice(this.cursorPosition)
              this.cursorPosition--
              this.updateSuggestions()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle Delete (multi-line aware: deleting a newline joins lines)
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
            this.moveCursorLeft()
            this.updateDisplay(prompt)
            return
          }

          if (key.name === 'right') {
            if (this.cursorPosition < this.currentInput.length) {
              this.moveCursorRight()
              this.updateDisplay(prompt)
            }
            else if (this.currentSuggestion) {
              // Accept suggestion when moving right at end
              this.acceptSuggestion()
              this.updateDisplay(prompt)
            }
            return
          }

          // Emacs-style shortcuts (also active in vi insert mode)
          if ((this.options.keymap === 'emacs') || (this.options.keymap === 'vi' && this.viMode === 'insert')) {
            // Move to start/end
            if (key.ctrl && key.name === 'a') {
              this.moveToLineStart()
              this.updateDisplay(prompt)
              return
            }
            if (key.ctrl && key.name === 'e') {
              this.moveToLineEnd()
              this.updateDisplay(prompt)
              return
            }
            // Kill to end/start
            if (key.ctrl && key.name === 'k') {
              this.killToEnd()
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            if (key.ctrl && key.name === 'u') {
              this.killToStart()
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            // Word motions
            if (key.meta && (key.name === 'b')) {
              this.moveWordLeft()
              this.updateDisplay(prompt)
              return
            }
            if (key.meta && (key.name === 'f')) {
              this.moveWordRight()
              this.updateDisplay(prompt)
              return
            }
            // Delete word forward/backward
            if (key.meta && (key.name === 'd')) {
              this.deleteWordRight()
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            if ((key.ctrl && key.name === 'w') || (key.meta && key.name === 'backspace')) {
              this.deleteWordLeft()
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            // Home/End
            if (key.name === 'home') {
              this.moveToLineStart()
              this.updateDisplay(prompt)
              return
            }
            if (key.name === 'end') {
              this.moveToLineEnd()
              this.updateDisplay(prompt)
              return
            }
          }

          // Handle regular character input
          if (str && str.length === 1 && !key.ctrl && !key.meta) {
            // In vi normal mode, characters are commands, not input
            if (this.options.keymap === 'vi' && this.viMode === 'normal') {
              return
            }
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
      // If no plugin completions, fall back to history-based matches
      if (this.suggestions.length === 0) {
        const prefix = this.getCurrentLinePrefix()
        const hist = this.getHistorySuggestions(prefix)
        if (hist.length > 0)
          this.suggestions = hist
      }
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
    if (this.currentInput === this.lastDisplayedInput
      && this.currentSuggestion === this.lastDisplayedSuggestion) {
      return
    }

    // Calculate visible prompt length (excluding ANSI escape sequences)
    const visiblePromptLength = this.getVisibleLength(prompt)
    const cursorColumn = visiblePromptLength + this.cursorPosition + 1 // +1 for 1-based column

    const hasNewlines = this.currentInput.includes('\n')
    if (this.shellMode && this.promptAlreadyWritten && !hasNewlines) {
      // Shell mode: only update input area, don't rewrite prompt
      const inputStartColumn = visiblePromptLength + 1

      // Save current cursor position
      stdout.write('\x1B7')

      // Move to start of input, clear to end of line, and write input (with optional highlighting)
      const renderedSingle = this.options.syntaxHighlight
        ? this.renderHighlighted(this.currentInput)
        : this.currentInput
      stdout.write(`\x1B[${inputStartColumn}G\x1B[K${renderedSingle}\x1B[0m`)

      // Show reverse search status inline (dim)
      if (this.reverseSearchActive) {
        const status = this.reverseSearchStatus()
        if (status)
          stdout.write(` ${this.options.highlightColor}${status}\x1B[0m`)
      }

      // Show inline suggestion if available
      if (this.options.showInline && this.currentSuggestion) {
        stdout.write(`${this.options.highlightColor}${this.currentSuggestion}\x1B[0m`)
      }

      // Clear any remaining characters from previous input
      if (this.lastDisplayedInput.length > this.currentInput.length) {
        const remainingChars = this.lastDisplayedInput.length - this.currentInput.length
        stdout.write(' '.repeat(remainingChars))
        stdout.write(`\x1B[${cursorColumn}G`) // Move cursor back to position
      }

      // Explicitly set cursor position after updates
      stdout.write(`\x1B[${cursorColumn}G`)

      // Restore cursor position if we're not at the end
      if (this.cursorPosition < this.currentInput.length) {
        // Calculate the actual cursor position in the line
        const actualCursorColumn = visiblePromptLength + this.cursorPosition + 1
        stdout.write(`\x1B[${actualCursorColumn}G`)
      }
    }
    else {
      // Isolated mode: always clear line and write prompt + input
      stdout.write('\r\x1B[2K')
      if (!hasNewlines) {
        // Single-line behavior
        const renderedSingle = this.options.syntaxHighlight
          ? this.renderHighlighted(this.currentInput)
          : this.currentInput
        stdout.write(`${prompt}${renderedSingle}\x1B[0m`)

        if (this.options.showInline && this.currentSuggestion) {
          stdout.write(`${this.options.highlightColor}${this.currentSuggestion}\x1B[0m`)
        }
        stdout.write(`\x1B[${cursorColumn}G`)
      }
      else {
        // Multi-line rendering with continuation prompt
        const lines = this.currentInput.split('\n')
        const contPrompt = (this.shell?.config?.theme?.prompt?.continuation ?? '... ')
        const visibleContLen = this.getVisibleLength(contPrompt)

        // Write first line with main prompt
        const firstLineRendered = this.options.syntaxHighlight ? this.renderHighlighted(lines[0]) : lines[0]
        stdout.write(`${prompt}${firstLineRendered}\x1B[0m`)
        if (this.reverseSearchActive) {
          const status = this.reverseSearchStatus()
          if (status)
            stdout.write(` ${this.options.highlightColor}${status}\x1B[0m`)
        }
        // Write subsequent lines with continuation prompt
        for (let i = 1; i < lines.length; i++) {
          const rendered = this.options.syntaxHighlight ? this.renderHighlighted(lines[i]) : lines[i]
          stdout.write(`\n\x1B[2K${contPrompt}${rendered}\x1B[0m`)
        }

        // Compute cursor target row/col
        const curIndex = this.cursorPosition
        // Determine current line index and column in that line
        let remaining = curIndex
        let lineIndex = 0
        for (let i = 0; i < lines.length; i++) {
          const len = lines[i].length
          if (remaining <= len) {
            lineIndex = i
            break
          }
          remaining -= (len + 1) // +1 for the newline
          lineIndex = i + 1
        }
        const colInLine = remaining
        const totalLines = lines.length

        // After writes, cursor is at end of last line. Move up to target line.
        const linesUp = (totalLines - 1) - lineIndex
        if (linesUp > 0)
          stdout.write(`\x1B[${linesUp}A`)
        // Set column based on prompt length for the target row
        const baseLen = lineIndex === 0 ? visiblePromptLength : visibleContLen
        const targetCol = baseLen + colInLine + 1
        stdout.write(`\x1B[${targetCol}G`)
      }
      this.promptAlreadyWritten = true
    }

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

  // Lightweight syntax highlighting for rendering only (does not affect state)
  private renderHighlighted(text: string): string {
    const reset = '\x1B[0m'
    const colors = {
      command: this.options.syntaxColors?.command ?? '\x1B[36m',
      subcommand: this.options.syntaxColors?.subcommand ?? '\x1B[94m',
      string: this.options.syntaxColors?.string ?? (this.options.highlightColor ?? '\x1B[90m'),
      operator: this.options.syntaxColors?.operator ?? (this.options.highlightColor ?? '\x1B[90m'),
      variable: this.options.syntaxColors?.variable ?? (this.options.highlightColor ?? '\x1B[90m'),
      flag: this.options.syntaxColors?.flag ?? '\x1B[33m',
      number: this.options.syntaxColors?.number ?? '\x1B[35m',
      path: this.options.syntaxColors?.path ?? '\x1B[32m',
      comment: this.options.syntaxColors?.comment ?? (this.options.highlightColor ?? '\x1B[90m'),
    }

    // Handle comments first: color from first unquoted # to end
    // Simple heuristic: split on first # not preceded by \
    let commentIndex = -1
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '#') {
        if (i === 0 || text[i - 1] !== '\\') {
          commentIndex = i
          break
        }
      }
    }
    if (commentIndex >= 0) {
      const left = text.slice(0, commentIndex)
      const comment = text.slice(commentIndex)
      return `${this.renderHighlighted(left)}${colors.comment}${comment}${reset}`
    }

    let out = text

    // Strings
    out = out.replace(/("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, `${colors.string}$1${reset}`)

    // Common subcommands for tools like git/npm/yarn/bun: color the subcommand token
    out = out.replace(/\b(git|npm|yarn|pnpm|bun)\s+([a-z][\w:-]*)/i, (_m, tool: string, sub: string) => {
      return `${tool} ${colors.subcommand}${sub}${reset}`
    })

    // Command at line start
    out = out.replace(/^([\w./-]+)/, `${colors.command}$1${reset}`)

    // Flags: -a, -xyz, --long-flag
    out = out.replace(/\s(--?[a-z][\w-]*)/gi, ` ${colors.flag}$1${reset}`)

    // Variables $VAR, ${VAR}, $1
    out = out.replace(/\$(?:\d+|\{?\w+\}?)/g, `${colors.variable}$&${reset}`)

    // Operators and pipes/redirections
    out = out.replace(/(\|\||&&|;|<<?|>>?)/g, `${colors.operator}$1${reset}`)

    // Numbers
    out = out.replace(/\b(\d+)\b/g, `${colors.number}$1${reset}`)

    // Paths: ./foo, ../bar, /usr/bin, ~/x
    out = out.replace(/((?:\.{1,2}|~)?\/[\w@%\-./]+)/g, `${colors.path}$1${reset}`)

    return out
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

  // Method for testing - get current input
  getCurrentInputForTesting(): string {
    return this.currentInput
  }

  // Method for testing - get cursor position
  getCursorPositionForTesting(): number {
    return this.cursorPosition
  }

  // Method for testing - set cursor position
  setCursorPositionForTesting(pos: number): void {
    this.cursorPosition = pos
  }

  // Cursor movement helpers
  private moveCursorLeft() {
    if (this.cursorPosition > 0)
      this.cursorPosition--
  }

  private moveCursorRight() {
    if (this.cursorPosition < this.currentInput.length)
      this.cursorPosition++
  }

  private moveToLineStart() {
    const { line } = this.indexToLineCol(this.cursorPosition)
    this.cursorPosition = this.lineColToIndex(line, 0)
  }

  private moveToLineEnd() {
    const { line } = this.indexToLineCol(this.cursorPosition)
    const lines = this.getLines()
    const endCol = (lines[line] ?? '').length
    this.cursorPosition = this.lineColToIndex(line, endCol)
  }

  private isWordChar(ch: string) {
    return /\w/.test(ch)
  }

  private moveWordLeft() {
    if (this.cursorPosition === 0)
      return
    let i = this.cursorPosition
    // Skip initial spaces to previous non-space
    while (i > 0 && this.currentInput[i - 1] === ' ') i--
    // Move over word characters
    while (i > 0 && this.isWordChar(this.currentInput[i - 1])) i--
    this.cursorPosition = i
  }

  private moveWordRight() {
    if (this.cursorPosition >= this.currentInput.length)
      return
    let i = this.cursorPosition
    // Skip spaces
    while (i < this.currentInput.length && this.currentInput[i] === ' ') {
      i++
    }
    // If at delimiters (non-space, non-word), skip them (e.g., '--')
    while (
      i < this.currentInput.length
      && this.currentInput[i] !== ' '
      && !this.isWordChar(this.currentInput[i])
    ) {
      i++
    }
    // Move over word characters
    while (i < this.currentInput.length && this.isWordChar(this.currentInput[i])) {
      i++
    }
    this.cursorPosition = i
  }

  private deleteCharUnderCursor() {
    if (this.cursorPosition < this.currentInput.length) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition)
        + this.currentInput.slice(this.cursorPosition + 1)
    }
  }

  // Testing helpers to simulate key behavior without raw stdin
  // Use only in tests
  backspaceOneForTesting(): void {
    if (this.cursorPosition > 0) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition - 1)
        + this.currentInput.slice(this.cursorPosition)
      this.cursorPosition--
      this.updateSuggestions()
    }
  }

  deleteOneForTesting(): void {
    this.deleteCharUnderCursor()
    this.updateSuggestions()
  }

  private killToEnd() {
    if (this.cursorPosition < this.currentInput.length) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition)
    }
  }

  private killToStart() {
    if (this.cursorPosition > 0) {
      this.currentInput = this.currentInput.slice(this.cursorPosition)
      this.cursorPosition = 0
    }
  }

  private deleteWordLeft() {
    if (this.cursorPosition === 0)
      return
    const end = this.cursorPosition
    // Find start of previous word
    let i = end
    while (i > 0 && this.currentInput[i - 1] === ' ') i--
    while (i > 0 && this.isWordChar(this.currentInput[i - 1])) i--
    this.currentInput = this.currentInput.slice(0, i) + this.currentInput.slice(end)
    this.cursorPosition = i
  }

  private deleteWordRight() {
    if (this.cursorPosition >= this.currentInput.length)
      return
    const start = this.cursorPosition
    let i = start
    while (i < this.currentInput.length && this.currentInput[i] === ' ') i++
    while (i < this.currentInput.length && this.isWordChar(this.currentInput[i])) i++
    this.currentInput = this.currentInput.slice(0, start) + this.currentInput.slice(i)
  }

  // Removed all suggestion list display methods to prevent UI clutter

  // Multi-line utilities and vertical movement
  private getLines(): string[] {
    return this.currentInput.split('\n')
  }

  private indexToLineCol(index: number): { line: number, col: number } {
    const lines = this.getLines()
    let remaining = Math.max(0, Math.min(index, this.currentInput.length))
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length
      if (remaining <= len)
        return { line: i, col: remaining }
      remaining -= (len + 1)
    }
    return { line: lines.length - 1, col: (lines[lines.length - 1] || '').length }
  }

  private lineColToIndex(line: number, col: number): number {
    const lines = this.getLines()
    const safeLine = Math.max(0, Math.min(line, lines.length - 1))
    let idx = 0
    for (let i = 0; i < safeLine; i++) idx += lines[i].length + 1
    const maxCol = (lines[safeLine] ?? '').length
    const safeCol = Math.max(0, Math.min(col, maxCol))
    return idx + safeCol
  }

  private moveCursorUp() {
    const { line, col } = this.indexToLineCol(this.cursorPosition)
    if (line === 0)
      return
    this.cursorPosition = this.lineColToIndex(line - 1, col)
  }

  private moveCursorDown() {
    const lines = this.getLines()
    const { line, col } = this.indexToLineCol(this.cursorPosition)
    if (line >= lines.length - 1)
      return
    this.cursorPosition = this.lineColToIndex(line + 1, col)
  }
}
