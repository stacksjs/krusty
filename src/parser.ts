import type { Command, ParsedCommand } from './types'

export class CommandParser {
  parse(input: string): ParsedCommand {
    const trimmed = input.trim()
    if (!trimmed) {
      return { commands: [] }
    }

    // Handle command chaining (;, &&, ||)
    const segments = this.splitByOperators(trimmed)
    const commands: Command[] = []
    let redirects: ParsedCommand['redirects']

    for (const segment of segments) {
      const { command, segmentRedirects } = this.parseSegment(segment)
      if (command) {
        commands.push(command)
        if (segmentRedirects) {
          redirects = { ...redirects, ...segmentRedirects }
        }
      }
    }

    return { commands, redirects }
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
        // Handle escaped characters
        if (char === '$' || char === quoteChar || char === '\\') {
          current += char // Add the escaped character without the backslash
        }
        else {
          current += `\\${char}` // Keep the backslash for other characters
        }
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

  private parseSegment(segment: string): {
    command: Command | null
    segmentRedirects?: ParsedCommand['redirects']
  } {
    // Check for background process
    const isBackground = segment.endsWith('&') && !this.isInQuotes(segment, segment.length - 1)
    if (isBackground) {
      segment = segment.slice(0, -1).trim()
    }

    // Extract redirections
    const { cleanSegment, redirects } = this.extractRedirections(segment)

    // Parse command and arguments
    const tokens = this.tokenize(cleanSegment)
    if (tokens.length === 0) {
      return { command: null }
    }

    const [name, ...args] = tokens
    const command: Command = {
      name,
      args,
      raw: segment,
      background: isBackground,
    }

    return { command, segmentRedirects: redirects }
  }

  private extractRedirections(segment: string): {
    cleanSegment: string
    redirects?: ParsedCommand['redirects']
  } {
    let cleanSegment = segment
    const redirects: ParsedCommand['redirects'] = {}

    // Handle stdout redirection (>, >>)
    const stdoutMatch = cleanSegment.match(/\s+(>>?)\s+(\S+)/)
    if (stdoutMatch) {
      redirects.stdout = stdoutMatch[2]
      cleanSegment = cleanSegment.replace(stdoutMatch[0], ' ')
    }

    // Handle stderr redirection (2>, 2>>)
    const stderrMatch = cleanSegment.match(/\s+2(>>?)\s+(\S+)/)
    if (stderrMatch) {
      redirects.stderr = stderrMatch[2]
      cleanSegment = cleanSegment.replace(stderrMatch[0], ' ')
    }

    // Handle stdin redirection (<)
    const stdinMatch = cleanSegment.match(/\s+<\s+(\S+)/)
    if (stdinMatch) {
      redirects.stdin = stdinMatch[1]
      cleanSegment = cleanSegment.replace(stdinMatch[0], ' ')
    }

    return {
      cleanSegment: cleanSegment.trim(),
      redirects: Object.keys(redirects).length > 0 ? redirects : undefined,
    }
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
