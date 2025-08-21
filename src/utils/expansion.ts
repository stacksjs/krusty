import type { Shell } from '../types/shell'
import { spawn } from 'node:child_process'
import * as process from 'node:process'

export interface ExpansionContext {
  shell: Shell
  cwd: string
  environment: Record<string, string>
}

/**
 * Handles all forms of shell expansion including:
 * - Variable expansion: $VAR, ${VAR}, ${VAR:-default}, ${VAR:+alt}, ${VAR:?error}
 * - Command substitution: $(command), `command`
 * - Arithmetic expansion: $((expression))
 * - Brace expansion: {a,b,c}, {1..10}, {a..z}
 * - Process substitution: <(command), >(command)
 */
export class ExpansionEngine {
  constructor(private context: ExpansionContext) {}

  /**
   * Performs all expansions on the input string
   */
  async expand(input: string): Promise<string> {
    let result = input

    // Order matters: do variable expansion first, then arithmetic, then brace, then command substitution
    result = await this.expandVariables(result)
    result = await this.expandArithmetic(result)
    result = this.expandBraces(result)
    result = await this.expandCommandSubstitution(result)
    result = await this.expandProcessSubstitution(result)

    return result
  }

  /**
   * Expands variables: $VAR, ${VAR}, ${VAR:-default}, etc.
   */
  private async expandVariables(input: string): Promise<string> {
    // Handle escaped variables by temporarily replacing them
    const escapedVars: string[] = []
    let result = input.replace(/\\\$/g, (_match) => {
      const placeholder = `__ESCAPED_VAR_${escapedVars.length}__`
      escapedVars.push('\\$')
      return placeholder
    })

    // Handle ${VAR} syntax with parameter expansion
    const parameterRegex = /\$\{([^}]+)\}/g
    result = result.replace(parameterRegex, (match, content) => {
      return this.expandParameter(content)
    })

    // Handle simple $VAR syntax (only uppercase variables and underscores)
    const simpleRegex = /\$([A-Z_][A-Z0-9_]*)/g
    result = result.replace(simpleRegex, (_match, varName) => {
      // Use shell environment first, then system environment
      if (varName in this.context.environment) {
        return this.context.environment[varName]
      }
      const sys = process.env[varName]
      if (sys !== undefined)
        return sys
      // Enforce nounset: error on unset variables for simple $VAR
      if (this.context.shell?.nounset) {
        throw new Error(`${varName}: unbound variable`)
      }
      return ''
    })

    // Restore escaped variables
    for (let i = 0; i < escapedVars.length; i++) {
      result = result.replace(`__ESCAPED_VAR_${i}__`, escapedVars[i])
    }

    return result
  }

  /**
   * Handles parameter expansion: ${VAR:-default}, ${VAR:+alt}, ${VAR:?error}
   */
  private expandParameter(content: string): string {
    // Length form: ${#VAR}
    if (content.startsWith('#')) {
      const varName = content.slice(1)
      const value = (varName in this.context.environment) ? this.context.environment[varName] : process.env[varName]
      const len = (value ?? '').length
      return String(len)
    }
    // Handle ${VAR:-default} - use default if unset or empty
    if (content.includes(':-')) {
      const [varName, defaultValue] = content.split(':-', 2)
      const value = (varName in this.context.environment) ? this.context.environment[varName] : process.env[varName]
      return value || defaultValue
    }

    // Handle ${VAR:+alt} - use alt if set and non-empty
    if (content.includes(':+')) {
      const [varName, altValue] = content.split(':+', 2)
      const value = (varName in this.context.environment) ? this.context.environment[varName] : process.env[varName]
      return value ? altValue : ''
    }

    // Handle ${VAR:?error} - error if unset or empty
    if (content.includes(':?')) {
      const [varName, errorMsg] = content.split(':?', 2)
      const value = (varName in this.context.environment) ? this.context.environment[varName] : process.env[varName]
      if (!value) {
        throw new Error(`${varName}: ${errorMsg || 'parameter null or not set'}`)
      }
      return value
    }

    // Handle ${VAR=default} - set and use default if unset
    if (content.includes('=')) {
      const [varName, defaultValue] = content.split('=', 2)
      let value = (varName in this.context.environment) ? this.context.environment[varName] : process.env[varName]
      if (!value) {
        value = defaultValue
        this.context.environment[varName] = value
      }
      return value
    }

    // Simple variable expansion
    if (content in this.context.environment) {
      return this.context.environment[content]
    }
    const sys = process.env[content]
    if (sys !== undefined)
      return sys
    // Enforce nounset for ${VAR} when no operator used
    if (this.context.shell?.nounset) {
      throw new Error(`${content}: unbound variable`)
    }
    return ''
  }

  /**
   * Expands command substitution: $(command) and `command`
   */
  private async expandCommandSubstitution(input: string): Promise<string> {
    let result = input

    // Handle nested $(...) by scanning for balanced parentheses
    const expandDollarParen = async (str: string): Promise<string> => {
      let i = 0
      while (i < str.length) {
        if (str[i] === '$' && str[i + 1] === '(') {
          // find matching ) with nesting
          let depth = 0
          let j = i + 2
          for (; j < str.length; j++) {
            const ch = str[j]
            const prev = str[j - 1]
            if (ch === '(' && prev !== '\\') {
              depth += 1
            }
            else if (ch === ')' && prev !== '\\') {
              if (depth === 0)
                break
              depth -= 1
            }
          }
          if (j >= str.length)
            break // unmatched; leave as-is
          const inner = str.slice(i + 2, j)
          const expandedInner = await expandDollarParen(inner)
          const output = await this.executeCommand(expandedInner)
          const before = str.slice(0, i)
          const after = str.slice(j + 1)
          str = `${before}${output.trim()}${after}`
          // restart scan from beginning of replaced segment
          i = before.length
          continue
        }
        i += 1
      }
      return str
    }

    result = await expandDollarParen(result)

    // Handle `command` syntax (no nesting support required here)
    const backtickRegex = /`([^`]+)`/g
    const backtickMatches = Array.from(result.matchAll(backtickRegex))
    for (const match of backtickMatches) {
      const command = match[1]
      const output = await this.executeCommand(command)
      result = result.replace(match[0], output.trim())
    }

    return result
  }

  /**
   * Expands arithmetic expressions: $((expression))
   */
  private async expandArithmetic(input: string): Promise<string> {
    const arithmeticRegex = /\$\(\(([^)]+)\)\)/g
    return input.replace(arithmeticRegex, (match, expression) => {
      try {
        // Simple arithmetic evaluation - expand variables first
        let expr = expression
        // Replace $VAR explicitly
        expr = expr.replace(/\$([A-Z_]\w*)/gi, (_m: string, varName: string) => {
          const value = this.context.environment[varName]
          if (typeof value === 'string' && value.length > 0)
            return value
          return '0'
        })
        // Replace bare VAR identifiers not preceded by hex/octal digits or 'x'
        expr = expr.replace(/(?<![\da-fx_])([A-Z_]\w*)\b/gi, (_m: string, varName: string) => {
          const value = this.context.environment[varName]
          if (typeof value === 'string' && value.length > 0)
            return value
          return '0'
        })

        // Evaluate the expression safely with base prefixes
        const result = this.evaluateArithmetic(expr)
        return result.toString()
      }
      catch {
        return '0'
      }
    })
  }

  /**
   * Safe arithmetic evaluation
   */
  private evaluateArithmetic(expression: string): number {
    // Normalize whitespace
    const cleaned = expression.replace(/\s+/g, '')
    // Validate allowed tokens: numbers (with 0x... hex or leading-0 octal), operators and parens
    if (!/^[\da-fA-Fx+\-*/%()]+$/.test(cleaned)) {
      throw new Error('Invalid arithmetic expression')
    }

    // Tokenize numbers and operators; convert hex and octal to decimal explicitly
    const tokens: string[] = []
    let buf = ''
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (/[0-9a-fA-Fx]/.test(ch)) {
        buf += ch
      }
      else {
        if (buf) {
          tokens.push(buf)
          buf = ''
        }
        tokens.push(ch)
      }
    }
    if (buf)
      tokens.push(buf)

    const toDec = (numTok: string): string => {
      if (/^0x[\da-fA-F]+$/.test(numTok))
        return String(Number.parseInt(numTok.slice(2), 16))
      // Leading zero implies octal (but a single 0 is zero)
      if (/^0[0-7]+$/.test(numTok))
        return String(Number.parseInt(numTok, 8))
      if (/^\d+$/.test(numTok))
        return numTok
      // Anything else is invalid
      throw new Error('Invalid arithmetic literal')
    }

    const normalized = tokens.map((t) => {
      if (/^[\da-fA-Fx]+$/.test(t))
        return toDec(t)
      if (/^[+\-*/%()]$/.test(t))
        return t
      // Unexpected token
      throw new Error('Invalid arithmetic token')
    }).join('')

    try {
      // eslint-disable-next-line no-new-func
      return new Function(`return (${normalized})`)()
    }
    catch {
      return 0
    }
  }

  /**
   * Expands brace expansion: {a,b,c}, {1..10}, {a..z}
   */
  private expandBraces(input: string): string {
    let result = input

    // Handle brace expansion with prefix/suffix support
    const braceRegex = /([^{}\s,]*)\{([^{}]+)\}([^{}\s,]*)/g
    result = result.replace(braceRegex, (match, prefix, content, suffix) => {
      // Handle range expansion {1..10}, {a..z}
      if (content.includes('..')) {
        const [start, end] = content.split('..', 2)
        const expansion = this.expandRange(start.trim(), end.trim())
        return expansion.map(item => `${prefix}${item}${suffix}`).join(' ')
      }

      // Handle comma expansion {a,b,c}
      if (content.includes(',')) {
        const items = content.split(',').map((item: string) => item.trim())
        return items.map((item: string) => `${prefix}${item}${suffix}`).join(' ')
      }

      return match
    })

    return result
  }

  /**
   * Expands ranges like {1..10} or {a..z}
   */
  private expandRange(start: string, end: string): string[] {
    const startNum = Number.parseInt(start, 10)
    const endNum = Number.parseInt(end, 10)

    // Numeric range
    if (!Number.isNaN(startNum) && !Number.isNaN(endNum)) {
      const result: string[] = []
      const step = startNum <= endNum ? 1 : -1
      // Zero-padding width if either endpoint has leading zeros and same width
      const width = (start.startsWith('0') || end.startsWith('0'))
        ? Math.max(start.length, end.length)
        : 0
      for (let i = startNum; step > 0 ? i <= endNum : i >= endNum; i += step) {
        const s = i.toString()
        result.push(width > 0 ? s.padStart(width, '0') : s)
      }
      return result
    }

    // Character range
    if (start.length === 1 && end.length === 1) {
      const startCode = start.charCodeAt(0)
      const endCode = end.charCodeAt(0)
      const result: string[] = []
      const step = startCode <= endCode ? 1 : -1
      for (let i = startCode; step > 0 ? i <= endCode : i >= endCode; i += step) {
        result.push(String.fromCharCode(i))
      }
      return result
    }

    return [start, end]
  }

  /**
   * Handles process substitution: <(command), >(command)
   */
  private async expandProcessSubstitution(input: string): Promise<string> {
    let result = input

    // Handle <(command) - input process substitution
    const inputSubstRegex = /<\(([^)]+)\)/g
    const inputMatches = Array.from(result.matchAll(inputSubstRegex))
    for (const match of inputMatches) {
      const command = match[1]
      const fifo = await this.createInputProcessSubstitution(command)
      result = result.replace(match[0], fifo)
    }

    // Handle >(command) - output process substitution
    const outputSubstRegex = />\(([^)]+)\)/g
    const outputMatches = Array.from(result.matchAll(outputSubstRegex))
    for (const match of outputMatches) {
      const command = match[1]
      const fifo = await this.createOutputProcessSubstitution(command)
      result = result.replace(match[0], fifo)
    }

    return result
  }

  /**
   * Creates a FIFO for input process substitution
   */
  private async createInputProcessSubstitution(command: string): Promise<string> {
    // For now, execute the command and return a temporary file path
    // In a full implementation, this would create a named pipe
    const output = await this.executeCommand(command)
    const tempFile = `/tmp/krusty_proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Write output to temp file (simplified implementation)
    const fs = await import('node:fs/promises')
    await fs.writeFile(tempFile, output)

    return tempFile
  }

  /**
   * Creates a FIFO for output process substitution
   */
  private async createOutputProcessSubstitution(_command: string): Promise<string> {
    // For now, return a temporary file path that the command can write to
    const tempFile = `/tmp/krusty_proc_out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // In a full implementation, this would set up a named pipe
    // and spawn the command to read from it
    return tempFile
  }

  /**
   * Executes a command and returns its output
   */
  async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'cmd' : '/bin/sh'
      const args = process.platform === 'win32' ? ['/c', command] : ['-c', command]

      const child = spawn(shell, args, {
        cwd: this.context.cwd,
        env: this.context.environment,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        }
        else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr}`))
        }
      })

      child.on('error', (error) => {
        reject(error)
      })
    })
  }
}

/**
 * Utility functions for expansion
 */
export class ExpansionUtils {
  /**
   * Checks if a string contains expansion patterns
   */
  static hasExpansion(input: string): boolean {
    return /[$`{]/.test(input)
  }

  /**
   * Escapes expansion characters
   */
  static escapeExpansion(input: string): string {
    return input.replace(/[$`{]/g, '\\$&')
  }

  /**
   * Splits a string by whitespace, respecting quotes and expansions
   */
  static splitArguments(input: string): string[] {
    const args: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    let escaped = false
    let braceDepth = 0

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

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

      if (!inQuotes && char === '{') {
        braceDepth++
        current += char
        continue
      }

      if (!inQuotes && char === '}') {
        braceDepth--
        current += char
        continue
      }

      if (!inQuotes && braceDepth === 0 && /\s/.test(char)) {
        if (current) {
          args.push(current)
          current = ''
        }
        continue
      }

      current += char
    }

    if (current) {
      args.push(current)
    }

    return args
  }
}
