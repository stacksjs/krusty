import type { CompletionItem, Shell } from './types'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

export class CompletionProvider {
  private commandCache = new Map<string, string[]>()
  private cacheTimeout = 30000 // 30 seconds
  private lastCacheUpdate = 0

  constructor(private shell: Shell) {}

  getCompletions(input: string, cursor: number): string[] {
    if (!this.shell.config.completion?.enabled) {
      return []
    }

    const beforeCursor = input.slice(0, cursor)
    const tokens = this.tokenize(beforeCursor)

    if (tokens.length === 0) {
      return []
    }

    const lastToken = tokens[tokens.length - 1]
    const isFirstToken = tokens.length === 1

    if (isFirstToken) {
      // Complete command names
      return this.getCommandCompletions(lastToken)
    }
    else {
      // Complete file/directory names
      return this.getFileCompletions(lastToken)
    }
  }

  private getCommandCompletions(partial: string): string[] {
    const completions: string[] = []
    const caseSensitive = this.shell.config.completion?.caseSensitive ?? false
    const compare = caseSensitive
      ? (a: string, b: string) => a.startsWith(b)
      : (a: string, b: string) => a.toLowerCase().startsWith(b.toLowerCase())

    // Builtin commands (highest priority)
    for (const [name] of this.shell.builtins) {
      if (compare(name, partial)) {
        completions.push(name)
      }
    }

    // Aliases (second priority)
    for (const alias of Object.keys(this.shell.aliases)) {
      if (compare(alias, partial)) {
        completions.push(alias)
      }
    }

    // Recent commands from history (third priority)
    const recentCommands = this.shell.history
      .slice(-50)
      .map(cmd => cmd.split(' ')[0])
      .filter((cmd, index, arr) => arr.indexOf(cmd) === index) // unique

    for (const command of recentCommands) {
      if (compare(command, partial) && !completions.includes(command)) {
        completions.push(command)
      }
    }

    // External commands from PATH (lowest priority, limited)
    if (completions.length < 5) { // Only add PATH commands if we don't have many matches
      const pathCommands = this.getPathCommands()
      for (const command of pathCommands) {
        if (compare(command, partial) && !completions.includes(command)) {
          completions.push(command)
          if (completions.length >= 10)
            break // Limit to prevent too many results
        }
      }
    }

    return this.sortAndLimit(completions, partial)
  }

  private getFileCompletions(partial: string): string[] {
    try {
      let searchPath: string
      let prefix: string

      if (partial.includes('/')) {
        // Path contains directory separator
        const dir = dirname(partial)
        prefix = basename(partial)

        if (dir.startsWith('~')) {
          searchPath = dir.replace('~', homedir())
        }
        else if (dir.startsWith('/')) {
          searchPath = dir
        }
        else {
          searchPath = resolve(this.shell.cwd, dir)
        }
      }
      else {
        // No directory separator, search current directory
        searchPath = this.shell.cwd
        prefix = partial
      }

      if (!existsSync(searchPath)) {
        return []
      }

      const entries = readdirSync(searchPath)
      const completions: string[] = []
      const caseSensitive = this.shell.config.completion?.caseSensitive ?? false

      for (const entry of entries) {
        // Skip hidden files unless prefix starts with dot
        if (entry.startsWith('.') && !prefix.startsWith('.')) {
          continue
        }

        const matches = caseSensitive
          ? entry.startsWith(prefix)
          : entry.toLowerCase().startsWith(prefix.toLowerCase())

        if (matches) {
          const fullPath = join(searchPath, entry)
          try {
            const stat = statSync(fullPath)
            const completion = stat.isDirectory() ? `${entry}/` : entry

            // If partial contained a path, include the directory part
            if (partial.includes('/')) {
              const dirPart = dirname(partial)
              completions.push(join(dirPart, completion))
            }
            else {
              completions.push(completion)
            }
          }
          catch {
            // Skip entries we can't stat
          }
        }
      }

      return this.sortAndLimit(completions, prefix)
    }
    catch {
      return []
    }
  }

  private getPathCommands(): string[] {
    const now = Date.now()
    if (this.commandCache.size > 0 && now - this.lastCacheUpdate < this.cacheTimeout) {
      return Array.from(this.commandCache.keys())
    }

    this.commandCache.clear()
    const commands = new Set<string>()
    const pathEnv = this.shell.environment.PATH || process.env.PATH || ''
    const paths = pathEnv.split(':').filter(p => p.length > 0)

    for (const pathDir of paths) {
      try {
        if (!existsSync(pathDir))
          continue

        const entries = readdirSync(pathDir)
        for (const entry of entries) {
          try {
            const fullPath = join(pathDir, entry)
            const stat = statSync(fullPath)

            // Check if file is executable
            if (stat.isFile() && (stat.mode & 0o111)) {
              commands.add(entry)
            }
          }
          catch {
            // Skip entries we can't access
          }
        }
      }
      catch {
        // Skip directories we can't read
      }
    }

    // Cache the results
    for (const command of commands) {
      this.commandCache.set(command, [])
    }
    this.lastCacheUpdate = now

    return Array.from(commands)
  }

  private tokenize(input: string): string[] {
    const tokens: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

      if (!inQuotes && (char === '"' || char === '\'')) {
        inQuotes = true
        quoteChar = char
        current += char
        continue
      }

      if (inQuotes && char === quoteChar) {
        inQuotes = false
        quoteChar = ''
        current += char
        continue
      }

      if (!inQuotes && /\s/.test(char)) {
        if (current) {
          tokens.push(current)
          current = ''
        }
        continue
      }

      current += char
    }

    if (current) {
      tokens.push(current)
    }

    return tokens
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
