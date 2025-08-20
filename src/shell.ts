import type { ChildProcess } from 'node:child_process'
import type * as readline from 'node:readline'
import type { Job } from './jobs/job-manager'
import type { BuiltinCommand, CommandResult, KrustyConfig, ParsedCommand, Plugin, Shell, ThemeConfig } from './types'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { createBuiltins } from './builtins'
import { CompletionProvider } from './completion'
import { defaultConfig, loadKrustyConfig } from './config'
import { HistoryManager, sharedHistory } from './history'
import { HookManager } from './hooks'
import { AutoSuggestInput } from './input/auto-suggest'
import { JobManager } from './jobs/job-manager'
import { Logger } from './logger'
import { CommandParser } from './parser'
import { PluginManager } from './plugins/plugin-manager'
import { GitInfoProvider, PromptRenderer, SystemInfoProvider } from './prompt'
import { ScriptManager } from './scripting/script-manager'
import { ThemeManager } from './theme/theme-manager'

export class KrustyShell implements Shell {
  public config: KrustyConfig
  public cwd: string
  public environment: Record<string, string>
  public historyManager: HistoryManager
  public aliases: Record<string, string>
  public builtins: Map<string, BuiltinCommand>
  public history: string[] = []
  public jobManager: JobManager
  public jobs: Job[] = [] // Compatibility property for Shell interface
  private lastExitCode: number = 0

  private parser: CommandParser
  private promptRenderer: PromptRenderer
  private systemInfoProvider: SystemInfoProvider
  private gitInfoProvider: GitInfoProvider
  private completionProvider: CompletionProvider
  private pluginManager: PluginManager
  private themeManager: ThemeManager
  private hookManager: HookManager
  public log: Logger
  private autoSuggestInput: AutoSuggestInput
  private scriptManager: ScriptManager

  // Getter for testing access
  get testHookManager(): HookManager {
    return this.hookManager
  }

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

    // Override with config environment if provided
    if (this.config.environment) {
      Object.assign(this.environment, this.config.environment)
    }
    this.history = []
    // Honor configured history settings
    this.historyManager = new HistoryManager(this.config.history)
    // Initialize aliases from config (tests expect constructor to honor provided aliases)
    this.aliases = { ...(this.config.aliases || {}) }
    this.builtins = createBuiltins()

    // Initialize history manager
    this.historyManager.initialize().catch(console.error)

    this.parser = new CommandParser()
    this.themeManager = new ThemeManager(this.config.theme)
    this.promptRenderer = new PromptRenderer(this.config)
    this.systemInfoProvider = new SystemInfoProvider()
    this.gitInfoProvider = new GitInfoProvider()
    this.completionProvider = new CompletionProvider(this)
    this.pluginManager = new PluginManager(this, this.config)
    this.hookManager = new HookManager(this, this.config)
    this.log = new Logger(this.config.verbose, 'shell')
    this.autoSuggestInput = new AutoSuggestInput(this)
    // Let AutoSuggestInput know that the shell manages the prompt. This ensures
    // input updates do not clear/overwrite the prompt and fixes cases where the
    // prompt might not be visible due to display updates.
    this.autoSuggestInput.setShellMode(true)
    this.jobManager = new JobManager(this)
    this.scriptManager = new ScriptManager(this)

    // Load history
    this.loadHistory()
  }

  private loadHistory(): void {
    try {
      this.history = this.historyManager.getHistory()
    }
    catch (error) {
      if (this.config.verbose) {
        this.log.warn('Failed to load history:', error)
      }
    }
  }

  private saveHistory(): void {
    try {
      this.historyManager.save()
    }
    catch (error) {
      if (this.config.verbose) {
        this.log.warn('Failed to save history:', error)
      }
    }
  }

  // Job management methods - delegated to JobManager
  addJob(command: string, childProcess?: ChildProcess, background = false): number {
    return this.jobManager.addJob(command, childProcess, background)
  }

  removeJob(jobId: number, force = false): boolean {
    return this.jobManager.removeJob(jobId, force)
  }

  getJob(id: number): Job | undefined {
    return this.jobManager.getJob(id)
  }

  getJobs(): Job[] {
    this.jobs = this.jobManager.getJobs() // Keep compatibility property in sync
    return this.jobs
  }

  setJobStatus(id: number, status: 'running' | 'stopped' | 'done'): boolean {
    const job = this.jobManager.getJob(id)
    if (job) {
      job.status = status
      return true
    }
    return false
  }

  // Additional job control methods
  suspendJob(jobId: number): boolean {
    return this.jobManager.suspendJob(jobId)
  }

  resumeJobBackground(jobId: number): boolean {
    return this.jobManager.resumeJobBackground(jobId)
  }

  resumeJobForeground(jobId: number): boolean {
    return this.jobManager.resumeJobForeground(jobId)
  }

  terminateJob(jobId: number, signal = 'SIGTERM'): boolean {
    return this.jobManager.terminateJob(jobId, signal)
  }

  waitForJob(jobId: number): Promise<Job | null> {
    return this.jobManager.waitForJob(jobId)
  }

  // Public proxies for plugin operations (for tests and external callers)
  async loadPlugins(): Promise<void> {
    await this.pluginManager.loadPlugins()
  }

  getPlugin(name: string): Plugin | undefined {
    return this.pluginManager.getPlugin(name)
  }

  // Public proxies for theme operations
  getThemeManager(): ThemeManager {
    return this.themeManager
  }

  setTheme(themeConfig: ThemeConfig): void {
    this.themeManager = new ThemeManager(themeConfig)
    this.config.theme = themeConfig
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

  async execute(command: string, options?: { bypassAliases?: boolean, bypassFunctions?: boolean, bypassScriptDetection?: boolean }): Promise<CommandResult> {
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

      // Detect and execute scripts (if/for/while/case/functions) via ScriptManager
      if (!options?.bypassScriptDetection && this.scriptManager.isScript(command)) {
        const scriptResult = await this.scriptManager.executeScript(command)
        this.lastExitCode = scriptResult.exitCode
        // Execute command:after hooks for script execution as well
        await this.hookManager.executeHooks('command:after', { command, result: scriptResult })
        return scriptResult
      }

      // Parse the command
      const parsed = await this.parseCommand(command)

      if (parsed.commands.length === 0) {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        }
      }

      // Execute command chain
      const result = await this.executeCommandChain(parsed, options)
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

  async parseCommand(input: string): Promise<ParsedCommand> {
    return await this.parser.parse(input, this)
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

      // Change directory and maintain PWD/OLDPWD
      const prev = this.cwd
      process.chdir(targetPath)
      this.cwd = targetPath
      try {
        // Track previous directory for `cd -`
        ;(this as any)._prevDir = prev
        // Update env vars similar to POSIX shells
        this.environment.OLDPWD = prev
        this.environment.PWD = this.cwd
        process.env.OLDPWD = prev
        process.env.PWD = this.cwd
      }
      catch {}
      return true
    }
    catch {
      return false
    }
  }

  async start(interactive: boolean = true): Promise<void> {
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

    // Skip interactive mode for tests or when explicitly disabled
    if (!interactive || process.env.NODE_ENV === 'test') {
      return
    }

    try {
      // Don't setup readline interface - AutoSuggestInput handles all input
      // this.rl = readline.createInterface({
      //   input: process.stdin,
      //   output: process.stdout,
      // })

      // The JobManager handles signal processing, so we don't need to set up handlers here
      // The JobManager will handle Ctrl+C (SIGINT) and Ctrl+Z (SIGTSTP) appropriately

      // Main REPL loop
      while (this.running) {
        try {
          const prompt = await this.renderPrompt()
          process.stdout.write(prompt) // Write prompt before readLine
          const input = await this.readLine(prompt)

          if (input === null) {
            // EOF (Ctrl+D)
            break
          }

          if (input.trim()) {
            const result = await this.execute(input)

            // Print buffered output only if it wasn't already streamed live
            if (!result.streamed) {
              if (result.stdout) {
                process.stdout.write(result.stdout)
              }
              if (result.stderr) {
                process.stderr.write(result.stderr)
              }
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

    // Shutdown job manager
    try {
      this.jobManager.shutdown()
    }
    catch (error) {
      this.log.error('Error shutting down job manager:', error)
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

    // Keep shared history in sync so components using the singleton see latest entries
    try {
      sharedHistory.add(command)
    }
    catch {}

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

      // Get completions from the completion provider (keeping existing logic for now)
      let completions: string[] = []

      try {
        completions = this.completionProvider.getCompletions(input, cursor)
      }
      catch (error) {
        this.log.error('Error in completion provider:', error)
      }

      // Add plugin completions if available
      if (this.pluginManager?.getPluginCompletions) {
        try {
          const pluginCompletions = this.pluginManager.getPluginCompletions(input, cursor) || []
          completions = [...new Set([...completions, ...pluginCompletions])] // Remove duplicates
        }
        catch (error) {
          this.log.error('Error getting plugin completions:', error)
        }
      }

      // Filter out empty strings and sort alphabetically (case-insensitive)
      const allSorted = completions
        .filter(c => c && c.trim().length > 0)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

      // Enforce max suggestions limit
      const max = this.config.completion?.maxSuggestions ?? 10
      completions = allSorted.length > max ? allSorted.slice(0, max) : allSorted

      // If this appears to be a first-token completion, ensure at least one matching builtin is present
      const before = input.slice(0, Math.max(0, cursor))
      if (before.trim().length > 0 && !before.includes(' ')) {
        const prefix = before.trim()
        const caseSensitive = this.config.completion?.caseSensitive ?? false
        const startsWith = (s: string) => caseSensitive
          ? s.startsWith(prefix)
          : s.toLowerCase().startsWith(prefix.toLowerCase())

        // Check if we have at least one builtin that matches
        const hasMatchingBuiltin = Array.from(this.builtins.keys()).some(startsWith)
        if (!hasMatchingBuiltin) {
          // Add the first matching builtin if none exist
          const firstBuiltin = Array.from(this.builtins.keys()).find(startsWith)
          if (firstBuiltin && !allSorted.includes(firstBuiltin)) {
            completions = [firstBuiltin, ...allSorted].slice(0, max)
          }
        }
      }

      // Execute completion:after hooks
      this.hookManager.executeHooks('completion:after', { input, cursor, completions })
        .catch(err => this.log.error('completion:after hook error:', err))

      return completions
    }
    catch (error) {
      this.log.error('Error in getCompletions:', error)
      return []
    }
  }

  private async executeCommandChain(parsed: ParsedCommand, options?: { bypassAliases?: boolean, bypassFunctions?: boolean }): Promise<CommandResult> {
    if (parsed.commands.length === 1) {
      return this.executeSingleCommand(parsed.commands[0], parsed.redirections, options)
    }

    // Handle piped commands with redirections
    return this.executePipedCommands(parsed.commands, parsed.redirections, options)
  }

  private async executeSingleCommand(command: any, redirections?: any[], options?: { bypassAliases?: boolean, bypassFunctions?: boolean }): Promise<CommandResult> {
    if (!command?.name) {
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 0,
      }
    }

    // Prefer builtins over aliases to ensure builtin behavior is not shadowed by alias names
    if (!options?.bypassFunctions && this.builtins.has(command.name)) {
      const builtin = this.builtins.get(command.name)!

      // Handle background processes for builtins
      if (command.background) {
        // For background builtins, execute asynchronously and add to jobs
        const jobId = this.addJob(command.raw)

        // Execute builtin in background (don't await)
        builtin.execute(command.args, this).then(async (result) => {
          // Apply redirections if needed
          if (redirections && redirections.length > 0) {
            await this.applyRedirectionsToBuiltinResult(result, redirections)
          }
          // Mark job as done
          this.setJobStatus(jobId, 'done')
        }).catch(() => {
          this.setJobStatus(jobId, 'done')
        })

        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: 0,
        }
      }

      // Process arguments to remove quotes for builtin commands (except alias which handles quotes itself)
      const processedArgs = command.name === 'alias'
        ? command.args
        : command.args.map((arg: string) => this.processAliasArgument(arg))
      const result = await builtin.execute(processedArgs, this)

      // Apply redirections to builtin output if needed
      if (redirections && redirections.length > 0) {
        await this.applyRedirectionsToBuiltinResult(result, redirections)
        return { ...result, stdout: '' } // Clear stdout since it was redirected
      }

      return result
    }

    // Expand aliases with cycle detection
    const expandedCommand = options?.bypassAliases ? command : this.expandAliasWithCycleDetection(command)

    // If the expanded command represents a pipeline constructed by alias expansion
    if ((expandedCommand as any).pipe && Array.isArray((expandedCommand as any).pipeCommands)) {
      // Preserve stdinFile (applies to the first command) and any other fields we might need
      const commands = [
        { name: expandedCommand.name, args: expandedCommand.args, stdinFile: (expandedCommand as any).stdinFile },
        ...((expandedCommand as any).pipeCommands as any[]).map(c => ({ name: c.name, args: c.args })),
      ]
      // These are already expanded; avoid re-expanding aliases
      const execOptions = { ...(options || {}), bypassAliases: true }
      return this.executePipedCommands(commands, undefined, execOptions)
    }

    // If the expanded command is a chain of sequential/conditional commands from alias expansion
    if ((expandedCommand as any).next) {
      let current: any = expandedCommand
      let aggregate: CommandResult | null = null
      let lastExit = 0

      while (current) {
        // Execute only the current node (preserve stdinFile, pipes, etc.) without its chain link
        const nodeToRun: any = { ...current }
        if (nodeToRun.next)
          delete nodeToRun.next
        const res = await this.executeSingleCommand(nodeToRun, undefined, { ...(options || {}), bypassAliases: true })
        lastExit = res.exitCode
        if (!aggregate) {
          aggregate = { ...res }
        }
        else {
          aggregate = {
            exitCode: res.exitCode,
            stdout: (aggregate.stdout || '') + (res.stdout || ''),
            stderr: (aggregate.stderr || '') + (res.stderr || ''),
            duration: (aggregate.duration || 0) + (res.duration || 0),
            streamed: (aggregate.streamed === true) || (res.streamed === true),
          }
        }

        // Respect conditional chaining operators: && and ||
        const link = current.next as any | undefined
        if (!link) {
          current = undefined
          continue
        }
        const op = link.type || ';'
        if (op === '&&' && lastExit !== 0) {
          // stop executing the rest of the chain on failure
          break
        }
        if (op === '||' && lastExit === 0) {
          // stop executing the rest of the chain on success
          break
        }
        current = link.command
      }

      return aggregate || { exitCode: 0, stdout: '', stderr: '', duration: 0 }
    }

    // Check if it's a builtin command
    if (!options?.bypassFunctions && this.builtins.has(expandedCommand.name)) {
      const builtin = this.builtins.get(expandedCommand.name)!
      // Process arguments for builtins: normally strip quotes, except when alias-expansion explicitly
      // preserved quotes (e.g., "$1" placeholders) in which case we pass them through as literals.
      const processedArgs = (expandedCommand as any).preserveQuotedArgs || expandedCommand.name === 'alias'
        ? expandedCommand.args
        : expandedCommand.args.map((arg: string) => this.processAliasArgument(arg))
      const result = await builtin.execute(processedArgs, this)

      // Apply redirections to builtin output if needed
      if (redirections && redirections.length > 0) {
        await this.applyRedirectionsToBuiltinResult(result, redirections)
        return { ...result, stdout: '' } // Clear stdout since it was redirected
      }

      return result
    }

    // Check if it's a plugin command
    if (!options?.bypassFunctions) {
      for (const [_, plugin] of this.pluginManager.getAllPlugins()) {
        if (plugin.commands && plugin.commands[expandedCommand.name]) {
          const pluginCommand = plugin.commands[expandedCommand.name]
          const context = this.pluginManager.getPluginContext(plugin.name)
          if (context) {
            return pluginCommand.execute(expandedCommand.args, context)
          }
        }
      }
    }

    // Execute external command
    return this.executeExternalCommand(expandedCommand, redirections)
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

  private async executePipedCommands(commands: any[], redirections?: any[], options?: { bypassAliases?: boolean, bypassFunctions?: boolean }): Promise<CommandResult> {
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
        lastResult = await this.executeSingleCommand(command, redirections, options)
      }
      else {
        // Pipe previous output to current command
        const result = await this.executeWithInput(command, lastResult.stdout)
        lastResult = {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: lastResult.stderr + result.stderr,
          duration: (lastResult.duration || 0) + (result.duration || 0),
          streamed: (lastResult.streamed === true) || (result.streamed === true),
        }
      }

      if (lastResult.exitCode !== 0 && !isLast) {
        break // Stop on error unless it's the last command
      }
    }

    return lastResult
  }

  /**
   * Processes an argument from alias expansion by removing quotes
   * @param arg The argument to process
   * @returns The processed argument
   */
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
    // Simple command substitution for current working directory
    // Replace `pwd` and $(pwd) occurrences with this.cwd while preserving surrounding quotes
    processedValue = processedValue
      .replace(/`pwd`/g, this.cwd)
      .replace(/\$\(pwd\)/g, this.cwd)
    // Handle quoted numeric placeholders like "$1" so that quotes are preserved in output.
    // We replace them with internal markers before general substitution and remove the quotes,
    // then after tokenization we turn the markers back into literal quoted arguments.
    const QUOTED_MARKER_PREFIX = '__krusty_QARG_'
    processedValue = processedValue.replace(/"\$(\d+)"/g, (_m, num) => `${QUOTED_MARKER_PREFIX}${num}__`)
    // Track whether the alias used any quoted placeholders so builtins can preserve quotes
    const hadQuotedPlaceholders = /"\$\d+"/.test(aliasValue)
    const argsToUse = (command as any).originalArgs || command.args
    const dequote = (s: string) => this.processAliasArgument(s)
    const hasArgs = argsToUse.length > 0
    const endsWithSpace = aliasValue.endsWith(' ')
    const hasPlaceholders = /\$@|\$\d+/.test(aliasValue)

    // Handle environment variables first (only replace valid variable names that exist)
    // Only match variables that start with uppercase letter or underscore
    processedValue = processedValue.replace(/\$([A-Z_][A-Z0-9_]*)(?=\W|$)/g, (match, varName) => {
      return this.environment[varName] !== undefined ? this.environment[varName] : match
    })

    // Apply brace expansion to the alias value
    if (processedValue.includes('{') && processedValue.includes('}')) {
      // Simple brace expansion for aliases
      const braceRegex = /([^{}\s]*)\{([^{}]+)\}([^{}\s]*)/g
      processedValue = processedValue.replace(braceRegex, (match, prefix, content, suffix) => {
        if (content.includes(',')) {
          const items = content.split(',').map((item: string) => item.trim())
          return items.map((item: string) => `${prefix}${item}${suffix}`).join(' ')
        }
        if (content.includes('..')) {
          const [start, end] = content.split('..', 2)
          const startNum = Number.parseInt(start.trim(), 10)
          const endNum = Number.parseInt(end.trim(), 10)
          if (!Number.isNaN(startNum) && !Number.isNaN(endNum)) {
            const range = []
            if (startNum <= endNum) {
              for (let i = startNum; i <= endNum; i++) range.push(i)
            }
            else {
              for (let i = startNum; i >= endNum; i--) range.push(i)
            }
            return range.map(num => `${prefix}${num}${suffix}`).join(' ')
          }
        }
        return match
      })
    }

    // Handle argument substitution using original arguments for alias expansion
    if (hasArgs) {
      // Replace $@ with all arguments, preserving original quoting
      if (processedValue.includes('$@')) {
        processedValue = processedValue.replace(/\$@/g, argsToUse.join(' '))
      }

      // Replace $1, $2, etc. with specific arguments (no auto-quoting here;
      // quoting can be enforced by writing "$1" in the alias which we preserve via markers)
      processedValue = processedValue.replace(/\$(\d+)/g, (_, num) => {
        const index = Number.parseInt(num, 10) - 1
        if (argsToUse[index] === undefined)
          return ''
        return dequote(argsToUse[index])
      })

      // If alias ends with space OR it doesn't contain placeholders, append remaining args
      if (command.args.length > 0 && (endsWithSpace || !hasPlaceholders)) {
        const quoted = command.args.map((arg: string) => (/\s/.test(arg) ? `"${arg}"` : arg))
        processedValue += ` ${quoted.join(' ')}`
      }
    }
    else {
      // If no args but alias expects them, replace with empty string
      processedValue = processedValue.replace(/\$@|\$\d+/g, '')
    }

    // Handle multiple commands separated by ;, &&, || (quote-aware)
    const segments: Array<{ cmd: string, op?: ';' | '&&' | '||' }> = []
    {
      let buf = ''
      let inQuotes = false
      let q = ''
      let i = 0
      const pushSeg = (op?: ';' | '&&' | '||') => {
        const t = buf.trim()
        if (t)
          segments.push({ cmd: t, op })
        buf = ''
      }
      while (i < processedValue.length) {
        const ch = processedValue[i]
        const next = processedValue[i + 1]
        if (!inQuotes && (ch === '"' || ch === '\'')) {
          inQuotes = true
          q = ch
          buf += ch
          i++
          continue
        }
        if (inQuotes && ch === q) {
          inQuotes = false
          q = ''
          buf += ch
          i++
          continue
        }
        if (!inQuotes) {
          if (ch === ';') {
            pushSeg(';')
            i++
            continue
          }
          // Treat newlines in alias values as command separators
          if (ch === '\n') {
            pushSeg(';')
            i++
            continue
          }
          if (ch === '&' && next === '&') {
            pushSeg('&&')
            i += 2
            continue
          }
          if (ch === '|' && next === '|') {
            pushSeg('||')
            i += 2
            continue
          }
        }
        buf += ch
        i++
      }
      pushSeg()
    }

    if (segments.length === 0) {
      return command
    }

    // Process each command in the sequence
    const processCommand = (cmdStr: string, isFirst: boolean = true) => {
      // Extract simple stdin redirection: < file (only when not quoted)
      let stdinFile: string | undefined
      {
        let inQuotes = false
        let q = ''
        for (let i = 0; i < cmdStr.length; i++) {
          const ch = cmdStr[i]
          if (!inQuotes && (ch === '"' || ch === '\'')) {
            inQuotes = true
            q = ch
            continue
          }
          if (inQuotes && ch === q) {
            inQuotes = false
            q = ''
            continue
          }
          if (!inQuotes && ch === '<') {
            // consume '<' and any whitespace
            let j = i + 1
            while (j < cmdStr.length && /\s/.test(cmdStr[j])) j++
            // capture the filename token (supports quoted filename)
            let k = j
            let filename = ''
            if (cmdStr[k] === '"' || cmdStr[k] === '\'') {
              const quote = cmdStr[k]
              k++
              const start = k
              while (k < cmdStr.length && cmdStr[k] !== quote) k++
              filename = cmdStr.slice(start, k)
              k++ // skip closing quote
            }
            else {
              while (k < cmdStr.length && !/[\s|;&]/.test(cmdStr[k])) k++
              filename = cmdStr.slice(j, k)
            }
            if (filename) {
              stdinFile = filename
              // remove the segment from the command string
              cmdStr = `${cmdStr.slice(0, i)} ${cmdStr.slice(k)}`.trim()
            }
            break
          }
        }
      }
      // Handle pipes in the command (quote-aware)
      {
        let inQuotes = false
        let q = ''
        const parts: string[] = []
        let buf = ''
        for (let i = 0; i < cmdStr.length; i++) {
          const ch = cmdStr[i]
          if (!inQuotes && (ch === '"' || ch === '\'')) {
            inQuotes = true
            q = ch
            buf += ch
            continue
          }
          if (inQuotes && ch === q) {
            inQuotes = false
            q = ''
            buf += ch
            continue
          }
          if (!inQuotes && ch === '|') {
            parts.push(buf.trim())
            buf = ''
            continue
          }
          buf += ch
        }
        if (buf.trim())
          parts.push(buf.trim())

        if (parts.length > 1) {
          // Process each part of the pipe
          const pipeCommands = parts.map((part) => {
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
            stdinFile,
            pipe: true,
            pipeCommands: pipeCommands.slice(1),
          }
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

      // Post-process quoted numeric placeholders to re-insert literal quotes when needed
      // Example: __krusty_QARG_1__ -> "<arg1>" if it contains spaces, else <arg1>
      finalArgs = finalArgs.map((arg) => {
        const m = arg.match(/^__krusty_QARG_(\d+)__$/)
        if (m) {
          const idx = Number.parseInt(m[1], 10) - 1
          const val = argsToUse[idx] !== undefined ? dequote(argsToUse[idx]) : ''
          // Only inject literal quotes if the value contains whitespace
          return /\s/.test(val) ? `"${val}"` : val
        }
        return arg
      })

      return {
        ...baseCommand,
        name: tokens[0],
        args: finalArgs.filter(arg => arg !== ''),
        stdinFile,
        // Indicate that this command originated from alias expansion and may contain
        // intentionally quoted args (e.g., from "$1" placeholders) that should be preserved for builtins.
        preserveQuotedArgs: hadQuotedPlaceholders,
      }
    }

    // Process all commands in the sequence
    const processedCommands: any[] = []
    for (let i = 0; i < segments.length; i++) {
      const cmd = processCommand(segments[i].cmd, i === 0)
      if (cmd)
        processedCommands.push({ node: cmd, op: segments[i].op })
    }

    if (processedCommands.length === 0) {
      return command
    }

    // If there's only one command, return it directly
    if (processedCommands.length === 1) {
      return processedCommands[0].node
    }

    // For multiple commands, chain them together with ;
    const result = { ...processedCommands[0].node }
    let current: any = result
    for (let i = 1; i < processedCommands.length; i++) {
      current.next = {
        type: (processedCommands[i - 1].op || ';'),
        command: processedCommands[i].node,
      }
      current = current.next.command
    }

    return result
  }

  private async executeExternalCommand(command: any, redirections?: any[]): Promise<CommandResult> {
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

    // Configure stdio based on redirections
    const stdio: any = ['pipe', 'pipe', 'pipe']
    let outputFile: string | undefined
    let inputFile: string | undefined

    if (redirections && redirections.length > 0) {
      for (const redirection of redirections) {
        if (redirection.type === 'file') {
          if (redirection.direction === 'output') {
            outputFile = redirection.target.startsWith('/') ? redirection.target : `${this.cwd}/${redirection.target}`
          }
          else if (redirection.direction === 'input') {
            inputFile = redirection.target.startsWith('/') ? redirection.target : `${this.cwd}/${redirection.target}`
          }
        }
      }
    }

    // For external commands, remove surrounding quotes and unescape so spawn receives clean args
    const externalArgs = (command.args || []).map((arg: string) => this.processAliasArgument(arg))
    const child = spawn(command.name, externalArgs, {
      cwd: this.cwd,
      env: cleanEnv,
      stdio,
    })

    // Handle file redirections manually
    if (outputFile) {
      const { createWriteStream } = await import('node:fs')
      const outStream = createWriteStream(outputFile)
      child.stdout?.pipe(outStream)
      // Use streaming process but skip stdout capture since it's redirected
      return this.setupStreamingProcess(child, start, command, undefined, true)
    }

    if (inputFile) {
      const { createReadStream, existsSync } = await import('node:fs')
      if (existsSync(inputFile)) {
        const inStream = createReadStream(inputFile)
        inStream.pipe(child.stdin!)
      }
    }

    // Add job to JobManager and stream output
    const jobId = this.addJob(command.raw || `${command.name} ${command.args.join(' ')}`, child, command.background)
    return this.setupStreamingProcess(child, start, command, undefined, false, jobId)
  }

  /**
   * Apply redirections to builtin command results
   */
  private async applyRedirectionsToBuiltinResult(result: CommandResult, redirections: any[]): Promise<void> {
    for (const redirection of redirections) {
      if (redirection.type === 'file') {
        const outputFile = redirection.target.startsWith('/') ? redirection.target : `${this.cwd}/${redirection.target}`

        if (redirection.direction === 'output') {
          const { writeFileSync } = await import('node:fs')
          writeFileSync(outputFile, result.stdout)
        }
        else if (redirection.direction === 'append') {
          const { appendFileSync } = await import('node:fs')
          appendFileSync(outputFile, result.stdout)
        }
        else if (redirection.direction === 'error') {
          const { writeFileSync } = await import('node:fs')
          writeFileSync(outputFile, result.stderr)
        }
        else if (redirection.direction === 'error-append') {
          const { appendFileSync } = await import('node:fs')
          appendFileSync(outputFile, result.stderr)
        }
      }
    }
  }

  // Read a single line with auto-suggestions, returns null on EOF (Ctrl+D)
  private async readLine(prompt: string): Promise<string | null> {
    // Use auto-suggest input for better user experience
    const result = await this.autoSuggestInput.readLine(prompt)

    // Add to history if not empty
    if (result && result.trim()) {
      this.historyManager.add(result.trim()).catch(console.error)
      this.history = this.historyManager.getHistory()
    }

    return result
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

    // Clean up args for external command in a pipeline as well
    const extArgs = (command.args || []).map((arg: string) => this.processAliasArgument(arg))
    const child = spawn(command.name, extArgs, {
      cwd: this.cwd,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Add job to JobManager and pass input to child's stdin and stream
    const jobId = this.addJob(command.raw || `${command.name} ${command.args.join(' ')}`, child, false)
    return this.setupStreamingProcess(child, start, command, input, false, jobId)
  }

  /**
   * Helper method to set up streaming for a child process
   * This ensures consistent handling of output streams across all command executions
   */
  private async setupStreamingProcess(
    child: ChildProcess,
    start: number,
    command: any,
    input?: string,
    skipStdoutCapture = false,
    jobId?: number,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      // Stream output in real-time by default, unless explicitly disabled or running in background
      const shouldStream = !command.background && this.config.streamOutput !== false

      // Handle stdout (skip if redirected to file)
      if (!skipStdoutCapture) {
        child.stdout?.on('data', (data) => {
          const dataStr = data.toString()
          stdout += dataStr

          // Stream output to console in real-time
          if (shouldStream) {
            process.stdout.write(dataStr)
          }
        })
      }

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
          streamed: false,
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
          // If we streamed during execution, signal that callers shouldn't re-print
          streamed: shouldStream,
        })
      })

      // Handle input if provided
      if (child.stdin) {
        if (input) {
          try {
            child.stdin.setDefaultEncoding('utf-8')
            child.stdin.write(input)
            child.stdin.end()
          }
          catch (err) {
            this.log.error('Error writing to stdin:', err)
          }
        }
        else if (command.stdinFile) {
          try {
            const rs = createReadStream(command.stdinFile, { encoding: 'utf-8' })
            rs.on('error', (err) => {
              // Surface error to stderr stream and close stdin
              stderr += `${String(err)}\n`
              try {
                child.stdin?.end()
              }
              catch {}
            })
            rs.pipe(child.stdin)
          }
          catch (err) {
            try {
              this.log.error('Error opening stdin file:', err)
            }
            catch (logError) {
              console.error(logError)
            }
            try {
              child.stdin.end()
            }
            catch (endError) {
              console.error(endError)
            }
          }
        }
      }

      // Handle background processes
      if (command.background) {
        this.log.info(`[${jobId}] ${child.pid} ${command.raw || `${command.name} ${command.args.join(' ')}`}`)
        // For background processes, we don't wait for completion
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
