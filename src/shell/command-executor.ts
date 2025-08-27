import type { ChildProcess } from 'node:child_process'
import type { Logger } from '../logger'
import type { CommandResult, KrustyConfig } from '../types'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import process from 'node:process'
import { RedirectionHandler } from '../utils/redirection'

interface ChildProcessInfo {
  child: ChildProcess
  exitPromise: Promise<number>
  command: string
}

interface Command {
  name: string
  args?: string[]
  background?: boolean
}

export class CommandExecutor {
  private children: ChildProcessInfo[] = []
  private stderrChunks: string[] = []
  private stdoutChunks: string[] = []
  private commandFailed = false
  private lastExitCode = 0
  private xtrace = false
  private pipefail = false
  private lastXtraceLine: string | undefined

  constructor(
    private config: KrustyConfig,
    private cwd: string,
    private environment: Record<string, string>,
    private log: Logger,
  ) {}

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

  private processAliasArgument(arg: string): string {
    if (!arg)
      return ''
    // Handle quoted strings
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith('\'') && arg.endsWith('\''))) {
      return arg.slice(1, -1)
    }
    // Handle escaped characters by removing the backslash
    return arg.replace(/\\(.)/g, '$1')
  }

  private needsInteractiveTTY(command: { name?: string, background?: boolean }, redirections: any[] = []): boolean {
    try {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return false
      }
    }
    catch {
      return false
    }

    if (!command || !command.name || command.background) {
      return false
    }

    // Only consider simple foreground commands without redirections
    if (Array.isArray(redirections) && redirections.length > 0) {
      return false
    }

    const name = String(command.name).toLowerCase()
    // Common interactive commands that require a TTY
    const interactiveNames = new Set(['sudo', 'ssh', 'sftp', 'scp', 'passwd', 'su'])
    return interactiveNames.has(name)
  }

  private async setupStreamingProcess(
    child: ChildProcess,
    start: number,
    command: { name: string, args?: string[], background?: boolean },
    input?: string,
    skipStdoutCapture = false,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let lastWriteEndedWithNewline = true

      // Stream output in real-time by default, unless explicitly disabled or running in background
      const shouldStream = !command.background && this.config.streamOutput !== false

      // Handle stdout
      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          const str = data.toString()
          if (!skipStdoutCapture) {
            stdout += str
          }
          if (shouldStream) {
            process.stdout.write(str)
          }
          lastWriteEndedWithNewline = str.endsWith('\n')
        })
      }

      // Handle stderr
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          const str = data.toString()
          stderr += str
          process.stderr.write(str)
        })
      }

      // Handle process completion
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        const end = performance.now()
        const duration = end - start
        const exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)

        if (this.xtrace) {
          process.stderr.write(`[exit] ${exitCode} (${duration.toFixed(2)}ms)\n`)
        }

        resolve({
          exitCode,
          stdout,
          stderr,
          duration,
          streamed: this.config.streamOutput !== false,
        })
      })
    })
  }

  async executeExternalCommand(
    command: { name: string, args?: string[], background?: boolean },
    redirections: any[] = [],
  ): Promise<CommandResult> {
    const start = performance.now()
    const commandStr = [command.name, ...(command.args || [])].join(' ')

    if (this.xtrace) {
      process.stderr.write(`+ ${commandStr}\n`)
    }

    // Handle redirections
    const redirHandler = new RedirectionHandler(redirections)
    const stdio = redirHandler.getStdio()

    // Prepare environment
    const cleanEnv = {
      ...process.env,
      ...this.environment,
      FORCE_COLOR: '1',
      TERM: process.env.TERM || 'xterm-256color',
    }

    // Spawn the process
    const child = spawn(command.name, command.args || [], {
      cwd: this.cwd,
      env: cleanEnv,
      stdio,
      shell: true,
      windowsHide: true,
    })

    // Set up process tracking
    const childInfo: ChildProcessInfo = {
      child,
      command: commandStr,
      exitPromise: new Promise<number>((resolve) => {
        child.on('exit', (code) => {
          this.children = this.children.filter(c => c.child.pid !== child.pid)
          resolve(code ?? 0)
        })
      }),
    }
    this.children.push(childInfo)

    // Set up I/O handling
    if (redirHandler.hasInput()) {
      const inputStream = redirHandler.getInputStream()
      inputStream.pipe(child.stdin!)
    }

    if (redirHandler.hasOutput()) {
      child.stdout!.pipe(redirHandler.getOutputStream())
    }

    if (redirHandler.hasError()) {
      child.stderr!.pipe(redirHandler.getErrorStream())
    }

    // Handle background processes
    if (command.background) {
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
        streamed: false,
      }
    }

    // Wait for process completion
    const exitCode = await childInfo.exitPromise
    const end = performance.now()
    const duration = end - start

    if (this.xtrace) {
      process.stderr.write(`[exit] ${exitCode} (${duration.toFixed(2)}ms)\n`)
    }

    return {
      exitCode,
      stdout: '',
      stderr: '',
      duration,
      streamed: this.config.streamOutput !== false,
    }
  }

  async executePipedCommands(
    commands: Array<{ name: string, args?: string[], background?: boolean }>,
    redirections: any[] = [],
  ): Promise<CommandResult> {
    if (commands.length === 0) {
      return {
        exitCode: 0,
        stdout: '',
        stderr: 'No commands provided',
        duration: 0,
        streamed: false,
      }
    }

    const start = performance.now()
    const children: ChildProcessInfo[] = []
    let lastExitCode = 0
    let commandFailed = false

    try {
      // Create all child processes
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i]
        const commandStr = [cmd.name, ...(cmd.args || [])].join(' ')

        if (this.xtrace) {
          process.stderr.write(`+ ${commandStr}\n`)
        }

        // Prepare environment
        const cleanEnv = {
          ...process.env,
          ...this.environment,
          FORCE_COLOR: '1',
          TERM: process.env.TERM || 'xterm-256color',
        }

        // Determine stdio configuration
        const stdio: any[] = [
          i === 0 ? 'pipe' : 'pipe', // stdin
          i === commands.length - 1 ? 'pipe' : 'pipe', // stdout
          'pipe', // stderr
        ]

        // Spawn the process
        const child = spawn(cmd.name, cmd.args || [], {
          cwd: this.cwd,
          env: cleanEnv,
          stdio,
          shell: true,
          windowsHide: true,
        })

        // Set up process tracking
        const exitPromise = new Promise<number>((resolve) => {
          child.on('exit', (code, signal) => {
            const exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
            resolve(exitCode)
          })
        })

        children.push({
          child,
          command: commandStr,
          exitPromise,
        })
      }

      // Connect pipes between processes
      for (let i = 0; i < children.length - 1; i++) {
        const current = children[i]
        const next = children[i + 1]

        if (current.child.stdout && next.child.stdin) {
          current.child.stdout.pipe(next.child.stdin)

          // Handle pipe errors
          current.child.stdout.on('error', (error: Error) => {
            this.stderrChunks.push(`Pipe error: ${error.message}\n`)
            if (this.xtrace) {
              process.stderr.write(`[pipe error] ${error.message}\n`)
            }
            commandFailed = true
          })
        }
      }

      // Handle redirections for the first and last processes
      const firstProcess = children[0]
      const lastProcess = children[children.length - 1]
      const redirHandler = new RedirectionHandler(redirections)

      if (redirHandler.hasInput() && firstProcess.child.stdin) {
        const inputStream = redirHandler.getInputStream()
        inputStream.pipe(firstProcess.child.stdin)
      }

      if (redirHandler.hasOutput() && lastProcess.child.stdout) {
        lastProcess.child.stdout.pipe(redirHandler.getOutputStream())
      }

      if (redirHandler.hasError() && lastProcess.child.stderr) {
        lastProcess.child.stderr.pipe(redirHandler.getErrorStream())
      }

      // Wait for all processes to complete
      const exitCodes = await Promise.all(children.map(c => c.exitPromise))
      lastExitCode = exitCodes[exitCodes.length - 1]
      commandFailed = exitCodes.some(code => code !== 0) || commandFailed
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.stderrChunks.push(`Error executing pipeline: ${errorMessage}\n`)
      if (this.xtrace) {
        process.stderr.write(`[error] ${errorMessage}\n`)
      }
      lastExitCode = 1
      commandFailed = true
    }

    const end = performance.now()
    const duration = end - start

    if (this.xtrace) {
      process.stderr.write(`[pipeline exit] ${lastExitCode} (${duration.toFixed(2)}ms)\n`)
    }

    return {
      exitCode: this.pipefail && commandFailed ? 1 : lastExitCode,
      stdout: this.stdoutChunks.join(''),
      stderr: this.stderrChunks.join(''),
      duration,
      streamed: this.config.streamOutput !== false,
    }
  }
}
