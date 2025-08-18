import type { CompletionItem, Shell } from './types'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

export class CompletionProvider {
  private commandCache = new Map<string, string[]>()
  private cacheTimeout = 30000 // 30 seconds
  private lastCacheUpdate = 0

  constructor(private shell: Shell) {}

  /**
   * Get command completions for a given prefix
   */
  private getCommandCompletions(prefix: string): string[] {
    const builtins = Array.from(this.shell.builtins.keys())
    const aliases = Object.keys(this.shell.aliases || {})
    const pathCommands = this.getPathCommands()
    const caseSensitive = this.shell.config.completion?.caseSensitive ?? false

    const match = (s: string) =>
      caseSensitive ? s.startsWith(prefix) : s.toLowerCase().startsWith(prefix.toLowerCase())

    const b = builtins.filter(match)
    const a = aliases.filter(match)
    const p = pathCommands.filter(match)

    // Keep order: builtins, aliases, then PATH commands; dedupe while preserving order
    const ordered = [...b, ...a, ...p]
    const seen = new Set<string>()
    const result: string[] = []
    for (const cmd of ordered) {
      if (!seen.has(cmd)) {
        seen.add(cmd)
        result.push(cmd)
      }
    }
    return result
  }

  /**
   * Public API used by the shell to get completions at a cursor position
   */
  public getCompletions(input: string, cursor: number): string[] {
    try {
      if (!this.shell.config.completion?.enabled)
        return []
      const before = input.slice(0, Math.max(0, cursor))
      const tokens = this.tokenize(before)
      if (tokens.length === 0)
        return []
      const last = tokens[tokens.length - 1]
      const isFirst = tokens.length === 1
      return isFirst
        ? this.getCommandCompletions(last)
        : this.getFileCompletions(last)
    }
    catch {
      return []
    }
  }

  /**
   * Get all executable commands from PATH
   */
  private getPathCommands(): string[] {
    const now = Date.now()
    if (now - this.lastCacheUpdate < this.cacheTimeout && this.commandCache.has('path')) {
      return this.commandCache.get('path') || []
    }

    const path = process.env.PATH || ''
    const commands = new Set<string>()

    for (const dir of path.split(':')) {
      try {
        const files = readdirSync(dir, { withFileTypes: true })
        for (const file of files) {
          if (file.isFile() && !file.name.startsWith('.')) {
            try {
              const fullPath = join(dir, file.name)
              const stat = statSync(fullPath)
              const isExecutable = Boolean(stat.mode & 0o111)
              if (isExecutable) {
                commands.add(file.name)
              }
            }
            catch {
              // Skip files we can't stat
            }
          }
        }
      }
      catch {
        // Skip directories we can't read
      }
    }

    const commandList = Array.from(commands)
    this.commandCache.set('path', commandList)
    this.lastCacheUpdate = now
    return commandList
  }

  /**
   * Get file and directory completions for a given path prefix
   */
  private getFileCompletions(prefix: string): string[] {
    try {
      // Handle leading quotes for in-progress quoted paths
      const hadQuote = prefix.startsWith('"') || prefix.startsWith('\'')
      const rawPrefix = hadQuote ? prefix.slice(1) : prefix

      // Handle home directory shortcut
      const fullPath = rawPrefix.startsWith('~')
        ? rawPrefix.replace('~', homedir())
        : resolve(process.cwd(), rawPrefix)

      const dir = dirname(fullPath)
      const base = basename(fullPath)
      const completions: string[] = []

      const files = readdirSync(dir, { withFileTypes: true })

      for (const file of files) {
        if (file.name.startsWith(base)) {
          const displayBase = rawPrefix.endsWith('/')
            ? file.name
            : join(dirname(rawPrefix), file.name)

          let displayPath = file.isDirectory() ? `${displayBase}/` : displayBase

          // Re-add the opening quote if present in the original prefix
          if (hadQuote) {
            const quote = prefix[0]
            displayPath = `${quote}${displayPath}`
          }
          completions.push(displayPath)
        }
      }

      return completions
    }
    catch {
      return []
    }
  }

  /**
   * Tokenize input string into command line arguments
   */

  private tokenize(input: string): string[] {
    // Improved tokenizer that handles quoted strings and escaped characters
    const tokens: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    let escapeNext = false

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

      if (escapeNext) {
        current += char
        escapeNext = false
        continue
      }

      if (char === '\\' && !inQuotes) {
        escapeNext = true
        continue
      }

      if ((char === '"' || char === '\'') && !escapeNext) {
        if (inQuotes && char === quoteChar) {
          inQuotes = false
          quoteChar = ''
        }
        else if (!inQuotes) {
          inQuotes = true
          quoteChar = char
        }
        else {
          current += char
        }
      }
      else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          tokens.push(current)
          current = ''
        }
      }
      else {
        current += char
      }
    }

    if (current.trim()) {
      tokens.push(current)
    }

    return tokens
  }

  private escapeForCompletion(input: string): string {
    // Escape special characters in filenames for completion
    return input.replace(/([\s[\]{}()<>|;&*?$`'"\\])/g, '\\$1')
  }

  private sortAndLimit(completions: string[], partial: string): string[] {
    const maxSuggestions = this.shell.config.completion?.maxSuggestions || 10

    // Sort by relevance: exact matches first, then alphabetical
    const sorted = completions.sort((a, b) => {
      const aExact = a === partial
      const bExact = b === partial

      if (aExact && !bExact)
        return -1
      if (!aExact && bExact)
        return 1

      return a.localeCompare(b)
    })

    return sorted.slice(0, maxSuggestions)
  }

  // Get detailed completion items (for future use with rich completions)
  getDetailedCompletions(input: string, cursor: number): CompletionItem[] {
    const completions = this.getCompletions(input, cursor)
    return completions.map(text => ({
      text,
      type: this.getCompletionType(text),
      description: this.getCompletionDescription(text),
    }))
  }

  private getCompletionType(text: string): CompletionItem['type'] {
    if (this.shell.builtins.has(text))
      return 'builtin'
    if (this.shell.aliases[text])
      return 'alias'
    if (text.endsWith('/'))
      return 'directory'
    if (text.includes('.'))
      return 'file'
    if (text.startsWith('$'))
      return 'variable'
    return 'command'
  }

  private getCompletionDescription(text: string): string | undefined {
    if (this.shell.builtins.has(text)) {
      return this.shell.builtins.get(text)?.description
    }

    if (this.shell.aliases[text]) {
      return `alias for: ${this.shell.aliases[text]}`
    }

    return undefined
  }
}
