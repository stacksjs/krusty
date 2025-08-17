/* eslint-disable no-console */
import type { BuiltinCommand, BunshConfig, CommandResult, CompletionItem, ParsedCommand, Shell } from './types'
import { exec, spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import * as readline from 'node:readline'
import { promisify } from 'node:util'
import { createBuiltins } from './builtins'
import { CompletionProvider } from './completion'
import { HistoryManager } from './history'
import { HookManager } from './hooks'
import { CommandParser } from './parser'
import { PluginManager } from './plugins'
import { GitInfoProvider, PromptRenderer, SystemInfoProvider } from './prompt'

export class BunshShell implements Shell {
  public config: BunshConfig
  public cwd: string
  public environment: Record<string, string>
  public history: string[]
  public aliases: Record<string, string>
  public builtins: Map<string, BuiltinCommand>

  private parser: CommandParser
  private promptRenderer: PromptRenderer
  private systemInfoProvider: SystemInfoProvider
  private gitInfoProvider: GitInfoProvider
  private historyManager: HistoryManager
  private completionProvider: CompletionProvider
  private pluginManager: PluginManager
  private hookManager: HookManager
  private rl: readline.Interface | null = null
  private running = false
  private lastExitCode = 0

  constructor(config?: BunshConfig) {
    // Use a default config if none provided to avoid top-level await issues
    const fallbackConfig: BunshConfig = {
      verbose: false,
      prompt: {
        format: '{user}@{host} {path}{git} {symbol} ',
        showGit: true,
        showTime: false,
        showUser: true,
        showHost: true,
        showPath: true,
        showExitCode: true,
        transient: false,
      },
      history: {
        maxEntries: 10000,
        file: '~/.bunsh_history',
        ignoreDuplicates: true,
        ignoreSpace: true,
        searchMode: 'fuzzy',
      },
      completion: {
        enabled: true,
        caseSensitive: false,
        showDescriptions: true,
        maxSuggestions: 10,
      },
      aliases: {},
      environment: {},
      plugins: [],
      theme: {
        colors: {
          primary: '#00D9FF',
          secondary: '#FF6B9D',
          success: '#00FF88',
          warning: '#FFD700',
          error: '#FF4757',
          info: '#74B9FF',
        },
        symbols: {
          prompt: '❯',
          continuation: '…',
          git: {
            branch: '',
            ahead: '⇡',
            behind: '⇣',
            staged: '●',
            unstaged: '○',
            untracked: '?',
          },
        },
      },
      hooks: {
        'shell:init': [],
        'shell:start': [],
        'shell:stop': [],
        'shell:exit': [],
        'command:before': [],
        'command:after': [],
        'command:error': [],
        'prompt:before': [],
        'prompt:after': [],
        'prompt:render': [],
        'directory:change': [],
        'directory:enter': [],
        'directory:leave': [],
        'history:add': [],
        'history:search': [],
        'completion:before': [],
        'completion:after': [],
      },
    }

    this.config = config || fallbackConfig
    this.cwd = process.cwd()
    this.environment = { ...process.env }
    this.history = []
    this.aliases = { ...this.config.aliases }
    this.builtins = createBuiltins()

    this.parser = new CommandParser()
    this.promptRenderer = new PromptRenderer(this.config)
    this.systemInfoProvider = new SystemInfoProvider()
    this.gitInfoProvider = new GitInfoProvider()
    this.historyManager = new HistoryManager(this.config.history)
    this.completionProvider = new CompletionProvider(this)
    this.pluginManager = new PluginManager(this, this.config)
    this.hookManager = new HookManager(this, this.config)

    // Load history
    this.loadHistory()
  }

  async execute(command: string): Promise<CommandResult> {
    const start = performance.now()

    try {
      // Skip empty commands
      if (!command.trim()) {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        }
      }

      // Execute command:before hooks
      await this.hookManager.executeHooks('command:before', { command })

      // Add to history (before execution to capture the command even if it fails)
      this.addToHistory(command)

      // Parse the command
      const parsed = this.parseCommand(command)

      if (parsed.commands.length === 0) {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        }
      }

      // Execute command chain
      const result = await this.executeCommandChain(parsed)
      this.lastExitCode = result.exitCode

      // Execute command:after hooks
      await this.hookManager.executeHooks('command:after', { command, result })

      return result
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const result = {
        exitCode: 1,
        stdout: '',
        stderr: `bunsh: ${errorMessage}\n`,
        duration: performance.now() - start,
      }

      // Execute command:error hooks
      await this.hookManager.executeHooks('command:error', { command, error: errorMessage, result })

      return result
    }
  }

  parseCommand(input: string): ParsedCommand {
    return this.parser.parse(input)
  }

  changeDirectory(path: string): boolean {
    try {
      let targetPath = path

      // Handle tilde expansion
      if (targetPath.startsWith('~')) {
        targetPath = targetPath.replace('~', homedir())
      }

      // Handle relative paths
      if (!targetPath.startsWith('/')) {
        targetPath = resolve(this.cwd, targetPath)
      }

      // Check if directory exists and is accessible
      if (!existsSync(targetPath)) {
        return false
      }

      const stat = statSync(targetPath)
      if (!stat.isDirectory()) {
        return false
      }

      // Change directory
      process.chdir(targetPath)
      this.cwd = targetPath
      return true
    }
    catch {
      return false
    }
  }

  async start(): Promise<void> {
    if (this.running)
      return

    // Execute shell:init hooks
    await this.hookManager.executeHooks('shell:init', {})

    // Load plugins
    await this.pluginManager.loadPlugins()

    this.running = true

    // Execute shell:start hooks
    await this.hookManager.executeHooks('shell:start', {})

    // Setup readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: (line: string) => {
        const completions = this.getCompletions(line, line.length)
        return [completions, line]
      },
    })

    // Handle Ctrl+C
    this.rl.on('SIGINT', () => {
      console.log('\n(To exit, press Ctrl+D or type "exit")')
      this.rl?.prompt()
    })

    // Main REPL loop
    while (this.running) {
      try {
        const prompt = await this.renderPrompt()
        const input = await this.readLine(prompt)

        if (input === null) {
          // EOF (Ctrl+D)
          break
        }

        if (input.trim()) {
          const result = await this.execute(input)

          if (result.stdout) {
            process.stdout.write(result.stdout)
          }

          if (result.stderr) {
            process.stderr.write(result.stderr)
          }
        }
      }
      catch (error) {
        console.error('Shell error:', error)
      }
    }

    this.stop()
  }

  stop(): void {
    this.running = false
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    this.saveHistory()

    // Execute shell:stop hooks
    this.hookManager.executeHooks('shell:stop', {}).catch(console.error)

    // Shutdown plugins
    this.pluginManager.shutdown().catch(console.error)

    // Execute shell:exit hooks
    this.hookManager.executeHooks('shell:exit', {}).catch(console.error)
  }

  async renderPrompt(): Promise<string> {
    // Execute prompt:before hooks
    await this.hookManager.executeHooks('prompt:before', {})

    const systemInfo = await this.systemInfoProvider.getSystemInfo()
    const gitInfo = await this.gitInfoProvider.getGitInfo(this.cwd)
    const prompt = this.promptRenderer.render(this.cwd, systemInfo, gitInfo, this.lastExitCode)

    // Execute prompt:after hooks
    await this.hookManager.executeHooks('prompt:after', { prompt })

    return prompt
  }

  addToHistory(command: string): void {
    this.historyManager.add(command)
    this.history = this.historyManager.getHistory()

    // Execute history:add hooks
    this.hookManager.executeHooks('history:add', { command }).catch(console.error)
  }

  searchHistory(query: string): string[] {
    // Execute history:search hooks
    this.hookManager.executeHooks('history:search', { query }).catch(console.error)

    return this.historyManager.search(query)
  }

  getCompletions(input: string, cursor: number): string[] {
    // Execute completion:before hooks
    this.hookManager.executeHooks('completion:before', { input, cursor }).catch(console.error)

    const completions = this.completionProvider.getCompletions(input, cursor)

    // Add plugin completions
    const pluginCompletions = this.pluginManager.getPluginCompletions(input, cursor)
    completions.push(...pluginCompletions)

    // Execute completion:after hooks
    this.hookManager.executeHooks('completion:after', { input, cursor, completions }).catch(console.error)

    return completions
  }

  private async executeCommandChain(parsed: ParsedCommand): Promise<CommandResult> {
    if (parsed.commands.length === 1) {
      return this.executeSingleCommand(parsed.commands[0], parsed.redirects)
    }

    // Handle piped commands
    return this.executePipedCommands(parsed.commands, parsed.redirects)
  }

  private async executeSingleCommand(command: any, redirects?: ParsedCommand['redirects']): Promise<CommandResult> {
    // Expand aliases
    const expandedCommand = this.expandAlias(command)

    // Check if it's a builtin command
    if (this.builtins.has(expandedCommand.name)) {
      const builtin = this.builtins.get(expandedCommand.name)!
      return builtin.execute(expandedCommand.args, this)
    }

    // Execute external command
    return this.executeExternalCommand(expandedCommand, redirects)
  }

  private async executePipedCommands(commands: any[], redirects?: ParsedCommand['redirects']): Promise<CommandResult> {
    // For now, implement simple pipe execution
    // This is a simplified version - full pipe implementation would be more complex

    let lastResult: CommandResult = {
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: 0,
    }

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]
      const isLast = i === commands.length - 1

      if (i === 0) {
        // First command
        lastResult = await this.executeSingleCommand(command)
      }
      else {
        // Pipe previous output to current command
        const result = await this.executeWithInput(command, lastResult.stdout)
        lastResult = {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: lastResult.stderr + result.stderr,
          duration: lastResult.duration + result.duration,
        }
      }

      if (lastResult.exitCode !== 0 && !isLast) {
        break // Stop on error unless it's the last command
      }
    }

    return lastResult
  }

  private expandAlias(command: any): any {
    if (this.aliases[command.name]) {
      const aliasValue = this.aliases[command.name]
      const aliasTokens = aliasValue.split(' ')
      return {
        ...command,
        name: aliasTokens[0],
        args: [...aliasTokens.slice(1), ...command.args],
      }
    }
    return command
  }

  private async executeExternalCommand(command: any, redirects?: ParsedCommand['redirects']): Promise<CommandResult> {
    const start = performance.now()

    return new Promise((resolve) => {
      const child = spawn(command.name, command.args, {
        cwd: this.cwd,
        env: { ...this.environment },
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

      child.on('error', (error) => {
        resolve({
          exitCode: 127,
          stdout: '',
          stderr: `bunsh: ${command.name}: command not found\n`,
          duration: performance.now() - start,
        })
      })

      child.on('close', (code) => {
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
          duration: performance.now() - start,
        })
      })

      // Handle background processes
      if (command.background) {
        console.log(`[${child.pid}] ${command.raw}`)
        resolve({
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        })
      }
    })
  }

  private async executeWithInput(command: any, input: string): Promise<CommandResult> {
    const start = performance.now()

    return new Promise((resolve) => {
      const child = spawn(command.name, command.args, {
        cwd: this.cwd,
        env: { ...this.environment },
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

      child.on('error', (error) => {
        resolve({
          exitCode: 127,
          stdout: '',
          stderr: `bunsh: ${command.name}: command not found\n`,
          duration: performance.now() - start,
        })
      })

      child.on('close', (code) => {
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
          duration: performance.now() - start,
        })
      })

      // Send input to the command
      if (child.stdin) {
        child.stdin.write(input)
        child.stdin.end()
      }
    })
  }

  private readLine(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null)
        return
      }

      this.rl.question(prompt, (answer) => {
        resolve(answer)
      })
    })
  }

  private loadHistory(): void {
    try {
      this.history = this.historyManager.getHistory()
    }
    catch (error) {
      // Ignore history loading errors
      if (this.config.verbose) {
        console.warn('Failed to load history:', error)
      }
    }
  }

  private saveHistory(): void {
    try {
      this.historyManager.save()
    }
    catch (error) {
      // Ignore history saving errors
      if (this.config.verbose) {
        console.warn('Failed to save history:', error)
      }
    }
  }
}
