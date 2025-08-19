import type { Shell } from '../types'
import { spawn } from 'node:child_process'
import process from 'node:process'

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
    result = result.replace(simpleRegex, (match, varName) => {
      // Use shell environment first, then system environment
      if (varName in this.context.environment) {
        return this.context.environment[varName]
      }
      return process.env[varName] || ''
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
    return (content in this.context.environment) ? this.context.environment[content] : (process.env[content] ?? '')
  }

  /**
   * Expands command substitution: $(command) and `command`
   */
  private async expandCommandSubstitution(input: string): Promise<string> {
    let result = input

    // Handle $(command) syntax
    const dollarParenRegex = /\$\(([^)]+)\)/g
    const dollarMatches = Array.from(result.matchAll(dollarParenRegex))
    for (const match of dollarMatches) {
      const command = match[1]
      const output = await this.executeCommand(command)
      result = result.replace(match[0], output.trim())
    }

    // Handle `command` syntax
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
        const varRegex = /\$?([A-Z_]\w*)/gi
        expr = expr.replace(varRegex, (varMatch: string, varName: string) => {
          const value = this.context.environment[varName]
          return value && !Number.isNaN(Number(value)) ? value : '0'
        })

        // Evaluate the expression safely
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
    // Remove whitespace and validate characters
    const cleaned = expression.replace(/\s/g, '')
    if (!/^[0-9+\-*/%()]+$/.test(cleaned)) {
      throw new Error('Invalid arithmetic expression')
    }

    try {
      // Use Function constructor for safe evaluation
      // eslint-disable-next-line no-new-func
      return new Function(`"use strict"; return (${cleaned})`)()
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
      for (let i = startNum; step > 0 ? i <= endNum : i >= endNum; i += step) {
        result.push(i.toString())
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
