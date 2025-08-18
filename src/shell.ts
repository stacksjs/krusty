import type { ChildProcess } from 'node:child_process'
import type { BuiltinCommand, CommandResult, KrustyConfig, ParsedCommand, Plugin, Shell } from './types'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import * as readline from 'node:readline'
import { createBuiltins } from './builtins'
import { CompletionProvider } from './completion'
import { defaultConfig, loadKrustyConfig } from './config'
import { HistoryManager } from './history'
import { HookManager } from './hooks'
import { Logger } from './logger'
import { CommandParser } from './parser'
import { PluginManager } from './plugins'
import { GitInfoProvider, PromptRenderer, SystemInfoProvider } from './prompt'

export class KrustyShell implements Shell {
  public config: KrustyConfig
  public cwd: string
  public environment: Record<string, string>
  public historyManager: HistoryManager
  public aliases: Record<string, string>
  public builtins: Map<string, BuiltinCommand>
  public history: string[] = []
  public jobs: Array<{
    id: number
    pid: number
    command: string
    status: 'running' | 'stopped' | 'done'
  }> = []
  private nextJobId = 1
  private lastExitCode: number = 0

  private parser: CommandParser
  private promptRenderer: PromptRenderer
  private systemInfoProvider: SystemInfoProvider
  private gitInfoProvider: GitInfoProvider
  private completionProvider: CompletionProvider
  private pluginManager: PluginManager
  private hookManager: HookManager
  public log: Logger
  private rl: readline.Interface | null = null
  private running = false

  constructor(config?: KrustyConfig) {
    // Use defaultConfig from src/config to preserve exact equality in tests
    this.config = config || defaultConfig
    // Ensure plugins array exists
    if (!this.config.plugins)
      this.config.plugins = []

    // Default plugins are injected by PluginManager at load time.
    this.cwd = process.cwd()
    // Convert process.env to Record<string, string> by filtering out undefined values
    this.environment = Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined),
    ) as Record<string, string>
    this.history = []
    this.historyManager = new HistoryManager({
      maxEntries: 1000,
      file: '~/.bunsh_history',
      ignoreDuplicates: true,
      ignoreSpace: true,
    })
    // Initialize aliases from config (tests expect constructor to honor provided aliases)
    this.aliases = { ...(this.config.aliases || {}) }
    this.builtins = createBuiltins()

    // Initialize history manager
    this.historyManager.initialize().catch(console.error)

    this.parser = new CommandParser()
    this.promptRenderer = new PromptRenderer(this.config)
    this.systemInfoProvider = new SystemInfoProvider()
    this.gitInfoProvider = new GitInfoProvider()
    this.completionProvider = new CompletionProvider(this)
    this.pluginManager = new PluginManager(this, this.config)
    this.hookManager = new HookManager(this, this.config)
    this.log = new Logger(this.config.verbose, 'shell')

    // Load history
    this.loadHistory()
  }

  private loadHistory(): void {
    try {
      this.history = this.historyManager.getHistory()
    } catch (error) {
      if (this.config.verbose) {
        this.log.warn('Failed to load history:', error)
      }
    }
  }

  private saveHistory(): void {
    try {
      this.historyManager.save()
    } catch (error) {
      if (this.config.verbose) {
        this.log.warn('Failed to save history:', error)
      }
    }
  }

  // Job management methods
  addJob(command: string, pid?: number): number {
    const jobId = this.nextJobId++
    const processId = pid ?? process.pid
    this.jobs.push({
      id: jobId,
      pid: processId,
      command,
      status: 'running'
    })
    return jobId
  }

  removeJob(pid: number): void {
    const index = this.jobs.findIndex(job => job.pid === pid)
    if (index !== -1) {
      this.jobs.splice(index, 1)
    }
  }

  getJob(id: number): { id: number; pid: number; command: string; status: 'running' | 'stopped' | 'done' } | undefined {
    return this.jobs.find(job => job.id === id)
  }

  getJobs(): Array<{ id: number; pid: number; command: string; status: 'running' | 'stopped' | 'done' }> {
    return [...this.jobs]
  }

  setJobStatus(id: number, status: 'running' | 'stopped' | 'done'): boolean {
    const job = this.jobs.find(job => job.id === id)
    if (job) {
      job.status = status
      return true
    }
    return false
  }

  // Public proxies for plugin operations (for tests and external callers)
  async loadPlugins(): Promise<void> {
    await this.pluginManager.loadPlugins()
  }

  getPlugin(name: string): Plugin | undefined {
    return this.pluginManager.getPlugin(name)
  }

  // Reload configuration, hooks, and plugins at runtime
  public async reload(): Promise<CommandResult> {
    const start = performance.now()
    try {
      // Load latest config from disk
      const newConfig = await loadKrustyConfig()

      // Apply environment: start from current process.env to keep runtime updates, then overlay new config
      this.environment = Object.fromEntries(
        Object.entries(process.env).filter(([_, v]) => v !== undefined),
      ) as Record<string, string>
      if (newConfig.environment) {
        for (const [k, v] of Object.entries(newConfig.environment)) {
          if (v === undefined)
            continue
          this.environment[k] = v
          process.env[k] = v
        }
      }

      // Replace config and dependent components
      this.config = newConfig
      this.aliases = { ...this.config.aliases }
      this.promptRenderer = new PromptRenderer(this.config)

      // Recreate history manager with new settings but keep in-memory history
      this.historyManager = new HistoryManager(this.config.history)
      this.loadHistory()

      // Recreate hooks with new config
      this.hookManager = new HookManager(this, this.config)

      // Restart plugins to reflect new config
      await this.pluginManager.shutdown()
      this.pluginManager = new PluginManager(this, this.config)
      await this.pluginManager.loadPlugins()

      // Reinitialize modules using new config
      try {
        const { initializeModules } = await import('./modules/registry')
        initializeModules(this.config.modules)
      }
      catch (e) {
        this.log.warn('Module reinitialization failed:', e)
      }

      // Execute a reload hook event if configured
      await this.hookManager.executeHooks('shell:reload', {})

      return {
        exitCode: 0,
        stdout: 'Configuration reloaded successfully\n',
        stderr: '',
        duration: performance.now() - start,
      }
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        exitCode: 1,
        stdout: '',
        stderr: `reload: ${msg}\n`,
        duration: performance.now() - start,
      }
    }
  }

  async executeCommand(command: string, args: string[] = []): Promise<CommandResult> {
    // Create a command object that matches the expected format
    const cmd = { name: command, args }
    return this.executeSingleCommand(cmd)
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
        stderr: `krusty: ${errorMessage}\n`,
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

    // Initialize modules
    const { initializeModules } = await import('./modules/registry')
    initializeModules(this.config.modules)

    // Execute shell:init hooks
    await this.hookManager.executeHooks('shell:init', {})

    // Load plugins
    await this.pluginManager.loadPlugins()

    this.running = true

    // Execute shell:start hooks
    await this.hookManager.executeHooks('shell:start', {})

    try {
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
        this.log.info('(To exit, press Ctrl+D or type "exit")')
        if (this.rl) {
          try {
            this.rl.prompt()
          }
          catch (error) {
            this.log.error('Error prompting after SIGINT:', error)
          }
        }
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
          this.log.error('Shell error:', error)
          if (error instanceof Error && error.message.includes('readline was closed')) {
            break // Exit the loop if readline was closed
          }
        }
      }
    }
    catch (error) {
      this.log.error('Fatal shell error:', error)
    }
    finally {
      this.stop()
    }
  }

  stop(): void {
    this.running = false

    try {
      if (this.rl) {
        this.rl.close()
        this.rl = null
      }
    }
    catch (error) {
      this.log.error('Error closing readline interface:', error)
    }

    try {
      this.saveHistory()
    }
    catch (error) {
      this.log.error('Error saving history:', error)
    }

    // Execute shell:stop hooks
    this.hookManager.executeHooks('shell:stop', {}).catch(err => this.log.error('shell:stop hook error:', err))

    // Shutdown plugins
    this.pluginManager.shutdown().catch(err => this.log.error('plugin shutdown error:', err))

    // Execute shell:exit hooks
    this.hookManager.executeHooks('shell:exit', {}).catch(err => this.log.error('shell:exit hook error:', err))
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
    this.hookManager.executeHooks('history:add', { command }).catch(err => this.log.error('history:add hook error:', err))
  }

  searchHistory(query: string): string[] {
    // Execute history:search hooks
    this.hookManager.executeHooks('history:search', { query }).catch(err => this.log.error('history:search hook error:', err))

    return this.historyManager.search(query)
  }

  getCompletions(input: string, cursor: number): string[] {
    try {
      // Execute completion:before hooks
      this.hookManager.executeHooks('completion:before', { input, cursor })
        .catch(err => this.log.error('completion:before hook error:', err))

      // Get completions from the completion provider
      let completions: string[] = []
      
      try {
        completions = this.completionProvider.getCompletions(input, cursor)
      } catch (error) {
        this.log.error('Error in completion provider:', error)
      }

      // Add plugin completions if available
      if (this.pluginManager?.getPluginCompletions) {
        try {
          const pluginCompletions = this.pluginManager.getPluginCompletions(input, cursor) || []
          completions = [...new Set([...completions, ...pluginCompletions])] // Remove duplicates
        } catch (error) {
          this.log.error('Error getting plugin completions:', error)
        }
      }

      // Filter out empty strings and sort
      completions = completions
        .filter(c => c && c.trim().length > 0)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

      // Execute completion:after hooks
      this.hookManager.executeHooks('completion:after', { input, cursor, completions })
        .catch(err => this.log.error('completion:after hook error:', err))

      return completions
    } catch (error) {
      this.log.error('Error in getCompletions:', error)
      return []
    }
  }

  private async executeCommandChain(parsed: ParsedCommand): Promise<CommandResult> {
    if (parsed.commands.length === 1) {
      return this.executeSingleCommand(parsed.commands[0])
    }

    // Handle piped commands
    return this.executePipedCommands(parsed.commands)
  }

  private async executeSingleCommand(command: any): Promise<CommandResult> {
    if (!command?.name) {
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 0,
      }
    }

    // Expand aliases with cycle detection
    const expandedCommand = this.expandAliasWithCycleDetection(command)

    // If the expanded command represents a pipeline constructed by alias expansion
    if ((expandedCommand as any).pipe && Array.isArray((expandedCommand as any).pipeCommands)) {
      const commands = [
        { name: expandedCommand.name, args: expandedCommand.args },
        ...((expandedCommand as any).pipeCommands as any[]).map(c => ({ name: c.name, args: c.args })),
      ]
      return this.executePipedCommands(commands)
    }

    // If the expanded command is a chain of sequential commands (separated by ;) from alias expansion
    if ((expandedCommand as any).next) {
      let current: any = expandedCommand
      let aggregate: CommandResult | null = null

      while (current) {
        const res = await this.executeSingleCommand({ name: current.name, args: current.args })
        if (!aggregate) {
          aggregate = { ...res }
        }
        else {
          aggregate = {
            exitCode: res.exitCode,
            stdout: (aggregate.stdout || '') + (res.stdout || ''),
            stderr: (aggregate.stderr || '') + (res.stderr || ''),
            duration: (aggregate.duration || 0) + (res.duration || 0),
          }
        }

        current = current.next?.command
      }

      return aggregate || { exitCode: 0, stdout: '', stderr: '', duration: 0 }
    }

    // Check if it's a builtin command
    if (this.builtins.has(expandedCommand.name)) {
      const builtin = this.builtins.get(expandedCommand.name)!
      return builtin.execute(expandedCommand.args, this)
    }

    // Execute external command
    return this.executeExternalCommand(expandedCommand)
  }

  /**
   * Expands aliases with cycle detection to prevent infinite recursion
   */
  private expandAliasWithCycleDetection(command: any, visited: Set<string> = new Set()): any {
    if (!command?.name)
      return command

    // Check for cycles
    if (visited.has(command.name)) {
      this.log.error(`Alias cycle detected: ${Array.from(visited).join(' -> ')} -> ${command.name}`)
      return command
    }

    const expanded = this.expandAlias(command)

    // If the command wasn't an alias, we're done
    if (expanded === command) {
      return command
    }

    // Continue expanding aliases in the expanded command
    visited.add(command.name)
    return this.expandAliasWithCycleDetection(expanded, visited)
  }

  private async executePipedCommands(commands: any[]): Promise<CommandResult> {
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

  /**
   * Expands a command if it matches a defined alias
   * @param command The command to potentially expand
   * @returns The expanded command or the original command if no alias was found
   */
  private expandAlias(command: any): any {
    if (!command?.name) {
      return command
    }

    const aliasValue = this.aliases[command.name]
    if (aliasValue === undefined) {
      return command
    }

    // Handle empty alias
    if (aliasValue === '') {
      if (command.args.length > 0) {
        return {
          ...command,
          name: command.args[0],
          args: command.args.slice(1),
        }
      }
      return { ...command, name: 'true', args: [] }
    }

    // Process the alias value
    let processedValue = aliasValue.trim()
    // Handle quoted numeric placeholders like "$1" so that quotes are preserved in output.
    // We replace them with internal markers before general substitution and remove the quotes,
    // then after tokenization we turn the markers back into literal quoted arguments.
    const QUOTED_MARKER_PREFIX = '__krusty_QARG_'
    processedValue = processedValue.replace(/"\$(\d+)"/g, (_m, num) => `${QUOTED_MARKER_PREFIX}${num}__`)
    const hasArgs = command.args.length > 0
    const endsWithSpace = aliasValue.endsWith(' ')
    const hasPlaceholders = /\$@|\$\d+/.test(aliasValue)

    // Handle environment variables first
    processedValue = processedValue.replace(/\$([A-Z_]\w*)/gi, (_, varName) => {
      return this.environment[varName] || ''
    })

    // Handle argument substitution
    if (hasArgs) {
      // Replace $@ with all arguments, properly quoted (to preserve grouping when tokenized later)
      if (processedValue.includes('$@')) {
        const quotedArgs = command.args.map((arg: string) =>
          arg.includes(' ') ? `"${arg}"` : arg,
        )
        processedValue = processedValue.replace(/\$@/g, quotedArgs.join(' '))
      }

      // Replace $1, $2, etc. with specific arguments
      processedValue = processedValue.replace(/\$(\d+)/g, (_, num) => {
        const index = Number.parseInt(num, 10) - 1
        return command.args[index] !== undefined ? command.args[index] : ''
      })

      // If alias ends with space OR it doesn't contain placeholders, append remaining args
      if (command.args.length > 0 && (endsWithSpace || !hasPlaceholders)) {
        processedValue += ` ${command.args.join(' ')}`
      }
    }
    else {
      // If no args but alias expects them, replace with empty string
      processedValue = processedValue.replace(/\$@|\$\d+/g, '')
    }

    // Handle multiple commands separated by ;
    const commandStrings = processedValue
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)

    if (commandStrings.length === 0) {
      return command
    }

    // Process each command in the sequence
    const processCommand = (cmdStr: string, isFirst: boolean = true) => {
      // Handle pipes in the command
      if (cmdStr.includes('|')) {
        const pipeParts = cmdStr.split('|').map(part => part.trim())

        // Process each part of the pipe
        const pipeCommands = pipeParts.map((part) => {
          const tokens = this.parser.tokenize(part)
          const cmd = {
            name: tokens[0] || '',
            args: tokens.slice(1),
          }

          return cmd
        })

        // Return the first command with the rest as pipe commands
        return {
          ...pipeCommands[0],
          pipe: true,
          pipeCommands: pipeCommands.slice(1),
        }
      }

      // No pipes, just a simple command
      const tokens = this.parser.tokenize(cmdStr)
      if (tokens.length === 0) {
        return null
      }

      // For the first command, include the original command's context only for metadata
      const baseCommand = isFirst ? { ...command } : {}

      // Use only the tokens derived from processedValue; original args were appended above if needed
      let finalArgs = tokens.slice(1)

      // Post-process quoted numeric placeholders to re-insert literal quotes
      // Example: __krusty_QARG_1__ -> "<arg1>"
      finalArgs = finalArgs.map((arg) => {
        const m = arg.match(/^__krusty_QARG_(\d+)__$/)
        if (m) {
          const idx = Number.parseInt(m[1], 10) - 1
          const val = command.args[idx] !== undefined ? command.args[idx] : ''
          // Only inject literal quotes if the argument requires quoting
          const needsQuoting = /[^\w./:=\-]/.test(val) || /\s/.test(val)
          return needsQuoting ? `"${val}"` : val
        }
        return arg
      })

      return {
        ...baseCommand,
        name: tokens[0],
        args: finalArgs.filter(arg => arg !== ''),
      }
    }

    // Process all commands in the sequence
    const processedCommands = []
    for (let i = 0; i < commandStrings.length; i++) {
      const cmd = processCommand(commandStrings[i], i === 0)
      if (cmd) {
        processedCommands.push(cmd)
      }
    }

    if (processedCommands.length === 0) {
      return command
    }

    // If there's only one command, return it directly
    if (processedCommands.length === 1) {
      return processedCommands[0]
    }

    // For multiple commands, chain them together with ;
    const result = { ...processedCommands[0] }
    let current = result

    for (let i = 1; i < processedCommands.length; i++) {
      current.next = {
        type: ';',
        command: processedCommands[i],
      }
      current = current.next.command
    }

    return result
  }

  private async executeExternalCommand(command: any): Promise<CommandResult> {
    const start = performance.now()

    // Create a clean environment object without undefined values
    const cleanEnv = Object.fromEntries(
      Object.entries({
        ...this.environment,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
        BUN_FORCE_COLOR: '3', // Specifically for bun commands
      }).filter(([_, value]) => value !== undefined) as [string, string][],
    )

    const child = spawn(command.name, command.args, {
      cwd: this.cwd,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Stream output and await completion
    return this.setupStreamingProcess(child, start, command)
  }

  // Read a single line with completion, returns null on EOF (Ctrl+D)
  private async readLine(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      const rl = this.rl
      if (!rl) return resolve(null)

      rl.question(prompt, (answer) => {
        const trimmed = answer.trim()
        if (trimmed) {
          this.historyManager.add(trimmed).catch(console.error)
          this.history = this.historyManager.getHistory()
        }
        resolve(trimmed || null)
      })
    })
  }

  // Execute a command providing stdin input (used for pipes)
  private async executeWithInput(command: any, input: string): Promise<CommandResult> {
    const start = performance.now()

    // Clean env
    const cleanEnv = Object.fromEntries(
      Object.entries({
        ...this.environment,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
        BUN_FORCE_COLOR: '3',
      }).filter(([_, value]) => value !== undefined) as [string, string][],
    )

    const child = spawn(command.name, command.args, {
      cwd: this.cwd,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Pass input to child's stdin and stream
    return this.setupStreamingProcess(child, start, command, input)
  }

  // ... (rest of the code remains the same)

  /* Removed malformed duplicate setupStreamingProcess and stray methods here */

  /**
   * Helper method to set up streaming for a child process
   * This ensures consistent handling of output streams across all command executions
   */
  private async setupStreamingProcess(
    child: ChildProcess,
    start: number,
    command: any,
    input?: string,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      // Stream output in real-time by default, unless explicitly disabled or running in background
      const shouldStream = !command.background && this.config.streamOutput !== false

      // Handle stdout
      child.stdout?.on('data', (data) => {
        const dataStr = data.toString()
        stdout += dataStr

        // Stream output to console in real-time
        if (shouldStream) {
          process.stdout.write(dataStr)
        }
      })

      // Handle stderr
      child.stderr?.on('data', (data) => {
        const dataStr = data.toString()
        stderr += dataStr

        // Stream error output in real-time
        if (shouldStream) {
          process.stderr.write(dataStr)
        }
      })

      // Handle errors
      child.on('error', (_error) => {
        this.lastExitCode = 127
        resolve({
          exitCode: this.lastExitCode,
          stdout: '',
          stderr: `krusty: ${command.name}: command not found\n`,
          duration: performance.now() - start,
        })
      })

      // Handle process completion
      child.on('close', (code, signal) => {
        // Update the shell's last exit code
        let exitCode = code || 0

        // Handle signals (like SIGTERM, SIGKILL)
        if (signal) {
          exitCode = signal === 'SIGTERM' ? 143 : 130
        }

        this.lastExitCode = exitCode

        resolve({
          exitCode: this.lastExitCode,
          stdout,
          stderr,
          duration: performance.now() - start,
        })
      })

      // Handle input if provided
      if (input && child.stdin) {
        try {
          child.stdin?.setDefaultEncoding('utf-8')
          child.stdin?.write(input)
          child.stdin?.end()
        }
        catch (err) {
          this.log.error('Error writing to stdin:', err)
        }
      }

      // Handle background processes
      if (command.background) {
        this.log.info(`[${child.pid}] ${command.raw}`)
        // For background processes, we don't wait for completion
        this.lastExitCode = 0
        resolve({
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        })
      }
    })
  }
}
