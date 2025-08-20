import type { AutoSuggestOptions } from './auto-suggest'
import process from 'node:process'
import { displayWidth, truncateToWidth, visibleLength } from './ansi'
import { renderHighlighted } from './highlighting'

// Render single-line input when the prompt is already written (shell mode)
export function renderSingleLineShell(
  stdout: NodeJS.WriteStream,
  input: string,
  options: AutoSuggestOptions,
  visiblePromptLastLen: number,
  cursorColumn: number,
  showInline: boolean,
  inlineSuggestion: string,
  reverseStatus: string,
  prevInputLength: number,
): void {
  const inputStartColumn = visiblePromptLastLen + 1
  const renderedSingle = options.syntaxHighlight
    ? renderHighlighted(input, options.syntaxColors, options.highlightColor)
    : input
  // Move to start of input, clear to end of line, and write input
  stdout.write(`\x1B[${inputStartColumn}G\x1B[K${renderedSingle}\x1B[0m`)
  if (reverseStatus) {
    const dim = options.highlightColor ?? '\x1B[90m'
    stdout.write(` ${dim}${reverseStatus}\x1B[0m`)
  }
  if (showInline && inlineSuggestion) {
    const cols = process.stdout.columns ?? 80
    // compute used width on the last line: prompt + input + optional space+status
    let used = visiblePromptLastLen + displayWidth(input)
    if (reverseStatus)
      used += 1 + displayWidth(reverseStatus)
    const available = Math.max(0, cols - used)
    if (available > 0) {
      const truncated = truncateToWidth(inlineSuggestion, available)
      if (truncated) {
        const dim = options.suggestionColor ?? '\x1B[90m'
        stdout.write(`${dim}${truncated}\x1B[0m`)
      }
    }
  }
  // Clear any remaining characters from previous input
  if (prevInputLength > input.length) {
    const remaining = prevInputLength - input.length
    stdout.write(' '.repeat(remaining))
    stdout.write(`\x1B[${cursorColumn}G`)
  }
  // Explicitly set cursor position after updates
  stdout.write(`\x1B[${cursorColumn}G`)
}

// Render single-line input with prompt (isolated mode)
export function renderSingleLineIsolated(
  stdout: NodeJS.WriteStream,
  prompt: string,
  input: string,
  options: AutoSuggestOptions,
  visiblePromptLastLen: number,
  cursorColumn: number,
  showInline: boolean,
  inlineSuggestion: string,
  reverseStatus?: string,
): void {
  const renderedSingle = options.syntaxHighlight
    ? renderHighlighted(input, options.syntaxColors, options.highlightColor)
    : input
  // 1) Clear current line and write prompt
  stdout.write(`\r\x1B[2K${prompt}`)
  // 2) Move to start of input area (after prompt), clear to end, then write input
  const inputStartColumn = visiblePromptLastLen + 1
  stdout.write(`\x1B[${inputStartColumn}G\x1B[K${renderedSingle}\x1B[0m`)
  if (reverseStatus) {
    const dim = options.highlightColor ?? '\x1B[90m'
    stdout.write(` ${dim}${reverseStatus}\x1B[0m`)
  }
  if (showInline && inlineSuggestion) {
    const cols = process.stdout.columns ?? 80
    let used = visiblePromptLastLen + displayWidth(input)
    if (reverseStatus)
      used += 1 + displayWidth(reverseStatus)
    const available = Math.max(0, cols - used)
    if (available > 0) {
      const truncated = truncateToWidth(inlineSuggestion, available)
      if (truncated) {
        const dim = options.suggestionColor ?? '\x1B[90m'
        stdout.write(`${dim}${truncated}\x1B[0m`)
      }
    }
  }
  stdout.write(`\x1B[${cursorColumn}G`)
}

// Render multi-line input with continuation prompts and position cursor
export function renderMultiLineIsolated(
  stdout: NodeJS.WriteStream,
  prompt: string,
  input: string,
  continuationPrompt: string,
  options: AutoSuggestOptions,
  cursorPosition: number,
  visiblePromptLastLen: number,
  reverseStatus: string,
): void {
  const lines = input.split('\n')
  const visibleContLen = visibleLength(continuationPrompt)
  const firstLineRendered = options.syntaxHighlight
    ? renderHighlighted(lines[0], options.syntaxColors, options.highlightColor)
    : lines[0]
  // Clear current line, then write first line (prompt + input)
  stdout.write(`\r\x1B[2K${prompt}${firstLineRendered}\x1B[0m`)
  if (reverseStatus) {
    const dim = options.highlightColor ?? '\x1B[90m'
    stdout.write(` ${dim}${reverseStatus}\x1B[0m`)
  }
  for (let i = 1; i < lines.length; i++) {
    const rendered = options.syntaxHighlight ? renderHighlighted(lines[i], options.syntaxColors, options.highlightColor) : lines[i]
    stdout.write(`\n\x1B[2K${continuationPrompt}${rendered}\x1B[0m`)
  }
  // Compute target cursor row/col
  let remaining = cursorPosition
  let lineIndex = 0
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length
    if (remaining <= len) {
      lineIndex = i
      break
    }
    remaining -= (len + 1)
    lineIndex = i + 1
  }
  const colInLine = remaining
  const totalLines = lines.length
  const linesUp = (totalLines - 1) - lineIndex
  if (linesUp > 0)
    stdout.write(`\x1B[${linesUp}A`)
  const baseLen = lineIndex === 0 ? visiblePromptLastLen : visibleContLen
  const targetCol = baseLen + colInLine + 1
  stdout.write(`\x1B[${targetCol}G`)
}

export function renderSuggestionList(
  stdout: NodeJS.WriteStream,
  suggestions: string[],
  selectedIndex: number,
  options: AutoSuggestOptions,
  hadSuggestionsLastRender: boolean,
): boolean {
  if (suggestions.length > 0) {
    const reset = '\x1B[0m'
    const selColor = options.suggestionColor ?? '\x1B[36m'
    const dim = options.highlightColor ?? '\x1B[90m'
    const items = suggestions.slice(0, options.maxSuggestions ?? 10)
      .map((s, i) => i === selectedIndex ? `${selColor}[${s}]${reset}` : `${dim}${s}${reset}`)
      .join('  ')
    const cols = process.stdout.columns ?? 80
    // eslint-disable-next-line no-control-regex
    const visible = items.replace(/\x1B\[[0-9;]*m/g, '')
    let toPrint = items
    if (visible.length > cols) {
      const excess = visible.length - cols
      toPrint = items.slice(0, Math.max(0, items.length - excess))
    }
    stdout.write(`\x1B[s`)
    stdout.write(`\n\x1B[2K${toPrint}`)
    stdout.write(`\x1B[u`)
    return true
  }
  else if (hadSuggestionsLastRender) {
    stdout.write(`\x1B[s`)
    stdout.write(`\n\x1B[2K`)
    stdout.write(`\x1B[u`)
    return false
  }
  return false
}
