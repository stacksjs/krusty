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
      // Here documents: <<EOF, <<-EOF (capture leading - in group 1 for indent stripping)
      { regex: /\s+<<(-)?\s*([A-Z_]\w*)\s*$/gi, type: 'here-doc' },
      // Here strings: <<<"str" or <<< 'str' or <<< unquoted
      { regex: /\s+<<<\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)\s*$/g, type: 'here-string' },
      // Combined stderr+stdout: &>, &>>
      { regex: /(?:\s+|^)(&>|&>>)\s+(\S+)/g, type: 'both' },
      // Standard redirection: >, >>, <, 2>, 2>>
      { regex: /(?:\s+|^)(\d*>>|\d*>|<)\s+(\S+)/g, type: 'standard' },
      // File descriptor duplication/close: n>&m, n>&-, also allow compact without spaces
      { regex: /(?:\s+|^)(\d+)>\s*&(-|\d+)\b/g, type: 'fd-dup' },
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
          // Store delimiter; prefix with '-' if indentation stripping requested so downstream can detect
          target: `${match[1] ? '-' : ''}${match[2]}`,
        }

      case 'here-string':
        return {
          type: 'here-string',
          direction: 'input',
          target: match[1],
        }

      case 'both': {
        const op = match[1]
        // Normalize: &> file -> both, &>> file -> append
        const isAppend = op.includes('>>')
        return {
          type: 'file',
          direction: 'both',
          // For append on both, mark target and interpret later
          target: isAppend ? `APPEND::${match[2]}` : match[2],
        }
      }

      case 'fd-dup': {
        const fd = Number.parseInt(match[1], 10)
        const target = match[2] === '-' ? '&-' : `&${match[2]}`
        return {
          type: 'fd',
          direction: 'output',
          target,
          fd,
        }
      }

      case 'standard': {
        const op = match[1]
        const file = match[2]

        // Detect file descriptor-specific standard ops like 2>, 2>>
        const fdMatch = op.match(/^(\d*)(>>?|<)$/)
        if (fdMatch) {
          const fdStr = fdMatch[1]
          const sym = fdMatch[2]
          if (sym === '<') {
            return { type: 'file', direction: 'input', target: file }
          }
          if (sym === '>' || sym === '>>') {
            if (fdStr === '2') {
              return { type: 'file', direction: sym === '>>' ? 'error-append' : 'error', target: file }
            }
            // stdout or generic > / >>
            return { type: 'file', direction: sym === '>>' ? 'append' : 'output', target: file }
          }
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

      case 'error-append': {
        const errAppendStream = createWriteStream(filePath, { flags: 'a' })
        if (process.stderr) {
          process.stderr.pipe(errAppendStream)
        }
        break
      }

      case 'both': {
        // Support APPEND:: marker for combined append (&>>)
        const isAppendBoth = redirection.target.startsWith('APPEND::')
        const actualPath = isAppendBoth ? filePath.replace(/APPEND::/, '') : filePath
        const bothStream = createWriteStream(actualPath, { flags: isAppendBoth ? 'a' : 'w' })
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
    // Here documents need to be handled during parsing stage to provide content.
    // We treat redirection.target as the already-parsed content here.
    const content = redirection.target
    if (process.stdin) {
      process.stdin.write(content)
      process.stdin.end()
    }
  }

  private static async applyHereStringRedirection(
    process: ChildProcess,
    redirection: Redirection,
  ): Promise<void> {
    // Strip surrounding quotes if present for here-strings
    let content = redirection.target
    if ((content.startsWith('"') && content.endsWith('"')) || (content.startsWith('\'') && content.endsWith('\''))) {
      content = content.slice(1, -1)
    }
    if (process.stdin) {
      process.stdin.write(`${content}\n`)
      process.stdin.end()
    }
  }

  private static async applyFdRedirection(
    process: ChildProcess,
    redirection: Redirection,
  ): Promise<void> {
    if (typeof redirection.fd !== 'number')
      return

    const dst = redirection.target // like &1 or &-
    // Close FD: n>&-
    if (dst === '&-') {
      if (redirection.fd === 1 && process.stdout) {
        try {
          (process.stdout as any).end?.()
          (process.stdout as any).destroy?.()
        }
        catch {}
      }
      else if (redirection.fd === 2 && process.stderr) {
        try {
          (process.stderr as any).end?.()
          (process.stderr as any).destroy?.()
        }
        catch {}
      }
      else if (redirection.fd === 0 && process.stdin) {
        try {
          (process.stdin as any).end?.()
          (process.stdin as any).destroy?.()
        }
        catch {}
      }
      return
    }

    const m = dst.match(/^&(\d+)$/)
    if (!m)
      return
    const targetFd = Number.parseInt(m[1], 10)

    // Duplicate FD: implement as piping one stream to the other
    // For output FDs (1: stdout, 2: stderr)
    const outMap: Record<number, Readable | Writable | null | undefined> = {
      0: process.stdin as any,
      1: process.stdout as any,
      2: process.stderr as any,
    }
    const from = outMap[redirection.fd]
    const to = outMap[targetFd]
    if (!from || !to)
      return

    // If redirecting stderr to stdout (2>&1), pipe stderr into stdout
    // If redirecting stdout to stderr (1>&2), pipe stdout into stderr
    if ((from as any).pipe && (to as any).write) {
      try {
        (from as any).pipe(to as any, { end: false })
      }
      catch {}
    }
  }

  /**
   * Handles here document parsing from multi-line input
   */
  static parseHereDocument(lines: string[], delimiter: string): {
    content: string
    remainingLines: string[]
  } {
    const stripTabs = delimiter.startsWith('-')
    const delim = stripTabs ? delimiter.slice(1) : delimiter
    const content: string[] = []
    let i = 0

    for (i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (line.trim() === delim) {
        break
      }
      if (stripTabs) {
        // Remove leading tabs only, per <<- spec
        line = line.replace(/^\t+/, '')
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
          if (redirection.type === 'file' && redirection.target.startsWith('APPEND::')) {
            const path = redirection.target.replace(/^APPEND::/, '')
            config.stdout = path
            config.stderr = path
            config.stdoutAppend = true
            config.stderrAppend = true
            config.combineStderr = true
          }
          else {
            config.stdout = redirection.target
            config.stdoutAppend = true
          }
          break

        case 'error':
          config.stderr = redirection.target
          break

        case 'error-append':
          config.stderr = redirection.target
          config.stderrAppend = true
          break

        case 'both':
          if (redirection.type === 'file' && redirection.target.startsWith('APPEND::')) {
            const path = redirection.target.replace(/^APPEND::/, '')
            config.stdout = path
            config.stderr = path
            config.combineStderr = true
            config.stdoutAppend = true
            config.stderrAppend = true
          }
          else {
            config.stdout = redirection.target
            config.stderr = redirection.target
            config.combineStderr = true
          }
          break
      }
    }

    return config
  }
}
