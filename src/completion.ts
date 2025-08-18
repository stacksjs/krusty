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
    const allCommands = [...new Set([...builtins, ...aliases, ...pathCommands])]
    const caseSensitive = this.shell.config.completion?.caseSensitive ?? false

    return allCommands.filter(cmd =>
      caseSensitive
        ? cmd.startsWith(prefix)
        : cmd.toLowerCase().startsWith(prefix.toLowerCase()),
    )
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
      // Handle home directory shortcut
      const fullPath = prefix.startsWith('~')
        ? prefix.replace('~', homedir())
        : resolve(process.cwd(), prefix)

      const dir = dirname(fullPath)
      const base = basename(fullPath)
      const completions: string[] = []

      const files = readdirSync(dir, { withFileTypes: true })

      for (const file of files) {
        if (file.name.startsWith(base)) {
          const displayPath = prefix.endsWith('/')
            ? file.name
            : join(dirname(prefix), file.name)

          completions.push(
            file.isDirectory() ? `${displayPath}/` : displayPath,
          )
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
