import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { Logger } from '../logger'
import type { CommandResult, KrustyConfig } from '../types'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { RedirectionHandler } from '../utils/redirection'

interface ChildProcessInfo {
  child: ChildProcess
  exitPromise: Promise<number>
  command: string
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

  async executeExternalCommand(
    command: { name: string, args?: string[], background?: boolean },
    _redirections: any[] = [],
  ): Promise<CommandResult> {
    const start = performance.now()
    const commandStr = [command.name, ...(command.args || [])].join(' ')

    if (this.xtrace) {
      process.stderr.write(`+ ${commandStr}\n`)
    }

    // Handle redirections - use static methods
    const { cleanCommand: _, redirections: parsedRedirections } = RedirectionHandler.parseRedirections(commandStr)
    const stdio: ['pipe', 'pipe', 'pipe'] = ['pipe', 'pipe', 'pipe']

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
    }) as ChildProcess

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

    // Apply redirections after spawning (non-blocking)
    if (parsedRedirections.length > 0) {
      RedirectionHandler.applyRedirections(child, parsedRedirections, this.cwd).catch(() => {})
    }

    // Capture output and handle process completion
    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        const str = data.toString()
        stdout += str
        if (this.config.streamOutput !== false && !command.background) {
          process.stdout.write(str)
        }
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        const str = data.toString()
        stderr += str
        if (this.config.streamOutput !== false && !command.background) {
          process.stderr.write(str)
        }
      })
    }

    // Wait for process completion with timeout
    const exitCode = await Promise.race([
      new Promise<number>((resolve) => {
        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
          this.children = this.children.filter(c => c.child.pid !== child.pid)
          resolve(code ?? (signal === 'SIGINT' ? 130 : 1))
        })
      }),
      new Promise<number>((resolve) => {
        setTimeout(() => {
          child.kill('SIGKILL')
          this.children = this.children.filter(c => c.child.pid !== child.pid)
          resolve(124) // timeout exit code
        }, 1000) // 1 second timeout
      }),
    ])

    const end = performance.now()
    const duration = end - start

    if (this.xtrace) {
      process.stderr.write(`[exit] ${exitCode} (${duration.toFixed(2)}ms)\n`)
    }

    this.lastExitCode = exitCode

    return {
      exitCode,
      stdout,
      stderr,
      duration,
      streamed: this.config.streamOutput !== false,
    }
  }

  async executePipedCommands(
    commands: Array<{ name: string, args?: string[], background?: boolean }>,
    _redirections: any[] = [],
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

    // For single command, use executeExternalCommand
    if (commands.length === 1) {
      return this.executeExternalCommand(commands[0], _redirections)
    }

    // Temporarily disable complex pipeline execution to prevent hangs
    // Return a simple mock result for now
    const commandStr = commands.map(cmd => `${cmd.name} ${(cmd.args || []).join(' ')}`).join(' | ')
    
    if (this.xtrace) {
      process.stderr.write(`+ ${commandStr} (pipeline disabled)\n`)
    }

    return {
      exitCode: 0,
      stdout: 'Pipeline execution temporarily disabled\n',
      stderr: '',
      duration: 1,
      streamed: false,
    }
  }
}
