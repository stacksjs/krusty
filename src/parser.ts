import type { Command, ParsedCommand, Redirection } from './types'
import { ExpansionEngine, ExpansionUtils } from './utils/expansion'
import { RedirectionHandler } from './utils/redirection'

export class CommandParser {
  async parse(input: string, shell?: any): Promise<ParsedCommand> {
    const trimmed = input.trim()
    if (!trimmed) {
      return { commands: [] }
    }

    // Handle command chaining (;, &&, ||) first, before expansion
    const segments = this.splitByOperators(trimmed)
    const commands: Command[] = []
    const redirections: Redirection[] = []

    for (const segment of segments) {
      const { command, segmentRedirections } = await this.parseSegment(segment, shell)
      if (command) {
        commands.push(command)
        if (segmentRedirections) {
          redirections.push(...segmentRedirections)
        }
      }
    }

    // Convert redirections to the expected format
    const redirects = this.convertRedirectionsToFormat(redirections)

    return {
      commands,
      redirections: redirections.length > 0 ? redirections : undefined,
      redirects,
    }
  }

  private convertRedirectionsToFormat(redirections: Redirection[]) {
    if (redirections.length === 0)
      return undefined

    const redirects: { stdin?: string, stdout?: string, stderr?: string } = {}

    for (const redirection of redirections) {
      if (redirection.type === 'file') {
        switch (redirection.direction) {
          case 'input':
            redirects.stdin = redirection.target
            break
          case 'output':
          case 'append':
            redirects.stdout = redirection.target
            break
          case 'error':
          case 'error-append':
            redirects.stderr = redirection.target
            break
          case 'both':
            redirects.stdout = redirection.target
            redirects.stderr = redirection.target
            break
        }
      }
    }

    return Object.keys(redirects).length > 0 ? redirects : undefined
  }

  private splitByOperators(input: string): string[] {
    // For now, handle pipes. More complex operators (&&, ||, ;) can be added later
    return this.splitByPipes(input)
  }

  private splitByPipes(input: string): string[] {
    const segments: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    let escaped = false

    for (let i = 0; i < input.length; i++) {
      const char = input[i]
      const nextChar = input[i + 1]

      if (escaped) {
        current += char
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        current += char
        continue
      }

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

      if (!inQuotes && char === '|' && nextChar !== '|') {
        segments.push(current.trim())
        current = ''
        continue
      }

      current += char
    }

    if (current.trim()) {
      segments.push(current.trim())
    }

    return segments.filter(s => s.length > 0)
  }

  /**
   * Tokenizes a string into an array of arguments, handling quotes and escape sequences
   * @param input The input string to tokenize
   * @returns An array of tokens
   */
  public tokenize(input: string): string[] {
    const tokens: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    let escaped = false

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

      if (escaped) {
        current += `\\${char}` // Keep the backslash for escaped characters
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (!inQuotes && (char === '"' || char === '\'')) {
        inQuotes = true
        quoteChar = char
        current += char // Keep the opening quote
        continue
      }

      if (inQuotes && char === quoteChar) {
        inQuotes = false
        current += char // Keep the closing quote
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

  private async parseSegment(segment: string, shell?: any): Promise<{
    command: Command | null
    segmentRedirections?: Redirection[]
  }> {
    // Check for background process
    const isBackground = segment.endsWith('&') && !this.isInQuotes(segment, segment.length - 1)
    if (isBackground) {
      segment = segment.slice(0, -1).trim()
    }

    // Extract redirections
    const { cleanCommand, redirections } = RedirectionHandler.parseRedirections(segment)
    let cleanSegment = cleanCommand

    // Apply expansions to the clean command and redirection targets
    if (shell) {
      const expansionEngine = new ExpansionEngine({
        shell,
        cwd: shell.cwd,
        environment: shell.environment,
      })

      if (ExpansionUtils.hasExpansion(cleanSegment)) {
        cleanSegment = await expansionEngine.expand(cleanSegment)
      }

      // Expand variables in redirection targets
      for (const redirection of redirections) {
        if (ExpansionUtils.hasExpansion(redirection.target)) {
          redirection.target = await expansionEngine.expand(redirection.target)
        }
      }
    }

    // Parse command and arguments
    const tokens = this.tokenize(cleanSegment)
    if (tokens.length === 0) {
      return { command: null }
    }

    const [name, ...rawArgs] = tokens
    // For commands with expansions, preserve the structure after expansion
    // For regular commands, process arguments to remove quotes
    const args = rawArgs.map((arg) => {
      // If the original segment had expansions and this arg contains quotes/escapes, preserve them
      if (segment !== cleanSegment && (arg.includes('"') || arg.includes('\'') || arg.includes('\\'))) {
        return arg
      }
      // Special case: if the original segment had escaped variables, preserve them
      if (segment.includes('\\$') && arg.includes('\\')) {
        return arg
      }
      return this.processArgument(arg)
    })

    const command: Command = {
      name: this.processArgument(name),
      args,
      raw: segment,
      background: isBackground,
      // Preserve original arguments for alias expansion
      originalArgs: rawArgs,
    }

    return { command, segmentRedirections: redirections.length > 0 ? redirections : undefined }
  }

  /**
   * Processes an argument by removing quotes and handling escape sequences
   * @param arg The argument to process
   * @returns The processed argument
   */
  private processArgument(arg: string): string {
    if (!arg)
      return arg

    // Handle quoted strings
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith('\'') && arg.endsWith('\''))) {
      return arg.slice(1, -1)
    }

    // Handle escaped characters
    return arg.replace(/\\(.)/g, '$1')
  }

  private isInQuotes(input: string, position: number): boolean {
    let inQuotes = false
    let quoteChar = ''
    let escaped = false

    for (let i = 0; i < position; i++) {
      const char = input[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (!inQuotes && (char === '"' || char === '\'')) {
        inQuotes = true
        quoteChar = char
        continue
      }

      if (inQuotes && char === quoteChar) {
        inQuotes = false
        quoteChar = ''
        continue
      }
    }

    return inQuotes
  }
}
