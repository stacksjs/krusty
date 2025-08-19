import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { Redirection } from '../types'

import { createReadStream, createWriteStream, existsSync } from 'node:fs'

export interface RedirectionConfig {
  stdin?: string | Readable
  stdout?: string | Writable | 'append'
  stderr?: string | Writable | 'append'
  stdoutAppend?: boolean
  stderrAppend?: boolean
  combineStderr?: boolean // For &> operator
  hereDoc?: string
  hereString?: string
}

/**
 * Handles all forms of shell redirection including:
 * - Basic redirection: >, >>, <, 2>, 2>>
 * - Combined redirection: &>, &>>
 * - Here documents: <<EOF, <<-EOF
 * - Here strings: <<<string
 * - File descriptor redirection: 3>, 4<, 2>&1
 */
export class RedirectionHandler {
  /**
   * Parses redirection operators from a command string
   */
  static parseRedirections(command: string): {
    cleanCommand: string
    redirections: Redirection[]
  } {
    const redirections: Redirection[] = []
    let cleanCommand = command

    // Parse in order of complexity to avoid conflicts
    const patterns = [
      // Here documents: <<EOF, <<-EOF
      { regex: /\s+<<-?\s*([A-Z_]\w*)\s*$/gi, type: 'here-doc' },
      // Here strings: <<<string
      // eslint-disable-next-line regexp/no-super-linear-backtracking
      { regex: /\s+<<<\s*(.+)$/g, type: 'here-string' },
      // Combined stderr+stdout: &>, &>>
      { regex: /\s+(&>>?)\s+(\S+)/g, type: 'both' },
      // Standard redirection: >, >>, <, 2>, 2>>
      { regex: /\s+(2>>?|>>?|<)\s+(\S+)/g, type: 'standard' },
      // File descriptor redirection: 3>file, 4<file, 2>&1 (but not 2>file which is handled above)
      { regex: /\s+(\d+)(>>?|<)\s*(&\d+)/g, type: 'fd' },
    ]

    for (const pattern of patterns) {
      const matches = Array.from(cleanCommand.matchAll(pattern.regex))
      for (const match of matches) {
        const redirection = this.parseRedirectionMatch(match, pattern.type)
        if (redirection) {
          redirections.push(redirection)
          cleanCommand = cleanCommand.replace(match[0], ' ')
        }
      }
    }

    return {
      cleanCommand: cleanCommand.trim(),
      redirections,
    }
  }

  private static parseRedirectionMatch(
    match: RegExpMatchArray,
    patternType: string,
  ): Redirection | null {
    switch (patternType) {
      case 'here-doc':
        return {
          type: 'here-doc',
          direction: 'input',
          target: match[1],
        }

      case 'here-string':
        return {
          type: 'here-string',
          direction: 'input',
          target: match[1],
        }

      case 'both':
        return {
          type: 'file',
          direction: match[1] === '&>>' ? 'append' : 'both',
          target: match[2],
        }

      case 'fd': {
        const fd = Number.parseInt(match[1], 10)
        const operator = match[2]
        const target = match[3]

        return {
          type: 'fd',
          direction: operator.includes('>') ? 'output' : 'input',
          target,
          fd,
        }
      }

      case 'standard': {
        const op = match[1]
        const file = match[2]

        if (op === '<') {
          return { type: 'file', direction: 'input', target: file }
        }
        else if (op === '>') {
          return { type: 'file', direction: 'output', target: file }
        }
        else if (op === '>>') {
          return { type: 'file', direction: 'append', target: file }
        }
        else if (op === '2>') {
          return { type: 'file', direction: 'error', target: file }
        }
        else if (op === '2>>') {
          return { type: 'file', direction: 'error-append', target: file }
        }
        break
      }
    }

    return null
  }

  /**
   * Applies redirections to a child process
   */
  static async applyRedirections(
    process: ChildProcess,
    redirections: Redirection[],
    cwd: string,
  ): Promise<void> {
    for (const redirection of redirections) {
      await this.applyRedirection(process, redirection, cwd)
    }
  }

  private static async applyRedirection(
    process: ChildProcess,
    redirection: Redirection,
    cwd: string,
  ): Promise<void> {
    switch (redirection.type) {
      case 'file':
        await this.applyFileRedirection(process, redirection, cwd)
        break

      case 'here-doc':
        await this.applyHereDocRedirection(process, redirection)
        break

      case 'here-string':
        await this.applyHereStringRedirection(process, redirection)
        break

      case 'fd':
        await this.applyFdRedirection(process, redirection)
        break
    }
  }

  private static async applyFileRedirection(
    process: ChildProcess,
    redirection: Redirection,
    cwd: string,
  ): Promise<void> {
    const filePath = redirection.target.startsWith('/')
      ? redirection.target
      : `${cwd}/${redirection.target}`

    switch (redirection.direction) {
      case 'input': {
        if (existsSync(filePath)) {
          const stream = createReadStream(filePath)
          if (process.stdin && process.stdin.writable) {
            stream.pipe(process.stdin)
          }
        }
        break
      }

      case 'output': {
        const outStream = createWriteStream(filePath)
        if (process.stdout) {
          process.stdout.pipe(outStream)
        }
        break
      }

      case 'append': {
        const appendStream = createWriteStream(filePath, { flags: 'a' })
        if (process.stdout) {
          process.stdout.pipe(appendStream)
        }
        break
      }

      case 'error': {
        const errStream = createWriteStream(filePath, { flags: 'w' })
        if (process.stderr) {
          process.stderr.pipe(errStream)
        }
        break
      }

      case 'both': {
        const bothStream = createWriteStream(filePath)
        if (process.stdout) {
          process.stdout.pipe(bothStream)
        }
        if (process.stderr) {
          process.stderr.pipe(bothStream)
        }
        break
      }
    }
  }

  private static async applyHereDocRedirection(
    process: ChildProcess,
    redirection: Redirection,
  ): Promise<void> {
    // Here documents need to be handled during parsing
    // This is a placeholder for the actual implementation
    const content = redirection.target // This would contain the here-doc content
    if (process.stdin) {
      process.stdin.write(content)
      process.stdin.end()
    }
  }

  private static async applyHereStringRedirection(
    process: ChildProcess,
    redirection: Redirection,
  ): Promise<void> {
    const content = redirection.target
    if (process.stdin) {
      process.stdin.write(`${content}\n`)
      process.stdin.end()
    }
  }

  private static async applyFdRedirection(
    process: ChildProcess,
    redirection: Redirection,
  ): Promise<void> {
    // File descriptor redirection (e.g., 2>&1)
    if (redirection.target === '&1' && redirection.fd === 2) {
      // Redirect stderr to stdout
      if (process.stderr && process.stdout) {
        process.stderr.pipe(process.stdout as any)
      }
    }
    // Additional FD redirections can be implemented here
  }

  /**
   * Handles here document parsing from multi-line input
   */
  static parseHereDocument(lines: string[], delimiter: string): {
    content: string
    remainingLines: string[]
  } {
    const content: string[] = []
    let i = 0

    for (i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim() === delimiter) {
        break
      }
      content.push(line)
    }

    return {
      content: content.join('\n'),
      remainingLines: lines.slice(i + 1),
    }
  }

  /**
   * Creates a redirection configuration from parsed redirections
   */
  static createRedirectionConfig(redirections: Redirection[]): RedirectionConfig {
    const config: RedirectionConfig = {}

    for (const redirection of redirections) {
      switch (redirection.direction) {
        case 'input':
          if (redirection.type === 'here-string') {
            config.hereString = redirection.target
          }
          else if (redirection.type === 'here-doc') {
            config.hereDoc = redirection.target
          }
          else {
            config.stdin = redirection.target
          }
          break

        case 'output':
          config.stdout = redirection.target
          break

        case 'append':
          config.stdout = redirection.target
          config.stdoutAppend = true
          break

        case 'error':
          config.stderr = redirection.target
          break

        case 'both':
          config.stdout = redirection.target
          config.stderr = redirection.target
          config.combineStderr = true
          break
      }
    }

    return config
  }
}
