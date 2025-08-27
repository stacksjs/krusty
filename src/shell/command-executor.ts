import type { ChildProcess } from 'node:child_process'
import type { Logger } from '../logger'
import type { CommandResult, KrustyConfig, ParsedCommand } from '../types'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import process from 'node:process'
import { PassThrough, Readable } from 'node:stream'
import { RedirectionHandler } from '../utils/redirection'

export class CommandExecutor {
  private config: KrustyConfig
  private cwd: string
  private environment: Record<string, string>
  private log: Logger
  private lastExitCode: number = 0
  private xtrace: boolean = false
  private pipefail: boolean = false
  private lastXtraceLine: string | undefined

  constructor(config: KrustyConfig, cwd: string, environment: Record<string, string>, log: Logger) {
    this.config = config
    this.cwd = cwd
    this.environment = environment
    this.log = log
  }

  setXtrace(enabled: boolean): void {
    this.xtrace = enabled
  }

  setPipefail(enabled: boolean): void {
    this.pipefail = enabled
  }

  getLastExitCode(): number {
    return this.lastExitCode
  }

  getLastXtraceLine(): string | undefined {
    return this.lastXtraceLine
  }

  async executeExternalCommand(command: any, redirections?: any[]): Promise<CommandResult> {
    const start = performance.now()

    // Create a clean environment object without undefined values
    const cleanEnv = Object.fromEntries(
      Object.entries({
        ...process.env,
        ...this.environment,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
        BUN_FORCE_COLOR: '3',
      }).filter(([_, value]) => value !== undefined) as [string, string][],
    )

    // Determine if we'll stream output for this command
    const willStream = !command.background && this.config.streamOutput !== false

    // If this command needs an interactive TTY, run it attached to the terminal
    if (this.needsInteractiveTTY(command, redirections)) {
      // Ensure the terminal is in cooked mode
      try {
        const stdinAny = process.stdin as any
        if (typeof stdinAny.setRawMode === 'function' && stdinAny.isTTY)
          stdinAny.setRawMode(false)
      }
      catch {}

      // Prepare arguments for external command
      const externalArgs = (command.args || []).map((arg: string) => this.processAliasArgument(arg))

      // Spawn child attached to our TTY so it can handle password prompts, etc.
      const child = spawn(command.name, externalArgs, {
        cwd: this.cwd,
        env: cleanEnv,
        stdio: 'inherit',
      })

      // Wait for completion without setting up our usual piping/capture
      const exitCode: number = await new Promise((resolve) => {
        let settled = false
        const finish = (code?: number | null, signal?: NodeJS.Signals | null) => {
          if (settled)
            return
          settled = true
          let ec = code ?? 0
          if (signal)
            ec = signal === 'SIGTERM' ? 143 : 130
          resolve(ec)
        }

        child.on('error', (_error) => {
          try {
            const msg = `krusty: ${command.name}: command not found\n`
            process.stderr.write(msg)
          }
          catch {}
          finish(127, null)
        })
        child.on('close', (code, signal) => finish(code ?? 0, signal ?? null))
        child.on('exit', (code, signal) => setTimeout(() => finish(code ?? 0, signal ?? null), 0))
      })

      this.lastExitCode = exitCode
      return {
        exitCode,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
        streamed: true,
      }
    }

    // Configure stdio
    const stdio: any = ['pipe', 'pipe', 'pipe']

    // For external commands, remove surrounding quotes and unescape so spawn receives clean args
    const externalArgs = (command.args || []).map((arg: string) => this.processAliasArgument(arg))
    const child = spawn(command.name, externalArgs, {
      cwd: this.cwd,
      env: cleanEnv,
      stdio,
    })

    // Apply any parsed redirections
    if (redirections && redirections.length > 0) {
      try {
        await RedirectionHandler.applyRedirections(child, redirections, this.cwd)
      }
      catch {}
    }

    // If stdout was redirected/closed, avoid capturing it again
    const skipStdoutCapture = Array.isArray(redirections) && redirections.some((rd: any) => {
      if (rd.type === 'file' && (rd.direction === 'output' || rd.direction === 'append' || rd.direction === 'both'))
        return true
      if (rd.type === 'fd' && rd.fd === 1 && (rd.target === '&-' || /^&\d+$/.test(rd.target)))
        return true
      return false
    })

    return this.setupStreamingProcess(child, start, command, undefined, !!skipStdoutCapture)
  }

  async executePipedCommands(commands: any[], redirections?: any[]): Promise<CommandResult> {
    const start = performance.now()

    // Environment for all spawned processes
    const cleanEnv = Object.fromEntries(
      Object.entries({
        ...process.env,
        ...this.environment,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
        BUN_FORCE_COLOR: '3',
      }).filter(([_, value]) => value !== undefined) as [string, string][],
    )

    const children: Array<ChildProcess | null> = []
    const exitCodes: Array<number | null> = Array.from({ length: commands.length }, () => null)
    let stderrAgg = ''
    let stdoutLast = ''

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]

      // xtrace
      if (this.xtrace) {
        const formatArg = (a: string) => (a.includes(' ') ? `"${a}"` : a)
        const argsStr = Array.isArray(cmd.args) ? cmd.args.map((a: string) => formatArg(a)).join(' ') : ''
        try {
          process.stderr.write(`+ ${cmd.name}${argsStr ? ` ${argsStr}` : ''}\n`)
        }
        catch {}
      }

      // External command
      const extArgs = (cmd.args || []).map((arg: string) => this.processAliasArgument(arg))
      const child = spawn(cmd.name, extArgs, {
        cwd: this.cwd,
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      child.stderr?.on('data', (d) => {
        stderrAgg += d.toString()
      })

      children.push(child)
    }

    // Wire pipes between processes
    for (let i = 0; i < children.length - 1; i++) {
      const leftChild = children[i]
      const rightChild = children[i + 1]

      if (leftChild && rightChild) {
        leftChild.stdout?.pipe(rightChild.stdin!, { end: true })
      }
    }

    // Capture stdout only from the last process in the pipeline
    const lastChild = children[children.length - 1]
    if (lastChild) {
      lastChild.stdout?.on('data', (d) => {
        stdoutLast += d.toString()
      })
    }

    // Ensure first process stdin is closed
    const firstChild = children[0]
    if (firstChild) {
      try {
        firstChild.stdin?.end()
      }
      catch {}
    }

    // Await all processes
    if (children.length > 0) {
      await new Promise<void>((resolve) => {
        let closed = 0
        children.forEach((child, idx) => {
          if (child) {
            child.on('error', (_error) => {
              stderrAgg += `${String(_error)}\n`
              exitCodes[idx] = 127
              closed += 1
              if (closed === children.length)
                resolve()
            })
            child.on('close', (code, signal) => {
              let ec = code ?? 0
              if (signal)
                ec = signal === 'SIGTERM' ? 143 : 130
              exitCodes[idx] = ec
              closed += 1
              if (closed === children.length)
                resolve()
            })
          }
        })
      })
    }

    // Compute final exit code according to pipefail
    let finalExit = exitCodes[exitCodes.length - 1] ?? 0
    if (this.pipefail) {
      for (let i = exitCodes.length - 1; i >= 0; i--) {
        if ((exitCodes[i] ?? 0) !== 0) {
          finalExit = exitCodes[i] ?? 0
          break
        }
      }
    }

    this.lastExitCode = finalExit
    return {
      exitCode: finalExit,
      stdout: stdoutLast,
      stderr: stderrAgg,
      duration: performance.now() - start,
      streamed: false,
    }
  }

  private needsInteractiveTTY(command: any, redirections?: any[]): boolean {
    try {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        return false
    }
    catch {
      return false
    }

    if (!command || !command.name || command.background)
      return false

    // Only consider simple foreground commands without redirections
    if (Array.isArray(redirections) && redirections.length > 0)
      return false

    const name = String(command.name).toLowerCase()
    // Common interactive commands that require a TTY
    const interactiveNames = new Set(['sudo', 'ssh', 'sftp', 'scp', 'passwd', 'su'])
    if (interactiveNames.has(name))
      return true

    return false
  }

  private processAliasArgument(arg: string): string {
    if (!arg)
      return arg

    // Handle quoted strings
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith('\'') && arg.endsWith('\''))) {
      return arg.slice(1, -1)
    }

    // Handle escaped characters
    return arg.replace(/\\(.)/g, '$1')
  }

  private async setupStreamingProcess(
    child: ChildProcess,
    start: number,
    command: any,
    input?: string,
    skipStdoutCapture: boolean = false,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let lastWriteEndedWithNewline = true

      // Stream output in real-time by default, unless explicitly disabled or running in background
      const shouldStream = !command.background && this.config.streamOutput !== false

      // Timeout handling setup (foreground only)
      const timeoutMs = this.config.execution?.defaultTimeoutMs
      const killSignal = (this.config.execution?.killSignal || 'SIGTERM') as NodeJS.Signals
      let timeoutTimer: NodeJS.Timeout | null = null
      let timedOut = false
      let settled = false

      // Hook up stdout
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          const s = data.toString()
          stdout += s
          if (shouldStream && !skipStdoutCapture) {
            try {
              process.stdout.write(s)
            }
            catch {}
          }
          try {
            if (s.length > 0)
              lastWriteEndedWithNewline = s.endsWith('\n')
          }
          catch {}
        })
      }

      // Hook up stderr
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const s = data.toString()
          stderr += s
          if (shouldStream) {
            try {
              process.stderr.write(s)
            }
            catch {}
          }
          try {
            if (s.length > 0)
              lastWriteEndedWithNewline = s.endsWith('\n')
          }
          catch {}
        })
      }

      const finish = (code?: number | null, signal?: NodeJS.Signals | null) => {
        if (settled)
          return
        settled = true
        if (timeoutTimer)
          clearTimeout(timeoutTimer)

        let exitCode = code ?? 0
        if (timedOut) {
          exitCode = 124
        }
        else if (signal) {
          exitCode = signal === 'SIGTERM' ? 143 : 130
        }
        this.lastExitCode = exitCode

        // If we streamed and the last output didn't end with a newline, add one
        if (shouldStream) {
          try {
            const wroteSomething = (!skipStdoutCapture && stdout.length > 0) || stderr.length > 0
            if (wroteSomething && !lastWriteEndedWithNewline)
              process.stdout.write('\n')
          }
          catch {}
        }

        resolve({
          exitCode: this.lastExitCode,
          stdout: skipStdoutCapture ? '' : stdout,
          stderr,
          duration: performance.now() - start,
          streamed: shouldStream,
        })
      }

      // Error from spawn or exec
      child.on('error', (_error) => {
        this.lastExitCode = 127
        if (!stderr.includes('command not found')) {
          stderr += `krusty: ${command.name}: command not found\n`
        }
        finish(127, null)
      })

      // Handle completion via both 'close' and 'exit' events
      child.on('close', (code, signal) => finish(code ?? 0, signal ?? null))
      child.on('exit', (code, signal) => finish(code ?? 0, signal ?? null))

      // Start timeout timer after listeners are attached (foreground only)
      if (!command.background && typeof timeoutMs === 'number' && timeoutMs > 0) {
        try {
          timeoutTimer = setTimeout(() => {
            timedOut = true
            try {
              stderr += 'process timed out\n'
              if (shouldStream)
                process.stderr.write('process timed out\n')
            }
            catch {}
            try {
              child.kill(killSignal)
            }
            catch {}
          }, timeoutMs)
        }
        catch {}
      }

      // Handle stdin piping if provided
      if (child.stdin) {
        const childStdin = child.stdin
        if (input !== undefined) {
          try {
            if (input)
              childStdin.write(input)
          }
          catch {}
          try {
            childStdin.end()
          }
          catch {}
        }
        else if (command.stdinFile) {
          try {
            const rs = createReadStream(command.stdinFile, { encoding: 'utf-8' })
            rs.on('error', (err) => {
              stderr += `${String(err)}\n`
              try {
                childStdin?.end()
              }
              catch {}
            })
            rs.pipe(childStdin)
          }
          catch (err) {
            try {
              this.log.error('Error opening stdin file:', err)
            }
            catch {}
            try {
              childStdin.end()
            }
            catch {}
          }
        }
        else {
          try {
            childStdin.end()
          }
          catch {}
        }
      }

      // Handle background processes: don't wait, consider streamed
      if (command.background) {
        try {
          this.log.info(`[background] ${child.pid} ${command.raw || `${command.name} ${command.args.join(' ')}`}`)
        }
        catch {}
        this.lastExitCode = 0
        resolve({
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
          streamed: shouldStream,
        })
      }
    })
  }
}
