import type { CompletionItem, Shell } from './types'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

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
   * Provide simple argument completions for selected builtins
   */
  private getBuiltinArgCompletions(command: string, tokens: string[], last: string): string[] {
    switch (command) {
      case 'command': {
        // Complete the command name (arg1) using the global command list
        if (tokens.length === 2) {
          return this.getCommandCompletions(last)
        }
        return []
      }
      case 'cd': {
        // Directory-only completions
        const files = this.getFileCompletions(last)
        return files.filter(f => f.endsWith('/'))
      }
      case 'printf': {
        // Suggest common format strings for the first arg
        if (tokens.length === 2) {
          const suggestions = ['"%s"', '"%d"', '"%s %d"', '%q', '"%%s"']
          return suggestions.filter(s => s.startsWith(last) || last === '')
        }
        return []
      }
      case 'getopts': {
        // getopts optstring name [args...]
        if (tokens.length === 2) {
          // If user typed a space after optstring (last===""), suggest var names
          if (last === '') {
            const names = ['opt', 'flag']
            return names
          }
          const optstrings = ['"ab:"', '"f:"', '"hv"', '"o:"']
          return optstrings.filter(s => s.startsWith(last) || last === '')
        }
        if (tokens.length >= 3) {
          const names = ['opt', 'flag']
          return names.filter(s => s.startsWith(last) || last === '')
        }
        return []
      }
      case 'export': {
        // Complete environment variable names; include '=' if first assignment
        const keys = Object.keys(this.shell.environment || {})
        const base = keys.map(k => (tokens.length <= 2 ? `${k}=` : k))
        return base.filter(k => k.startsWith(last) || last === '')
      }
      case 'unset': {
        const keys = Object.keys(this.shell.environment || {})
        return keys.filter(k => k.startsWith(last) || last === '')
      }
      case 'help': {
        // Suggest builtin names for help
        const names = Array.from(this.shell.builtins.keys())
        return names.filter(n => n.startsWith(last) || last === '')
      }
      case 'alias': {
        // Suggest existing alias names
        const names = Object.keys(this.shell.aliases || {})
        return names.filter(n => n.startsWith(last) || last === '')
      }
      case 'unalias': {
        const names = Object.keys(this.shell.aliases || {})
        const flags = ['-a']
        const pool = last.startsWith('-') ? flags : names
        return pool.filter(n => n.startsWith(last) || last === '')
      }
      case 'set': {
        // Common flags and -o options
        const flags = ['-e', '-u', '-x', '-v', '+e', '+u', '+x', '+v']
        const oOpts = ['-o', 'vi', 'emacs', 'noclobber', 'pipefail', 'noglob']
        if (last === '-o' || (tokens.includes('-o') && tokens[tokens.length - 2] === '-o'))
          return oOpts.filter(o => o.startsWith(last) || last === '')
        const pool = last.startsWith('-') || last.startsWith('+') ? flags : [...flags, '-o']
        return pool.filter(f => f.startsWith(last) || last === '')
      }
      case 'read': {
        // Suggest flags first, then variable names
        const flags = ['-r', '-p', '-n', '-t', '-a', '-d', '-s', '-u']
        if (last.startsWith('-'))
          return flags.filter(f => f.startsWith(last))
        const envKeys = Object.keys(this.shell.environment || {})
        const names = ['var', 'name', 'line', ...envKeys]
        return names.filter(n => n.startsWith(last) || last === '')
      }
      case 'type':
      case 'which':
      case 'hash': {
        // Complete command names for these utilities
        return this.getCommandCompletions(last)
      }
      case 'exec': {
        // First arg is a command to exec
        if (tokens.length >= 2)
          return this.getCommandCompletions(last)
        return []
      }
      case 'bg':
      case 'fg': {
        // Suggest job specs like %1 from current jobs
        const jobs = this.shell.getJobs ? this.shell.getJobs() : (this.shell.jobs || [])
        const specs = jobs.map(j => `%${j.id}`)
        return specs.filter(s => s.startsWith(last) || last === '')
      }
      case 'jobs': {
        // Common flags for jobs
        const flags = ['-l', '-p', '-r', '-s']
        return flags.filter(f => f.startsWith(last) || last === '')
      }
      case 'pushd':
      case 'popd': {
        // Suggest +N/-N and directories
        const stackIdx: string[] = []
        for (let i = 0; i <= 9; i++) {
          stackIdx.push(`+${i}`)
          stackIdx.push(`-${i}`)
        }
        const idxMatches = stackIdx.filter(s => s.startsWith(last) || last === '')
        const dirs = this.getFileCompletions(last).filter(f => f.endsWith('/'))
        return [...idxMatches, ...dirs]
      }
      case 'umask': {
        // Suggest common umask values and -S flag
        const masks = ['-S', '000', '002', '022', '027', '077']
        return masks.filter(m => m.startsWith(last) || last === '')
      }
      case 'kill':
      case 'trap': {
        // Common POSIX signals
        const signals = [
          '-SIGINT',
          '-SIGTERM',
          '-SIGKILL',
          '-SIGHUP',
          '-SIGQUIT',
          '-SIGSTOP',
          'SIGINT',
          'SIGTERM',
          'SIGKILL',
          'SIGHUP',
          'SIGQUIT',
          'SIGSTOP',
        ]
        if (last.startsWith('-'))
          return signals.filter(s => s.startsWith(last))
        return signals.filter(s => s.startsWith(last) || last === '')
      }
      // Builtins without args: no special completions
      case 'times':
      case 'dirs':
        return []
      default:
        return []
    }
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
      if (isFirst)
        return this.getCommandCompletions(last)

      // If the first token is a builtin, attempt builtin-specific arg completions
      const cmd = tokens[0]
      if (this.shell.builtins.has(cmd)) {
        const builtinComps = this.getBuiltinArgCompletions(cmd, tokens, last)
        if (builtinComps.length)
          return builtinComps
      }

      // Fallback: file path completions
      return this.getFileCompletions(last)
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

      // Handle home directory shortcut first
      const basePath = rawPrefix.startsWith('~')
        ? rawPrefix.replace('~', homedir())
        : rawPrefix

      // Build candidate base directories: shell.cwd, then repo root (parent of src)
      // Using import.meta.url directly avoids stepping up twice inadvertently.
      const moduleDir = dirname(fileURLToPath(import.meta.url))
      const repoRoot = resolve(moduleDir, '..')
      const candidates = [resolve(this.shell.cwd, basePath), resolve(repoRoot, basePath)]

      const completions: string[] = []
      const seen = new Set<string>()

      for (const candidate of candidates) {
        const attempt = { dir: dirname(candidate), base: basename(candidate), rawBaseDir: dirname(rawPrefix) }
        let files
        try {
          files = readdirSync(attempt.dir, { withFileTypes: true })
        }
        catch {
          continue
        }
        for (const file of files) {
          // Hide dotfiles unless the user started with '.' explicitly
          if (!attempt.base.startsWith('.') && file.name.startsWith('.'))
            continue
          if (file.name.startsWith(attempt.base)) {
            const displayBase = rawPrefix.endsWith('/')
              ? file.name
              : join(attempt.rawBaseDir, file.name)

            let displayPath = file.isDirectory() ? `${displayBase}/` : displayBase
            if (hadQuote) {
              const quote = prefix[0]
              displayPath = `${quote}${displayPath}`
            }
            if (!seen.has(displayPath)) {
              seen.add(displayPath)
              completions.push(displayPath)
            }
          }
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

      // Allow escapes outside quotes and inside double quotes
      if (char === '\\' && (!inQuotes || (inQuotes && quoteChar === '"'))) {
        escapeNext = true
        continue
      }

      if ((char === '"' || char === '\'') && !escapeNext) {
        if (inQuotes && char === quoteChar) {
          // Include the closing quote in the token for completeness
          current += char
          inQuotes = false
          quoteChar = ''
        }
        else if (!inQuotes) {
          // Preserve opening quote in token so downstream completion can detect it
          inQuotes = true
          quoteChar = char
          current += char
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

    // If input ends with a space (and we're not in quotes), append an empty token
    if (!inQuotes && input.endsWith(' ')) {
      if (current.trim())
        tokens.push(current)
      tokens.push('')
    }
    else if (current.trim()) {
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
