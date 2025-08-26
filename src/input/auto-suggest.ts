import type { Buffer } from 'node:buffer'
import type { CompletionGroup, CompletionItem, Shell } from '../types'
import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'
import { sharedHistory } from '../history'
import { HistoryNavigator } from '../history/history-navigator'
import { displayWidth, truncateToWidth, visibleLength } from './ansi'
import { getLines as utilGetLines, indexToLineCol as utilIndexToLineCol, lineColToIndex as utilLineColToIndex } from './cursor-utils'
import { renderGroupedSuggestionList, renderMultiLineIsolated, renderSingleLineIsolated, renderSingleLineShell, renderSuggestionList } from './render'

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
  // Grouped completion state (when active)
  private groupedActive = false
  private groupedForRender: Array<{ title: string, items: Array<string | { text: string }> }> | null = null
  private groupedIndexMap: Array<{ group: number, idx: number }> = []
  // One-shot flags to influence suggestion behavior for special cases
  private forceHistoryOnlyOnce = false
  private suppressHistoryMergeOnce = false
  private specialRestoreGroupedOnce = false
  private inlineFromHistoryOnce: string | null = null
  // Track acceptance and post-accept edits
  private acceptedCompletion = false
  private editedSinceAccept = false
  private mouseTrackingEnabled = false

  private enableMouseTracking() {
    if (this.mouseTrackingEnabled || process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test')
      return
    this.mouseTrackingEnabled = true
    // Enable xterm mouse reporting and SGR mode
    process.stdout.write('\x1B[?1000h')
    process.stdout.write('\x1B[?1006h')
  }

  private disableMouseTracking() {
    if (!this.mouseTrackingEnabled || process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test')
      return
    this.mouseTrackingEnabled = false
    // Disable xterm mouse reporting and SGR mode
    process.stdout.write('\x1B[?1000l')
    process.stdout.write('\x1B[?1006l')
  }

  // Compute group first-index and lengths from current groupedIndexMap
  private getGroupedBoundaries(): { first: number[], lengths: number[] } {
    const groupFirstIndex: number[] = []
    const groupLengths: number[] = []
    for (let i = 0; i < this.groupedIndexMap.length; i++) {
      const g = this.groupedIndexMap[i].group
      if (groupFirstIndex[g] === undefined) {
        groupFirstIndex[g] = i
        groupLengths[g] = 1
      }
      else {
        groupLengths[g]++
      }
    }
    return { first: groupFirstIndex, lengths: groupLengths }
  }

  // Navigate within grouped suggestions. Returns true if handled.
  private navigateGrouped(direction: 'up' | 'down' | 'left' | 'right'): boolean {
    if (!this.groupedActive || this.groupedIndexMap.length === 0)
      return false
    const curMap = this.groupedIndexMap[this.selectedIndex]
    if (!curMap)
      return false
    const curGroup = curMap.group
    const { first: groupFirstIndex, lengths: groupLengths } = this.getGroupedBoundaries()
    const first = groupFirstIndex[curGroup] ?? 0
    const len = groupLengths[curGroup] ?? 1
    const offset = this.selectedIndex - first

    // Helper to compute the visual grid layout for a group, mirroring renderGroupedSuggestionList
    const computeLayout = (groupIndex: number) => {
      const g = this.groupedForRender?.[groupIndex]
      const labels: string[] = (g?.items || []).map((it: any) => typeof it === 'string' ? it : (it?.text ?? '')).filter((s: string) => !!s).slice().sort((a: string, b: string) => a.localeCompare(b))
      const colsTotal = process.stdout.columns ?? 80
      // gap must match renderer
      const gap = 2
      // column width based on max label display width within this group
      let maxLen = 0
      for (const s of labels)
        maxLen = Math.max(maxLen, displayWidth(s))
      const colWidth = Math.max(1, maxLen + 1)
      const columns = Math.max(1, Math.floor((colsTotal) / (colWidth + gap)))
      const rows = Math.max(1, Math.ceil(labels.length / columns))
      return { labels, columns, rows }
    }

    // Horizontal navigation moves within the same group (items laid out row-major)
    if (direction === 'left' || direction === 'right') {
      if (len <= 0)
        return false
      // Simple wrap at boundaries to avoid getting stuck on short last rows
      if (direction === 'right' && offset === len - 1) {
        this.selectedIndex = first
        return true
      }
      if (direction === 'left' && offset === 0) {
        this.selectedIndex = first + len - 1
        return true
      }
      const { columns } = computeLayout(curGroup)
      const row = Math.floor(offset / columns)
      const col = offset % columns
      let newRow = row
      let newCol = direction === 'left' ? col - 1 : col + 1
      // Wrap within group row-major order
      if (newCol < 0) {
        newRow -= 1
        if (newRow < 0)
          newRow = Math.ceil(len / columns) - 1
        newCol = columns - 1
      }
      const rowCount = Math.ceil(len / columns)
      if (newCol >= columns) {
        newCol = 0
        newRow += 1
        if (newRow >= rowCount)
          newRow = 0
      }
      // Clamp into existing items (last row may be shorter)
      const start = newRow * columns
      const end = Math.min(start + columns, len)
      const clampedCol = Math.min(newCol, Math.max(0, end - start - 1))
      const newOffset = start + clampedCol
      this.selectedIndex = first + newOffset
      return true
    }
    // Vertical navigation moves between rows inside the same group; only when crossing
    // top/bottom does it switch groups, preserving the column when possible.
    if (direction === 'up' || direction === 'down') {
      const { columns } = computeLayout(curGroup)
      const row = Math.floor(offset / columns)
      const col = offset % columns
      const rowCount = Math.ceil(len / columns)

      let newGroup = curGroup
      const newRow = row + (direction === 'up' ? -1 : 1)

      if (newRow < 0 || newRow >= rowCount) {
        // Switch groups when moving past top/bottom
        const totalGroups = Math.max(groupFirstIndex.length, ...this.groupedIndexMap.map(m => m.group + 1))
        newGroup = (curGroup + (direction === 'up' ? -1 : 1) + totalGroups) % totalGroups
        const targetFirst = groupFirstIndex[newGroup]
        const targetLen = groupLengths[newGroup] ?? 0
        if (typeof targetFirst === 'number' && targetLen > 0) {
          const { columns: tgtCols } = computeLayout(newGroup)
          const tgtRowCount = Math.ceil(targetLen / tgtCols)
          // If coming from top, go to last row; from bottom, go to first row
          const tRow = direction === 'up' ? (tgtRowCount - 1) : 0
          const start = tRow * tgtCols
          const end = Math.min(start + tgtCols, targetLen)
          const clampedCol = Math.min(col, Math.max(0, end - start - 1))
          this.selectedIndex = (targetFirst as number) + start + clampedCol
          return true
        }
        return false
      }

      // Stay within current group, move to same column in target row
      const start = newRow * columns
      const end = Math.min(start + columns, len)
      const clampedCol = Math.min(col, Math.max(0, end - start - 1))
      const newOffset = start + clampedCol
      this.selectedIndex = first + newOffset
      return true
    }
    return false
  }

  // Vi mode state (only used when keymap === 'vi')
  private viMode: 'insert' | 'normal' = 'insert'
  // Reverse search state
  private reverseSearchActive = false
  private reverseSearchQuery = ''
  private reverseSearchMatches: string[] = []
  private reverseSearchIndex = 0
  // History browse state for Up/Down when input is empty
  private historyBrowseActive = false
  private historyBrowseIndex = -1
  private historyBrowseSaved = ''
  // New: pure history navigator for prefix-filtered browsing
  private historyNav?: HistoryNavigator

  constructor(shell: Shell, options: AutoSuggestOptions = {}) {
    this.shell = shell
    this.options = {
      maxSuggestions: 10,
      showInline: true,
      highlightColor: '\x1B[90m', // Gray
      suggestionColor: '\x1B[90m', // Gray
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
    // Prefer a fresh snapshot from the shell's HistoryManager
    try {
      const hm = (this.shell as any)?.historyManager
      if (hm && typeof hm.getHistory === 'function') {
        const fresh = hm.getHistory()
        if (Array.isArray(fresh))
          return fresh
      }
    }
    catch {}

    // Fallback to shell.history if present
    const arr = (this.shell as any)?.history as string[] | undefined
    if (arr && Array.isArray(arr))
      return arr

    // Final fallback to shared singleton
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

  // Format reverse search status to fit in available width
  private formatReverseStatusForWidth(prompt: string): string {
    const raw = this.reverseSearchStatus()
    if (!raw)
      return ''
    const totalCols = process.stdout.columns ?? 80
    // For multi-line prompts/inputs, only the last line width matters for remaining columns
    const promptLastLine = prompt.slice(prompt.lastIndexOf('\n') + 1)
    const inputLastLine = (() => {
      const nl = this.currentInput.lastIndexOf('\n')
      return nl >= 0 ? this.currentInput.slice(nl + 1) : this.currentInput
    })()
    const used = displayWidth(promptLastLine) + displayWidth(inputLastLine)
    const available = Math.max(0, totalCols - used - 1) // space before status
    if (available <= 0)
      return ''
    if (displayWidth(raw) <= available)
      return raw
    // Truncate with ellipsis, prefer trimming current match first
    const base = `(reverse-i-search) '${this.reverseSearchQuery}': `
    const remain = Math.max(0, available - displayWidth(base) - 1)
    if (remain <= 0)
      return base.trimEnd()
    const cur = (this.reverseSearchMatches[this.reverseSearchIndex] || '')
    const trimmed = `${truncateToWidth(cur, Math.max(0, remain))}…`
    return `${base}${trimmed}`
  }

  // Current line prefix up to cursor (after last newline)
  private getCurrentLinePrefix(): string {
    const upto = this.currentInput.slice(0, this.cursorPosition)
    const nl = upto.lastIndexOf('\n')
    return nl >= 0 ? upto.slice(nl + 1) : upto
  }

  // Detect whether the current line is in `cd` context (i.e., starts with `cd` and optional arg)
  private isCdContext(): boolean {
    try {
      const line = this.getCurrentLinePrefix()
      return /^\s*cd(?:\s+|$)/i.test(line)
    }
    catch {
      return false
    }
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
      const canRaw = typeof (stdin as any).setRawMode === 'function' && (stdin as any).isTTY
      if (canRaw)
        (stdin as any).setRawMode(true)
      stdin.resume()
      emitKeypressEvents(stdin)

      this.currentInput = ''
      this.currentSuggestion = ''
      this.cursorPosition = 0
      this.suggestions = []
      this.selectedIndex = 0
      this.isShowingSuggestions = false
      // Set shell mode to prevent duplicate prompt rendering
      this.shellMode = true
      this.promptAlreadyWritten = false
      this.isNavigatingSuggestions = false
      // Reset acceptance/edit flags for new prompt
      this.acceptedCompletion = false
      this.editedSinceAccept = false
      this.forceHistoryOnlyOnce = false
      // Reset history browsing state for a fresh prompt
      this.historyBrowseActive = false
      this.historyBrowseIndex = -1
      this.historyBrowseSaved = ''
      this.historyNav = undefined

      // Don't write prompt - shell already wrote it via renderPrompt()
      // If shell mode is enabled, mark prompt as already written
      if (this.shellMode) {
        this.promptAlreadyWritten = true
      }

      // Mouse tracking support for suggestion clicks (xterm SGR mode)
      const handleMouse = (chunk: Buffer) => {
        if (!this.isShowingSuggestions || this.suggestions.length === 0)
          return
        // Parse SGR mouse sequence: \x1b[<btn;x;y(M|m)
        const data = chunk.toString('utf8')
        // Use regex literal with \u001B (ESC). Ignore the row (\d+) and case-insensitive for press/release.
        // eslint-disable-next-line no-control-regex
        const re = /\u001B\[<(\d+);(\d+);\d+(m)/gi
        for (const match of data.matchAll(re)) {
          const btn = Number(match[1])
          const col = Number(match[2])
          const type = match[3]
          // Left button press
          if (type.toUpperCase() === 'M' && btn === 0) {
            // Map column to suggestion index based on rendered list layout
            const cols = process.stdout.columns ?? 80
            const items = this.suggestions.slice(0, this.options.maxSuggestions ?? 10)
            // Visible labels: selected gets [label], others plain
            const labels = items.map((s, i) => (i === this.selectedIndex ? `[${s}]` : s))
            let cursor = 1 // columns are 1-based
            let picked = -1
            for (let i = 0; i < labels.length; i++) {
              const label = labels[i]
              const start = cursor
              const end = Math.min(cols, start + label.length - 1)
              if (col >= start && col <= end) {
                picked = i
                break
              }
              // advance: label + two spaces gap
              cursor = end + 1 + 2
              if (cursor > cols)
                break
            }
            if (picked >= 0) {
              this.selectedIndex = picked
              const _drilled = this.applySelectedCompletion()
              // Keep list open for both directory and non-directory items
              this.updateSuggestions()
              this.isShowingSuggestions = this.suggestions.length > 0
              this.isNavigatingSuggestions = this.isShowingSuggestions
              this.selectedIndex = 0
              if (this.groupedActive)
                this.enableMouseTracking()
              this.updateDisplay(prompt)
            }
          }
        }
      }

      const disableMouseTracking = () => {
        if (this.mouseTrackingEnabled) {
          this.disableMouseTracking()
          process.stdin.off('data', handleMouse)
        }
      }

      // Ensure we always restore terminal modes, even on hard exits
      const tidy = () => {
        try {
          if (typeof (stdin as any).setRawMode === 'function' && (stdin as any).isTTY)
            (stdin as any).setRawMode(false)
        }
        catch {}
        try {
          disableMouseTracking()
        }
        catch {}
      }
      const cleanup = () => {
        tidy()
        stdin.removeAllListeners('keypress')
        process.off('exit', tidy)
        process.off('SIGINT', tidy)
        process.off('SIGTERM', tidy)
      }
      process.once('exit', tidy)
      process.once('SIGINT', tidy)
      process.once('SIGTERM', tidy)

      const handleKeypress = (str: string, key: any) => {
        if (!key)
          return

        try {
          // Handle Ctrl+C
          if (key.ctrl && key.name === 'c') {
            // Abort the current input line without terminating the shell.
            // Print a newline, reset state via cleanup for this read, and resolve empty input
            // so the outer loop can render a fresh prompt.
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
            // If suggestions list is open, accept the selected item instead of executing
            if (this.isShowingSuggestions && this.suggestions.length > 0) {
              const drilled = this.applySelectedCompletion()
              // If we selected a directory (ends with '/'), keep list open and show its contents
              if (drilled) {
                this.updateSuggestions()
                this.isShowingSuggestions = this.suggestions.length > 0
                this.isNavigatingSuggestions = this.isShowingSuggestions
                this.selectedIndex = 0
                this.updateDisplay(prompt)
              }
              else {
                // New behavior: keep list open and refilter based on updated input
                this.updateSuggestions()
                this.isShowingSuggestions = this.suggestions.length > 0
                this.isNavigatingSuggestions = this.isShowingSuggestions
                this.selectedIndex = 0
                // Enable mouse tracking only when grouped layout is active
                if (this.groupedActive) {
                  this.enableMouseTracking()
                }
                this.updateDisplay(prompt)
              }
              return
            }
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
            // Before executing, clear any inline suggestions to avoid stale hints
            // (e.g., after completing a directory). Avoid re-rendering here to
            // prevent stray ANSI sequences before subprocess output.
            this.suppressSuggestions()
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
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              this.disableMouseTracking()
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
                this.updateSuggestions()
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.disableMouseTracking()
                this.updateDisplay(prompt)
                return
              }
              if (key.name === 'l') {
                this.moveCursorRight()
                this.updateSuggestions()
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.disableMouseTracking()
                this.updateDisplay(prompt)
                return
              }
              // Vi vertical movement
              if (key.name === 'k') {
                this.moveCursorUp()
                this.updateSuggestions()
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.disableMouseTracking()
                this.updateDisplay(prompt)
                return
              }
              if (key.name === 'j') {
                this.moveCursorDown()
                this.updateSuggestions()
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.disableMouseTracking()
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
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.disableMouseTracking()
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
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.disableMouseTracking()
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
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.disableMouseTracking()
                this.updateSuggestions()
                this.updateDisplay(prompt)
                return
              }
            }
          }

          // Handle Tab - suggestions list open/cycle/accept
          if (key.name === 'tab') {
            // Shift+Tab -> previous selection when list is open
            if (key.shift && this.isShowingSuggestions && this.suggestions.length > 0) {
              this.selectedIndex = (this.selectedIndex - 1 + this.suggestions.length) % this.suggestions.length
              this.updateDisplay(prompt)
              return
            }

            // If suggestions list is already shown, cycle to next selection
            if (this.isShowingSuggestions && this.suggestions.length > 0) {
              this.selectedIndex = (this.selectedIndex + 1) % this.suggestions.length
              this.updateDisplay(prompt)
              return
            }
            // Otherwise, open the suggestions list (do not insert text yet)
            // Prefer recent history matches for the current prefix when available.
            // This avoids showing a large grouped menu when users are refining a command.
            {
              const prefixRaw = this.getCurrentLinePrefix()
              const prefix = prefixRaw.trim().toLowerCase()
              const isBunRunTab = /^bunx?\s+run\s+tab\b/.test(prefix)
              const isBunRun = /^bunx?\s+run\b/.test(prefix)

              if (isBunRunTab) {
              // Special case: restore grouped UI, suppress history-only fallback and merging,
              // and surface the most recent matching history command inline in dim text.
                this.specialRestoreGroupedOnce = true
                this.suppressHistoryMergeOnce = true
                const histMatches = this.getHistorySuggestions(prefixRaw)
                if (histMatches.length > 0) {
                  this.inlineFromHistoryOnce = histMatches[0]
                }
                // Ensure a clean re-render when switching modes
                this.hadSuggestionsLastRender = false
              }
              else if (isBunRun) {
                // For plain "bun run" (without trailing "tab"), force grouped UI and do NOT
                // hint the most recent history inline. Also bypass history-only fallback/merge.
                this.specialRestoreGroupedOnce = true
                this.suppressHistoryMergeOnce = true
                this.inlineFromHistoryOnce = null
                this.hadSuggestionsLastRender = false
              }
              else {
                const histMatches = prefixRaw ? this.getHistorySuggestions(prefixRaw) : []
                // Do NOT force history-only when in cd context
                if (histMatches.length > 0 && !this.isCdContext()) {
                  this.forceHistoryOnlyOnce = true
                  // Force a clean re-render of suggestions area when switching modes
                  this.hadSuggestionsLastRender = false
                }
                // Fallback: if we previously accepted a completion and then edited, also prefer history
                if (!this.forceHistoryOnlyOnce && this.acceptedCompletion && this.editedSinceAccept && !this.isCdContext()) {
                  this.forceHistoryOnlyOnce = true
                  this.hadSuggestionsLastRender = false
                }
              }
            }
            this.updateSuggestions()
            if (this.suggestions.length > 0) {
              this.isShowingSuggestions = true
              this.isNavigatingSuggestions = true
              this.selectedIndex = 0
              // Suppress inline overlay while list is open, except for special grouped restore
              if (!this.specialRestoreGroupedOnce)
                this.currentSuggestion = ''
              // Enable mouse tracking only for grouped layout; flat list clicks are unsupported
              if (this.groupedActive) {
                this.enableMouseTracking()
              }
              this.updateDisplay(prompt)
              // Clear the one-shot grouped restore after opening the UI
              this.specialRestoreGroupedOnce = false
            }
            return
          }

          // Arrow navigation for suggestions list when open
          if (this.isShowingSuggestions && this.suggestions.length > 0) {
            // Group-aware navigation: Left/Right switch groups, Up/Down move within the group
            if (this.groupedActive && this.groupedIndexMap.length > 0) {
              if (key.name === 'up' || key.name === 'down' || key.name === 'left' || key.name === 'right') {
                const handled = this.navigateGrouped(key.name as any)
                if (handled) {
                  this.updateDisplay(prompt)
                  return
                }
              }
            }

            // Flat (non-grouped) navigation defaults
            if (key.name === 'down') {
              this.selectedIndex = (this.selectedIndex + 1) % this.suggestions.length
              this.updateDisplay(prompt)
              return
            }
            if (key.name === 'up') {
              this.selectedIndex = (this.selectedIndex - 1 + this.suggestions.length) % this.suggestions.length
              this.updateDisplay(prompt)
              return
            }
            if (key.name === 'escape') {
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              this.updateSuggestion()
              this.disableMouseTracking()
              this.updateDisplay(prompt)
              return
            }
          }

          // Handle Arrow keys: prefer multi-line cursor movement over suggestions
          if (key.name === 'down') {
            if (this.currentInput.includes('\n')) {
              this.moveCursorDown()
              this.updateDisplay(prompt)
            }
            else if (this.historyBrowseActive) {
              // Navigate forward in history or return to saved input
              const hist = this.getHistoryArray() || []
              if (this.historyBrowseIndex < hist.length - 1) {
                // Go to newer entry
                this.historyBrowseIndex++
                this.currentInput = hist[this.historyBrowseIndex] || ''
              }
              else {
                // Return to original input and exit history browsing
                this.historyBrowseActive = false
                this.currentInput = this.historyBrowseSaved
                this.historyBrowseIndex = -1
              }

              this.cursorPosition = this.currentInput.length
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              this.suggestions = []
              this.currentSuggestion = ''
              this.disableMouseTracking()
              this.updateDisplay(prompt)
            }
            return
          }

          if (key.name === 'up') {
            if (this.currentInput.includes('\n')) {
              this.moveCursorUp()
              this.updateDisplay(prompt)
            }
            else {
              // Simple history navigation - cycle through all history entries
              const hist = this.getHistoryArray() || []
              if (hist.length > 0) {
                if (!this.historyBrowseActive) {
                  // Start browsing from the most recent entry
                  this.historyBrowseActive = true
                  this.historyBrowseIndex = hist.length - 1
                  this.historyBrowseSaved = this.currentInput
                }
                else if (this.historyBrowseIndex > 0) {
                  // Go to older entry
                  this.historyBrowseIndex--
                }

                this.currentInput = hist[this.historyBrowseIndex] || ''
                this.cursorPosition = this.currentInput.length
                // Close suggestions while browsing
                this.isShowingSuggestions = false
                this.isNavigatingSuggestions = false
                this.suggestions = []
                this.currentSuggestion = ''
                this.disableMouseTracking()
                this.updateDisplay(prompt)
              }
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
              // Editing should close the suggestions list to avoid stale entries
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              // Mark that an edit occurred after an acceptance
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
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
              // Editing should close the suggestions list to avoid stale entries
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
              this.updateDisplay(prompt)
            }
            return
          }

          // Handle Left/Right arrow keys
          if (key.name === 'left') {
            // When navigating grouped suggestions, Left switches group (handled above)
            if (this.isShowingSuggestions && this.groupedActive) {
              return
            }
            this.moveCursorLeft()
            this.updateSuggestions()
            this.isShowingSuggestions = false
            this.isNavigatingSuggestions = false
            if (this.acceptedCompletion)
              this.editedSinceAccept = true
            disableMouseTracking()
            this.updateDisplay(prompt)
            return
          }

          if (key.name === 'right') {
            // When navigating grouped suggestions, Right switches group (handled above)
            if (this.isShowingSuggestions && this.groupedActive) {
              return
            }
            if (this.cursorPosition < this.currentInput.length) {
              this.moveCursorRight()
              this.updateSuggestions()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
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
              this.updateSuggestions()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
              this.updateDisplay(prompt)
              return
            }
            if (key.ctrl && key.name === 'e') {
              this.moveToLineEnd()
              this.updateSuggestions()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
              this.updateDisplay(prompt)
              return
            }
            // Kill to end/start
            if (key.ctrl && key.name === 'k') {
              this.killToEnd()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            if (key.ctrl && key.name === 'u') {
              this.killToStart()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            // Word motions
            if (key.meta && (key.name === 'b')) {
              this.moveWordLeft()
              this.updateSuggestions()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
              this.updateDisplay(prompt)
              return
            }
            if (key.meta && (key.name === 'f')) {
              this.moveWordRight()
              this.updateSuggestions()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
              this.updateDisplay(prompt)
              return
            }
            // Delete word forward/backward
            if (key.meta && (key.name === 'd')) {
              this.deleteWordRight()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            if ((key.ctrl && key.name === 'w') || (key.meta && key.name === 'backspace')) {
              this.deleteWordLeft()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              this.updateSuggestions()
              this.updateDisplay(prompt)
              return
            }
            // Home/End
            if (key.name === 'home') {
              this.moveToLineStart()
              this.updateSuggestions()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
              this.updateDisplay(prompt)
              return
            }
            if (key.name === 'end') {
              this.moveToLineEnd()
              this.updateSuggestions()
              this.isShowingSuggestions = false
              this.isNavigatingSuggestions = false
              if (this.acceptedCompletion)
                this.editedSinceAccept = true
              this.disableMouseTracking()
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
            // Cancel history browsing when typing
            this.historyBrowseActive = false
            this.historyBrowseIndex = -1
            this.historyNav = undefined
            const wasOpen = this.isShowingSuggestions
            this.currentInput = this.currentInput.slice(0, this.cursorPosition)
              + str
              + this.currentInput.slice(this.cursorPosition)
            this.cursorPosition++
            this.updateSuggestions()
            // Keep list open while typing if it was open and still has matches
            this.isShowingSuggestions = wasOpen && this.suggestions.length > 0
            this.isNavigatingSuggestions = this.isShowingSuggestions
            if (this.acceptedCompletion)
              this.editedSinceAccept = true
            if (!this.isShowingSuggestions)
              this.disableMouseTracking()
            this.updateDisplay(prompt)
          }
        }
        catch (error) {
          // Silently handle errors to prevent crashes
          console.error('Keypress error:', error)
        }
      }

      // Initial display - prompt already written by shell via refreshPrompt()
      this.updateDisplay(prompt)

      stdin.on('keypress', handleKeypress)
    })
  }

  private updateSuggestions() {
    try {
      // Suppress all suggestions while browsing history
      if (this.historyBrowseActive) {
        this.suggestions = []
        this.currentSuggestion = ''
        this.isShowingSuggestions = false
        this.isNavigatingSuggestions = false
        this.groupedActive = false
        this.groupedForRender = null
        this.groupedIndexMap = []
        return
      }

      // Snapshot previous selection to try to preserve it after refresh
      const prevSelectedIndex = this.selectedIndex
      const prevSuggestions = this.suggestions.slice()
      const prevSelected = prevSuggestions[prevSelectedIndex]

      // Get suggestions from shell (includes plugin completions)
      const rawNextAny: any = this.shell.getCompletions(this.currentInput, this.cursorPosition) || []

      // Narrowing helpers
      const isCompletionItem = (v: any): v is CompletionItem => v && typeof v === 'object' && typeof v.text === 'string'
      const isGroupArray = (v: any): v is CompletionGroup<string | CompletionItem>[] => Array.isArray(v) && v.every(g => g && typeof g.title === 'string' && Array.isArray(g.items))

      // Reset grouped state each update
      this.groupedActive = false
      this.groupedForRender = null
      this.groupedIndexMap = []

      let next: string[] = []
      let groups: Array<{ title: string, items: Array<string | { text: string }> }> | null = null
      if (isGroupArray(rawNextAny)) {
        // Normalize groups to strings or {text}
        groups = rawNextAny.map(g => ({
          title: g.title,
          items: g.items.map(it => typeof it === 'string' ? it : { text: it.text }),
          // description is intentionally ignored in compact list; could be used later
        }))
      }

      // Filter by current token prefix to support live filtering as the user types
      const before = this.currentInput.slice(0, this.cursorPosition)
      const token = (before.match(/(^|\s)(\S*)$/)?.[2] ?? '').trim()
      const max = this.options.maxSuggestions ?? 10

      if (groups) {
        // Apply filtering within groups
        const lower = token.toLowerCase()
        const filteredGroups = token.length > 0
          ? groups.map(g => ({
              title: g.title,
              items: g.items.filter((it) => {
                const label = typeof it === 'string' ? it : it.text
                return label.toLowerCase().startsWith(lower)
              }),
            }))
          : groups
        // If filter empties all, keep original groups for typo correction behavior
        const anyItems = filteredGroups.some(g => g.items.length > 0)
        const baseGroups = anyItems ? filteredGroups : groups

        // Merge duplicate groups by normalized title (e.g., multiple 'binaries' groups from core + plugins)
        const mergedByTitle: Array<{ title: string, items: Array<string | { text: string }> }> = []
        const titleIndex = new Map<string, number>()
        for (const g of baseGroups) {
          const displayTitle = (g.title ?? '').trim()
          const key = displayTitle.toLowerCase()
          if (!g.items || g.items.length === 0)
            continue
          let idx = titleIndex.get(key)
          if (idx === undefined) {
            idx = mergedByTitle.push({ title: displayTitle, items: [] }) - 1
            titleIndex.set(key, idx)
          }
          const target = mergedByTitle[idx]
          const seen = new Set<string>(target.items.map(it => (typeof it === 'string' ? it : it.text)))
          for (const it of g.items) {
            const label = typeof it === 'string' ? it : it.text
            if (!seen.has(label)) {
              target.items.push(it)
              seen.add(label)
            }
          }
        }

        // Use merged groups; preserve original item order for flat suggestions
        // but sort items alphabetically within each group for rendering so the
        // selectedIndex mapping matches renderGroupedSuggestionList's layout.
        const normalizedGroups = mergedByTitle

        // Build flattened list (original order) and index map in RENDER order.
        // The map entries correspond to the per-group sorted order so that
        // getSelectedLabel() can resolve the correct visually highlighted item
        // when the list is open, while the flat list preserves original order
        // for inline suffix correctness when the list is closed.
        const flat: string[] = []
        const map: Array<{ group: number, idx: number }> = []
        const renderGroups: Array<{ title: string, items: Array<string | { text: string }> }> = []
        for (let gi = 0; gi < normalizedGroups.length; gi++) {
          const g = normalizedGroups[gi]
          if (!g.items || g.items.length === 0)
            continue

          // 1) Always push to flat in original order from shell
          for (let ii = 0; ii < g.items.length; ii++) {
            const it = g.items[ii]
            const label = typeof it === 'string' ? it : it.text
            flat.push(label)
          }

          // 2) Prepare sorted items for rendering and build grouped index map in the
          // same per-group order used by the renderer
          const sorted = g.items
            .map((it, idx) => ({ it, idx, label: typeof it === 'string' ? it : it.text }))
            .sort((a, b) => a.label.localeCompare(b.label))

          const rgItems: Array<string | { text: string }> = []
          for (let si = 0; si < sorted.length; si++) {
            const s = sorted[si]
            rgItems.push(s.it)
            map.push({ group: gi, idx: si })
          }
          renderGroups.push({ title: g.title, items: rgItems })
        }

        // Merge history suggestions into a trailing History group only if there is remaining room
        // This preserves all explicit group items intact and only fills up to max with history.
        if (flat.length < max && !this.suppressHistoryMergeOnce && !this.isCdContext()) {
          const prefix = this.getCurrentLinePrefix()
          const seen = new Set(flat)
          const histItems: string[] = []
          // Gather and sort history suggestions alphabetically to mirror renderer ordering
          const histSorted = this.getHistorySuggestions(prefix).slice().sort((a, b) => a.localeCompare(b))
          for (const h of histSorted) {
            if (flat.length >= max)
              break
            if (seen.has(h))
              continue
            flat.push(h)
            map.push({ group: renderGroups.length, idx: histItems.length })
            histItems.push(h)
            seen.add(h)
          }
          if (histItems.length > 0) {
            renderGroups.push({ title: 'History', items: histItems })
          }
        }

        this.groupedActive = renderGroups.length > 0
        this.groupedForRender = renderGroups.length > 0 ? renderGroups : null
        this.groupedIndexMap = map
        next = flat
      }
      else {
        const rawNext = Array.isArray(rawNextAny)
          ? rawNextAny.map((v: any) => isCompletionItem(v) ? v.text : String(v))
          : []
        next = rawNext
        if (token.length > 0) {
          const lower = token.toLowerCase()
          const filtered = next.filter(s => s.toLowerCase().startsWith(lower))
          // If strict prefix filtering removes all items, keep the raw list to allow
          // typo-correction suggestions (e.g., suggest 'git' when typing 'gut').
          next = filtered.length > 0 ? filtered : rawNext
        }
      }

      // Merge with history suggestions, deduped, preserving order and limit
      if (!this.groupedActive) {
        const merged: string[] = []
        const seen = new Set<string>()
        for (const s of next) {
          if (!seen.has(s)) {
            merged.push(s)
            seen.add(s)
            if (merged.length >= max)
              break
          }
        }
        if (merged.length < max && !this.suppressHistoryMergeOnce && !this.isCdContext()) {
          const prefix = this.getCurrentLinePrefix()
          const hist = this.getHistorySuggestions(prefix)
          for (const h of hist) {
            if (!seen.has(h)) {
              merged.push(h)
              seen.add(h)
              if (merged.length >= max)
                break
            }
          }
        }
        this.suggestions = merged
      }
      else {
        // When grouped, suggestions already flattened and history merged
        this.suggestions = next
      }

      // Try to preserve previously selected item/index if still present
      if (this.suggestions.length > 0) {
        if (prevSelected) {
          const idx = this.suggestions.findIndex(s => s === prevSelected)
          if (idx >= 0) {
            this.selectedIndex = idx
          }
          else {
            this.selectedIndex = Math.min(prevSelectedIndex, this.suggestions.length - 1)
          }
        }
        else {
          this.selectedIndex = Math.min(prevSelectedIndex, this.suggestions.length - 1)
        }
      }
      else {
        this.selectedIndex = 0
      }
      this.updateSuggestion()
      // One-shot suppression of history merging is consumed here
      this.suppressHistoryMergeOnce = false
    }
    catch {
      this.suggestions = []
      this.currentSuggestion = ''
      this.groupedActive = false
      this.groupedForRender = null
      this.groupedIndexMap = []
    }
  }

  private updateSuggestion() {
    if (this.suggestions.length > 0) {
      // Special-case: inline hint sourced from most recent history match (one-shot)
      const selected = (((this.isCdContext() ? null : this.inlineFromHistoryOnce) ?? this.getSelectedLabel()) || '')
      const inputBeforeCursor = this.currentInput.slice(0, this.cursorPosition)

      // Suppress inline overlay when user has only typed "bun run" (no third token yet)
      // to prefer grouped completions UX over history hinting.
      const prefixTrimmed = this.getCurrentLinePrefix().trim().toLowerCase()
      if (/^bunx?\s+run\b/.test(prefixTrimmed)) {
        const parts = prefixTrimmed.split(/\s+/).filter(Boolean)
        if (parts.length === 2) {
          this.currentSuggestion = ''
          // Consume inline history override if any and stop here
          this.inlineFromHistoryOnce = null
          return
        }
      }

      // Handle different completion scenarios
      // Case 1: brand new input
      if (inputBeforeCursor.trim() === '') {
        // Empty input - show full suggestion
        this.currentSuggestion = selected
      }
      // Case 2: starting a new token (cursor preceded by whitespace)
      else if (/\s$/.test(inputBeforeCursor)) {
        // Prefer the suffix relative to the full already-typed input.
        // This avoids echoing previously typed tokens (e.g., "bun run" suggesting "bun run").
        if (selected.toLowerCase().startsWith(inputBeforeCursor.toLowerCase())) {
          this.currentSuggestion = selected.slice(inputBeforeCursor.length)
        }
        else {
          // If the completion doesn't build on the full prefix, show it fully
          this.currentSuggestion = selected
        }
      }
      else {
        // Case 3: we're in the middle of a token - prefer suffix relative to the
        // full input before cursor when prior tokens match the start of the selection.
        const tokens = inputBeforeCursor.trim().split(/\s+/)
        const lastToken = tokens[tokens.length - 1] || ''
        const beforeLastIdx = inputBeforeCursor.lastIndexOf(lastToken)
        const basePrefix = beforeLastIdx >= 0 ? inputBeforeCursor.slice(0, beforeLastIdx) : ''

        const selLower = selected.toLowerCase()
        const baseLower = basePrefix.toLowerCase()

        if (basePrefix && selLower.startsWith(baseLower)) {
          // Selected builds upon the already-typed earlier tokens. Try to complete the current token.
          const remainingFromBase = selected.slice(basePrefix.length)
          const remainingLower = remainingFromBase.toLowerCase()
          // remainingFromBase begins with the selected's current token. If lastToken is a prefix of it,
          // use the fine-grained suffix from the entire input (avoids echoing prior tokens).
          if (remainingLower.startsWith(lastToken.toLowerCase())) {
            this.currentSuggestion = selected.slice(inputBeforeCursor.length)
          }
          else {
            // If it doesn't align at token level, fall back to showing full selected as a correction hint.
            this.currentSuggestion = selected
          }
        }
        else if (selLower.startsWith(lastToken.toLowerCase())) {
          // No multi-token alignment, but current token is a prefix of selection
          this.currentSuggestion = selected.slice(lastToken.length)
        }
        else {
          // Typo-correction hint: show full selection
          this.currentSuggestion = selected
        }
      }
    }
    else {
      this.currentSuggestion = ''
    }
    // Consume inline history override after applying once
    this.inlineFromHistoryOnce = null
  }

  private acceptSuggestion() {
    if (this.currentSuggestion) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition)
        + this.currentSuggestion
        + this.currentInput.slice(this.cursorPosition)
      this.cursorPosition += this.currentSuggestion.length
      this.currentSuggestion = ''
      // Mark acceptance and reset edit-tracking
      this.acceptedCompletion = true
      this.editedSinceAccept = false
      this.updateSuggestions()
    }
  }

  // Returns the label for the currently highlighted item.
  // If grouped mode is active and the list is visible, use the render groups + index map
  // to avoid mismatch with the visual highlight. When the list is closed, use the flat
  // suggestions array (for inline suffix correctness).
  private getSelectedLabel(): string | null {
    if (!this.suggestions || this.suggestions.length === 0)
      return null
    const idx = this.selectedIndex
    if (idx < 0 || idx >= this.suggestions.length)
      return null
    if (this.isShowingSuggestions && this.groupedActive && this.groupedForRender && this.groupedIndexMap.length === this.suggestions.length) {
      const map = this.groupedIndexMap[idx]
      const group = this.groupedForRender[map.group]
      const item = group?.items?.[map.idx]
      if (typeof item === 'string')
        return item
      if (item && typeof (item as any).text === 'string')
        return (item as any).text
    }
    return this.suggestions[idx] || null
  }

  // Apply the currently selected completion item even when no inline suffix is visible.
  // If the cursor is at a token boundary (preceded by whitespace), insert the full selection.
  // Otherwise, replace the last token before the cursor with the full selection.
  private applySelectedCompletion(): boolean {
    const selected = this.getSelectedLabel() || ''
    if (!selected)
      return false
    const selectedIsDir = selected.endsWith('/')

    const before = this.currentInput.slice(0, this.cursorPosition)
    const after = this.currentInput.slice(this.cursorPosition)

    // New token: just insert selected at cursor
    if (/\s$/.test(before) || before === '') {
      // Avoid duplicating already-typed prefix (e.g., "bun run ")
      const base = before
      const toInsert = selected.startsWith(base) ? selected.slice(base.length) : selected
      this.currentInput = before + toInsert + after
      this.cursorPosition += toInsert.length
      this.currentSuggestion = ''
      // Mark acceptance and reset edit-tracking
      this.acceptedCompletion = true
      this.editedSinceAccept = false
      return selectedIsDir
    }
    const m = before.match(/(^|\s)(\S+)$/)
    if (m) {
      const lastTok = m[2] || ''
      const tokenStart = this.cursorPosition - lastTok.length
      const base = this.currentInput.slice(0, tokenStart)
      // If the selection already includes the base, insert only the remainder
      const toInsert = selected.startsWith(base) ? selected.slice(base.length) : selected
      this.currentInput = base + toInsert + after
      this.cursorPosition = tokenStart + toInsert.length
    }
    else {
      // Fallback: prepend selected at cursor
      this.currentInput = selected + after
      this.cursorPosition = selected.length
    }
    this.currentSuggestion = ''
    // Mark acceptance and reset edit-tracking
    this.acceptedCompletion = true
    this.editedSinceAccept = false
    return selectedIsDir
  }

  private lastDisplayedInput = ''
  private lastDisplayedSuggestion = ''
  private promptAlreadyWritten = false
  private shellMode = false
  private hadSuggestionsLastRender = false
  private lastSelectedIndex = -1
  private lastShowSuggestions = false

  private updateDisplay(prompt: string) {
    const stdout = process.stdout

    // Only update if relevant state changed
    if (this.currentInput === this.lastDisplayedInput
      && this.currentSuggestion === this.lastDisplayedSuggestion
      && this.selectedIndex === this.lastSelectedIndex
      && this.isShowingSuggestions === this.lastShowSuggestions) {
      return
    }

    // Calculate visible prompt length for the LAST line (handles multi-line prompts)
    const promptLastLine = prompt.slice(prompt.lastIndexOf('\n') + 1)
    const visiblePromptLastLen = visibleLength(promptLastLine)
    const cursorColumn = visiblePromptLastLen + this.cursorPosition + 1 // +1 for 1-based column

    const hasNewlines = this.currentInput.includes('\n')
    const reverseStatus = this.reverseSearchActive ? this.formatReverseStatusForWidth(prompt) : ''
    if (this.shellMode && this.promptAlreadyWritten && !hasNewlines) {
      // Shell mode: only update input area, don't rewrite prompt
      renderSingleLineShell(
        stdout,
        this.currentInput,
        this.options,
        visiblePromptLastLen,
        cursorColumn,
        !this.isShowingSuggestions && !this.reverseSearchActive && !this.historyBrowseActive && !!this.options.showInline,
        this.currentSuggestion,
        reverseStatus,
        this.lastDisplayedInput.length,
      )
    }
    else {
      // Isolated mode: helper will clear and render prompt + input
      if (!hasNewlines) {
        // Single-line behavior
        renderSingleLineIsolated(
          stdout,
          prompt,
          this.currentInput,
          this.options,
          visiblePromptLastLen,
          cursorColumn,
          !this.isShowingSuggestions && !this.reverseSearchActive && !this.historyBrowseActive && !!this.options.showInline,
          this.currentSuggestion,
          reverseStatus,
        )
      }
      else {
        // Multi-line rendering with continuation prompt
        const contPrompt = (this.shell?.config?.theme?.prompt?.continuation ?? '... ')
        renderMultiLineIsolated(
          stdout,
          prompt,
          this.currentInput,
          contPrompt,
          this.options,
          this.cursorPosition,
          visiblePromptLastLen,
          reverseStatus,
        )
      }
      this.promptAlreadyWritten = true
    }

    // If suggestions list is open, render a compact one-line list and restore cursor
    if (this.isShowingSuggestions) {
      let shown = false
      if (this.groupedActive && this.groupedForRender && this.groupedForRender.length > 0) {
        shown = renderGroupedSuggestionList(stdout, this.groupedForRender, this.selectedIndex, this.options, this.hadSuggestionsLastRender)
      }
      else {
        shown = renderSuggestionList(stdout, this.suggestions, this.selectedIndex, this.options, this.hadSuggestionsLastRender)
      }
      this.hadSuggestionsLastRender = shown
    }

    // Remember what we displayed
    this.lastDisplayedInput = this.currentInput
    this.lastDisplayedSuggestion = this.currentSuggestion
    this.lastSelectedIndex = this.selectedIndex
    this.lastShowSuggestions = this.isShowingSuggestions
  }

  // renderHighlighted moved to src/input/highlighting.ts

  // Method to enable shell mode where prompt is managed externally
  setShellMode(enabled: boolean): void {
    this.shellMode = enabled
    // Reset so next render knows to draw fresh
    this.promptAlreadyWritten = false
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

  /** @internal */
  setInputForTesting(input: string, cursorPos?: number): void {
    this.currentInput = input
    this.cursorPosition = cursorPos ?? input.length
    // Typing should reset history browsing state
    this.historyBrowseActive = false
    if (this.historyNav) {
      // Update navigator prefix to current line and reset index
      const newPrefix = this.getCurrentLinePrefix()
      try {
        this.historyNav.setPrefix(newPrefix)
        this.historyNav.reset()
      }
      catch {}
    }
    this.updateSuggestions()
  }

  /** @internal */
  updateDisplayForTesting(prompt: string): void {
    // Force isolated rendering for tests so the prompt is included in output
    const savedShellMode = this.shellMode
    const savedPromptWritten = this.promptAlreadyWritten
    try {
      this.shellMode = false
      this.promptAlreadyWritten = false
      this.updateDisplay(prompt)
    }
    finally {
      this.shellMode = savedShellMode
      this.promptAlreadyWritten = savedPromptWritten
    }
  }

  /** @internal */
  getCurrentInputForTesting(): string {
    return this.currentInput
  }

  /** @internal */
  getCursorPositionForTesting(): number {
    return this.cursorPosition
  }

  /** @internal */
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

  // ===== Test-only helpers =====
  // Testing helpers to simulate key behavior without raw stdin
  backspaceOneForTesting(): void {
    if (this.cursorPosition > 0) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition - 1)
        + this.currentInput.slice(this.cursorPosition)
      this.cursorPosition--
      this.updateSuggestions()
      this.isShowingSuggestions = false
      this.isNavigatingSuggestions = false
    }
  }

  /** @internal */
  deleteOneForTesting(): void {
    this.deleteCharUnderCursor()
    this.updateSuggestions()
  }

  /** @internal */
  leftOneForTesting(): void {
    this.moveCursorLeft()
    this.updateSuggestions()
    this.isShowingSuggestions = false
    this.isNavigatingSuggestions = false
  }

  /** @internal */
  rightOneForTesting(): void {
    if (this.cursorPosition < this.currentInput.length) {
      this.moveCursorRight()
      this.updateSuggestions()
      this.isShowingSuggestions = false
      this.isNavigatingSuggestions = false
    }
    else if (this.currentSuggestion) {
      this.acceptSuggestion()
    }
  }

  // History navigation helpers for tests
  /** @internal */
  historyUpForTesting(): void {
    this.navigateHistoryForTesting('up')
  }

  /** @internal */
  historyDownForTesting(): void {
    this.navigateHistoryForTesting('down')
  }

  // Shared helpers to keep history navigation logic DRY and maintainable
  private refreshNavigatorIfIdle(): void {
    const hist = this.getHistoryArray() || []
    const prefix = this.getCurrentLinePrefix()
    if (!this.historyNav) {
      this.historyNav = new HistoryNavigator(hist, prefix)
      return
    }
    if (!this.historyNav.isBrowsing()) {
      this.historyNav.setHistory(hist)
      this.historyNav.setPrefix(prefix)
    }
  }

  private applyHistoryBrowseState(active: boolean, value?: string): void {
    if (active && typeof value === 'string') {
      this.setCurrentInput(value)
      this.suppressSuggestions()
      this.historyBrowseActive = true
    }
    else {
      // When exiting browsing, restore the editing line to provided value (e.g., empty prefix)
      this.historyBrowseActive = false
      if (typeof value === 'string')
        this.setCurrentInput(value)
    }
  }

  private navigateHistoryForTesting(direction: 'up' | 'down'): void {
    this.refreshNavigatorIfIdle()
    const val = direction === 'up' ? this.historyNav!.up() : this.historyNav!.down()
    this.applyHistoryBrowseState(this.historyNav!.isBrowsing(), val)
    this.updateSuggestions()
  }

  // Suggestion helpers
  private suppressSuggestions(): void {
    this.isShowingSuggestions = false
    this.isNavigatingSuggestions = false
    this.suggestions = []
    this.currentSuggestion = ''
  }

  private clearSuggestions(): void {
    this.suggestions = []
    this.currentSuggestion = ''
  }

  private setCurrentInput(value: string, moveCursorToEnd = true): void {
    this.currentInput = value
    if (moveCursorToEnd)
      this.cursorPosition = this.currentInput.length
  }

  private killToStart() {
    if (this.cursorPosition > 0) {
      this.currentInput = this.currentInput.slice(this.cursorPosition)
      this.cursorPosition = 0
    }
  }

  private killToEnd() {
    if (this.cursorPosition < this.currentInput.length) {
      this.currentInput = this.currentInput.slice(0, this.cursorPosition)
      // cursorPosition remains the same, now at end of the (shorter) input
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
    return utilGetLines(this.currentInput)
  }

  private indexToLineCol(index: number): { line: number, col: number } {
    return utilIndexToLineCol(this.currentInput, index)
  }

  private lineColToIndex(line: number, col: number): number {
    return utilLineColToIndex(this.currentInput, line, col)
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

  // Public method for shells to proactively refresh the prompt and position the cursor
  // without directly writing to stdout outside of the input subsystem. This avoids
  // conflicts between prompt writes and input rendering/cursor management.
  public refreshPrompt(prompt: string): void {
    const stdout = process.stdout

    // Write the prompt exactly as provided (may be multi-line)
    stdout.write(prompt)
    try {
      if (process.env.KRUSTY_DEBUG) {
        process.stderr.write('[krusty] AutoSuggestInput.refreshPrompt: prompt written, state reset\n')
      }
    }
    catch {}

    // Mark that the prompt has been externally written so subsequent display updates
    // use shell-mode rendering that assumes the prompt exists on screen.
    this.promptAlreadyWritten = true

    // Reset editing state for a fresh input line
    this.currentInput = ''
    this.currentSuggestion = ''
    this.cursorPosition = 0
    this.suggestions = []
    this.selectedIndex = 0
    this.isShowingSuggestions = false
    this.isNavigatingSuggestions = false

    // Align last-displayed tracking with current state to suppress unnecessary redraw
    this.lastDisplayedInput = this.currentInput
    this.lastDisplayedSuggestion = this.currentSuggestion
    this.lastSelectedIndex = this.selectedIndex
    this.lastShowSuggestions = this.isShowingSuggestions
  }
}
