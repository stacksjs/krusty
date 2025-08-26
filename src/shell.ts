import type { ChildProcess } from 'node:child_process'
import type * as readline from 'node:readline'
import type { Job } from './jobs/job-manager'
import type { BuiltinCommand, CommandResult, KrustyConfig, ParsedCommand, Plugin, Shell, ThemeConfig } from './types'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { PassThrough, Readable } from 'node:stream'
import { createBuiltins } from './builtins'
import { CompletionProvider } from './completion'
import { defaultConfig, diffKrustyConfigs, loadKrustyConfig, validateKrustyConfig } from './config'
import { HistoryManager, sharedHistory } from './history'
import { HookManager } from './hooks'
import { AutoSuggestInput } from './input/auto-suggest'
import { JobManager } from './jobs/job-manager'
import { Logger } from './logger'
import { CommandParser, ParseError } from './parser'
import { PluginManager } from './plugins/plugin-manager'
import { GitInfoProvider, PromptRenderer, SystemInfoProvider } from './prompt'
import { ScriptManager } from './scripting/script-manager'
import { ThemeManager } from './theme/theme-manager'
import { ExpansionUtils } from './utils/expansion'
import { RedirectionHandler } from './utils/redirection'

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
  // POSIX-like shell options
  public nounset: boolean = false
  public xtrace: boolean = false
  public pipefail: boolean = false
  // Last xtrace line printed (for testing/support tooling)
  public lastXtraceLine: string | undefined
  private lastExitCode: number = 0
  private lastCommandDurationMs: number = 0

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

  // Heuristic to decide if a command should run attached to an interactive TTY
  // We avoid this when there are redirections or backgrounding.
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

    // Fallback: if explicitly requested via env/config in the future we can extend here
    return false
  }

  // Getter for testing access
  get testHookManager(): HookManager {
    return this.hookManager
  }

  // Split input into operator-aware segments preserving quotes/escapes.
  private splitByOperators(input: string): Array<{ segment: string, op: ';' | '&&' | '||' | null }> {
    const segments: Array<{ segment: string, op: ';' | '&&' | '||' | null }> = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    let escaped = false
    let currentOp: ';' | '&&' | '||' | null = null // operator to the left of the segment being built

    const push = () => {
      const seg = current.trim()
      if (seg.length > 0)
        segments.push({ segment: seg, op: currentOp })
      current = ''
    }

    for (let i = 0; i < input.length; i++) {
      const ch = input[i]
      const next = input[i + 1]

      if (escaped) {
        current += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        current += ch
        continue
      }
      if (!inQuotes && (ch === '"' || ch === '\'')) {
        inQuotes = true
        quoteChar = ch
        current += ch
        continue
      }
      if (inQuotes && ch === quoteChar) {
        inQuotes = false
        quoteChar = ''
        current += ch
        continue
      }

      if (!inQuotes) {
        // Detect && and ||
        if (ch === '&' && next === '&') {
          push()
          currentOp = '&&'
          i++ // skip next
          continue
        }
        if (ch === '|' && next === '|') {
          push()
          currentOp = '||'
          i++ // skip next
          continue
        }
        if (ch === ';') {
          push()
          currentOp = ';'
          continue
        }
      }

      current += ch
    }

    // push final with its left operator
    push()

    return segments
  }

  private aggregateResults(base: CommandResult | null, next: CommandResult): CommandResult {
    if (!base)
      return { ...next }
    return {
      exitCode: next.exitCode,
      stdout: (base.stdout || '') + (next.stdout || ''),
      stderr: (base.stderr || '') + (next.stderr || ''),
      duration: (base.duration || 0) + (next.duration || 0),
      streamed: (base.streamed === true) || (next.streamed === true),
    }
  }

  private rl: readline.Interface | null = null
  private running = false
  // Whether we're currently in an interactive REPL session (start(true))
  private interactiveSession = false
  // If true, a prompt was already rendered proactively and the next loop should not reprint it
  private promptPreRendered = false

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

    // Apply expansion cache limits from config (if any)
    try {
      const limits = this.config.expansion?.cacheLimits
      if (limits) {
        ExpansionUtils.setCacheLimits(limits)
      }
    }
    catch {}

    // Load history
    this.loadHistory()
  }

  /**
   * Build styled echo for package.json script runs (bun/npm/pnpm/yarn)
   * Expands nested script references recursively with cycle protection.
   */
  private async buildPackageRunEcho(command: any, includeNested: boolean = false): Promise<string | null> {
    try {
      const name = (command?.name || '').toLowerCase()
      const args: string[] = Array.isArray(command?.args) ? command.args : []

      // Detect package manager script invocation and extract script name
      let scriptName: string | null = null
      if (name === 'bun' && args[0] === 'run' && args[1]) {
        scriptName = args[1]
      }
      else if (name === 'npm' && (args[0] === 'run' || args[0] === 'run-script') && args[1]) {
        scriptName = args[1]
      }
      else if (name === 'pnpm' && args[0] === 'run' && args[1]) {
        scriptName = args[1]
      }
      else if (name === 'yarn') {
        // yarn <script> OR yarn run <script>
        if (args[0] === 'run' && args[1])
          scriptName = args[1]
        else if (args[0])
          scriptName = args[0]
      }

      if (!scriptName)
        return null

      // Read package.json scripts from current working directory
      const pkgPath = resolve(this.cwd, 'package.json')
      if (!existsSync(pkgPath))
        return null
      let scripts: Record<string, string> | undefined
      try {
        const { readFileSync } = await import('node:fs')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
        scripts = pkg.scripts || {}
      }
      catch {
        return null
      }
      if (!scripts || !scripts[scriptName])
        return null

      // Styling consistent with bb builtin
      const purple = '\x1B[38;2;199;146;234m'
      const dim = '\x1B[2m'
      const reset = '\x1B[0m'
      const styleEcho = (line: string) => `${purple}$${reset} ${dim}${line}${reset}`

      // First line: echo the invoked command as typed/raw
      const asTyped = (command?.raw && typeof command.raw === 'string')
        ? command.raw
        : [command.name, ...(command.args || [])].join(' ')

      const lines: string[] = [styleEcho(asTyped)]

      // Only include nested expansion when explicitly requested (i.e., when buffering output)
      if (includeNested) {
        const visited = new Set<string>()
        const maxDepth = 5
        const runRegex = /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?([\w:\-]+)/g
        const expand = (scr: string, depth: number) => {
          if (!scripts || !scripts[scr] || visited.has(scr) || depth > maxDepth)
            return
          visited.add(scr)
          const body = scripts[scr]
          lines.push(styleEcho(body))
          // Find nested script references
          let m: RegExpExecArray | null
          runRegex.lastIndex = 0
          // eslint-disable-next-line no-cond-assign
          while ((m = runRegex.exec(body)) !== null) {
            const nextScr = m[1]
            if (nextScr && scripts[nextScr])
              expand(nextScr, depth + 1)
          }
        }
        expand(scriptName, 1)
      }

      return `${lines.join('\n')}\n`
    }
    catch {
      return null
    }
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
      const oldConfig = this.config
      const newConfig = await loadKrustyConfig()

      // Validate before applying
      const { valid, errors, warnings } = validateKrustyConfig(newConfig)
      if (!valid) {
        // Log validation errors and abort reload
        this.log.error('Reload aborted: invalid configuration')
        for (const e of errors) {
          this.log.error(` - ${e}`)
        }
        const stderr = `${['reload: invalid configuration', ...errors.map(e => ` - ${e}`)].join('\n')}\n`
        return { exitCode: 1, stdout: '', stderr, duration: performance.now() - start }
      }

      // Log warnings if any
      if (warnings && warnings.length) {
        this.log.warn('Configuration warnings:')
        for (const w of warnings) this.log.warn(` - ${w}`)
      }

      // Compute and log a diff for visibility
      try {
        const diff = diffKrustyConfigs(oldConfig, newConfig)
        if (diff.length) {
          this.log.info('Config changes on reload:')
          for (const line of diff) this.log.info(` - ${line}`)
        }
        else {
          this.log.info('No config changes detected.')
        }
      }
      catch {}

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

      // Apply expansion cache limits and clear caches on reload
      try {
        const limits = this.config.expansion?.cacheLimits
        if (limits) {
          ExpansionUtils.setCacheLimits(limits)
        }
      }
      catch {}
      try {
        ExpansionUtils.clearCaches()
      }
      catch {}

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

      // Detect scripts (functions/control flow) unless bypassed
      if (!options?.bypassScriptDetection) {
        if (this.scriptManager.isScript(command)) {
          const scriptResult = await this.scriptManager.executeScript(command)
          return scriptResult
        }
      }
      else {
        // Even when bypassing, if the input defines a function, execute the whole input as a script
        // so that subsequent chained segments can call the function within the same script context.
        if (/\bfunction\b/.test(command) || /\b\w+\s*\(\)\s*\{/.test(command)) {
          const scriptResult = await this.scriptManager.executeScript(command, { isFile: true })
          return scriptResult
        }
      }

      // Operator-aware chaining: split into segments with ;, &&, ||
      const chain = this.parser.splitByOperatorsDetailed(command)
      if (chain.length > 1) {
        let aggregate: CommandResult | null = null
        let lastExit = 0
        for (let i = 0; i < chain.length; i++) {
          const { segment } = chain[i]
          // Conditional execution based on previous operator
          if (i > 0) {
            const prevOp = chain[i - 1].op
            if (prevOp === '&&' && lastExit !== 0)
              continue
            if (prevOp === '||' && lastExit === 0)
              continue
          }

          // If this segment is a script construct (if/for/while/functions/etc),
          // execute it via the script engine and treat its exit code for chaining.
          // This allows patterns like: "if ... fi && echo ok".
          try {
            if (this.scriptManager.isScript(segment)) {
              const segResult = await this.scriptManager.executeScript(segment)
              lastExit = segResult.exitCode
              aggregate = this.aggregateResults(aggregate, segResult)
              continue
            }
          }
          catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const stderr = `krusty: script error: ${msg}\n`
            const segResult = { exitCode: 2, stdout: '', stderr, duration: 0 }
            aggregate = this.aggregateResults(aggregate, segResult)
            lastExit = segResult.exitCode
            break
          }

          // Parse + execute this segment (supports pipes/redirections inside)
          let segParsed: ParsedCommand
          try {
            segParsed = await this.parseCommand(segment)
          }
          catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            // Build a caret indicator when feasible (unterminated quotes -> caret at end)
            const caretIdx = segment.length // best-effort: end of segment for unterminated quotes
            const caretLine = `${segment}\n${' '.repeat(Math.max(0, caretIdx))}^\n`
            const stderr = `krusty: syntax error: ${msg}\n${caretLine}`
            const segResult = { exitCode: 2, stdout: '', stderr, duration: 0 }
            // Include parse error in aggregation and stop processing further segments
            aggregate = this.aggregateResults(aggregate, segResult)
            lastExit = segResult.exitCode
            break
          }
          if (segParsed.commands.length === 0)
            continue

          const segResult = await this.executeCommandChain(segParsed, options)
          lastExit = segResult.exitCode
          aggregate = this.aggregateResults(aggregate, segResult)
        }

        const result = aggregate || { exitCode: lastExit, stdout: '', stderr: '', duration: performance.now() - start }
        this.lastExitCode = result.exitCode
        this.lastCommandDurationMs = result.duration || 0
        // Execute command:after hooks
        await this.hookManager.executeHooks('command:after', { command, result })
        return result
      }

      // Parse the command (no operator chain)
      let parsed
      try {
        parsed = await this.parseCommand(command)
      }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Prefer precise caret index from parser when available
        let caretIdx = command.length
        if (err instanceof ParseError && typeof err.index === 'number') {
          // Parser calculated index relative to trimmed input. Map to original input by offsetting
          const startIdx = command.search(/\S|$/)
          caretIdx = Math.max(0, Math.min(command.length, startIdx + err.index))
        }
        const caretLine = `${command}\n${' '.repeat(Math.max(0, caretIdx))}^\n`
        const stderr = `krusty: syntax error: ${msg}\n${caretLine}`
        const result = { exitCode: 2, stdout: '', stderr, duration: performance.now() - start }
        // Execute command:error hooks with parse context
        await this.hookManager.executeHooks('command:error', { command, error: msg, result })
        return result
      }
      if (parsed.commands.length === 0) {
        return { exitCode: 0, stdout: '', stderr: '', duration: performance.now() - start }
      }

      // Execute command chain (pipes/redirections)
      const result = await this.executeCommandChain(parsed, options)
      this.lastExitCode = result.exitCode
      this.lastCommandDurationMs = result.duration || 0

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
      this.lastExitCode = result.exitCode
      this.lastCommandDurationMs = result.duration || 0

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

    // Skip any interactive/session setup during tests or when explicitly disabled.
    // Important: return BEFORE initializing modules, hooks, or plugins to avoid
    // creating long-lived handles that keep the test runner alive.
    if (!interactive || process.env.NODE_ENV === 'test')
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
      this.interactiveSession = true
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
          // If we already rendered a prompt proactively (e.g., right after a process finished),
          // do not print it again to avoid double prompts. Still pass it to readLine.
          if (this.promptPreRendered) {
            this.promptPreRendered = false
            try {
              if (process.env.KRUSTY_DEBUG) {
                process.stderr.write('[krusty] prompt was pre-rendered; skipping duplicate\n')
              }
            }
            catch {}
          }
          else {
            try {
              if (process.env.KRUSTY_DEBUG) {
                process.stderr.write('[krusty] refreshing prompt before readLine\n')
              }
            }
            catch {}
            this.autoSuggestInput.refreshPrompt(prompt)
          }
          const input = await this.readLine(prompt)

          if (input === null) {
            // EOF (Ctrl+D)
            break
          }

          if (input.trim()) {
            const result = await this.execute(input)
            // Record completion status for prompt rendering
            try {
              this.lastExitCode = typeof result.exitCode === 'number' ? result.exitCode : this.lastExitCode
              this.lastCommandDurationMs = typeof result.duration === 'number' ? result.duration : 0
            }
            catch {}

            // Print buffered output only if it wasn't already streamed live
            if (!result.streamed) {
              if (result.stdout) {
                process.stdout.write(result.stdout)
              }
              if (result.stderr) {
                process.stderr.write(result.stderr)
              }
              // Ensure prompt appears on a new line when the command output did not end with one
              try {
                const combined = `${result.stdout || ''}${result.stderr || ''}`
                if (combined && !combined.endsWith('\n'))
                  process.stdout.write('\n')
              }
              catch {}

              // Immediately refresh the prompt in interactive sessions
              try {
                const nextPrompt = await this.renderPrompt()
                try {
                  if (process.env.KRUSTY_DEBUG) {
                    process.stderr.write('[krusty] refreshing prompt after buffered output\n')
                  }
                }
                catch {}
                this.autoSuggestInput.refreshPrompt(nextPrompt)
                this.promptPreRendered = true
              }
              catch {}
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
      this.interactiveSession = false
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
    const prompt = this.promptRenderer.render(this.cwd, systemInfo, gitInfo, this.lastExitCode, this.lastCommandDurationMs)
    // Clear duration so it only shows once after a command
    this.lastCommandDurationMs = 0

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

  getCompletions(input: string, cursor: number): import('./types').CompletionResults {
    try {
      // Execute completion:before hooks
      this.hookManager.executeHooks('completion:before', { input, cursor })
        .catch(err => this.log.error('completion:before hook error:', err))

      // Get completions from the completion provider
      let completions: any = []

      try {
        completions = this.completionProvider.getCompletions(input, cursor)
      }
      catch (error) {
        this.log.error('Error in completion provider:', error)
      }

      // Detect grouped results: array of objects with title and items
      const isGroupArray = (v: any): v is Array<{ title: string, items: any[] }> =>
        Array.isArray(v) && v.every(g => g && typeof g.title === 'string' && Array.isArray(g.items))

      // Always collect plugin completions (flat strings)
      let pluginCompletions: string[] = []
      if (this.pluginManager?.getPluginCompletions) {
        try {
          pluginCompletions = this.pluginManager.getPluginCompletions(input, cursor) || []
        }
        catch (error) {
          this.log.error('Error getting plugin completions:', error)
        }
      }

      if (isGroupArray(completions)) {
        // Normalize and merge grouped results by title; dedupe items within each group.
        const normalizeTitle = (t: string) => (t || '').trim().toLowerCase()
        const getText = (v: any): string =>
          (v && typeof v === 'object' && typeof v.text === 'string') ? v.text : String(v)

        const groupMap = new Map<string, { title: string, items: any[] }>()
        for (const g of completions) {
          const norm = normalizeTitle(g.title)
          const existing = groupMap.get(norm)
          const incomingItems = Array.isArray(g.items) ? g.items : []
          if (!existing) {
            // Start a new group; copy and dedupe items
            const seen = new Set<string>()
            const items: any[] = []
            for (const it of incomingItems) {
              const key = getText(it)
              if (!key)
                continue
              if (!seen.has(key)) {
                seen.add(key)
                items.push(it)
              }
            }
            groupMap.set(norm, { title: (g.title || '').trim(), items })
          }
          else {
            // Merge into existing with dedupe by text
            const seen = new Set(existing.items.map(getText))
            for (const it of incomingItems) {
              const key = getText(it)
              if (!key)
                continue
              if (!seen.has(key)) {
                seen.add(key)
                existing.items.push(it)
              }
            }
          }
        }

        // Do not append a separate 'plugins' group in grouped mode.
        // Plugin completions will still be merged in flat mode below.

        const merged = Array.from(groupMap.values())

        if (this.config.verbose) {
          try {
            const titles = merged.map(g => g.title).join(', ')
            this.log.debug?.(`completion groups merged: [${titles}]`)
          }
          catch {}
        }

        this.hookManager.executeHooks('completion:after', { input, cursor, completions: merged })
          .catch(err => this.log.error('completion:after hook error:', err))
        return merged
      }

      // Merge flat plugin completions into flat core list
      if (pluginCompletions.length > 0) {
        completions = [...new Set([...(Array.isArray(completions) ? completions : []), ...pluginCompletions])]
      }

      // Filter out empty strings and sort alphabetically (case-insensitive)
      const allSorted = completions
        .filter((c: string) => c && c.trim().length > 0)
        .sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

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

        const matchingBuiltins = Array.from(this.builtins.keys()).filter(startsWith)
        if (matchingBuiltins.length) {
          // Merge all matching builtins into the list
          let merged = [...completions]
          for (const b of matchingBuiltins) {
            if (!merged.includes(b))
              merged.push(b)
          }
          // Clean and sort alphabetically
          merged = merged
            .filter((c: string) => c && c.trim().length > 0)
            .sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

          // If over max, include all matching builtins first, then fill remaining with others
          if (merged.length > max) {
            const builtinSet = new Set(matchingBuiltins)
            const builtinItems = merged.filter(i => builtinSet.has(i))
            const otherItems = merged.filter(i => !builtinSet.has(i))
            const remaining = Math.max(0, max - builtinItems.length)
            merged = builtinItems.concat(otherItems.slice(0, remaining))
          }

          // Always return results sorted alphabetically (case-insensitive)
          merged = merged.sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

          completions = merged
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

      // xtrace for builtins: print command before execution
      if (this.xtrace) {
        const formatArg = (a: string) => (/\s/.test(a) ? `"${a}"` : a)
        const argsStr = Array.isArray(command.args) ? command.args.map((a: string) => formatArg(a)).join(' ') : ''
        const line = `+ ${command.name}${argsStr ? ` ${argsStr}` : ''}`
        this.lastXtraceLine = line
        try {
          process.stderr.write(`${line}\n`)
        }
        catch {}
      }

      // Process arguments to remove quotes for builtin commands (except alias which handles quotes itself)
      const processedArgs = command.name === 'alias'
        ? command.args
        : command.args.map((arg: string) => this.processAliasArgument(arg))
      const result = await builtin.execute(processedArgs, this)

      // Apply redirections to builtin output if needed
      if (redirections && redirections.length > 0) {
        await this.applyRedirectionsToBuiltinResult(result, redirections)
        // Determine which streams were redirected and clear them from the buffered result
        const affectsStdout = redirections.some(r => r?.type === 'file' && (
          r.direction === 'output' || r.direction === 'append' || r.direction === 'both'
        ))
        const affectsStderr = redirections.some(r => r?.type === 'file' && (
          r.direction === 'error' || r.direction === 'error-append' || r.direction === 'both'
        ))
        return {
          ...result,
          stdout: affectsStdout ? '' : (result.stdout || ''),
          stderr: affectsStderr ? '' : (result.stderr || ''),
        }
      }

      return result
    }

    // Expand aliases with cycle detection
    const expandedCommand = options?.bypassAliases ? command : this.expandAliasWithCycleDetection(command)

    // xtrace: print command before execution
    if (this.xtrace) {
      const formatArg = (a: string) => (/\s/.test(a) ? `"${a}"` : a)
      const argsStr = Array.isArray(expandedCommand.args) ? expandedCommand.args.map((a: string) => formatArg(a)).join(' ') : ''
      const line = `+ ${expandedCommand.name}${argsStr ? ` ${argsStr}` : ''}`
      this.lastXtraceLine = line
      try {
        process.stderr.write(`${line}\n`)
      }
      catch {}
    }

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

  private async executePipedCommands(commands: any[], _redirections?: any[], _options?: { bypassAliases?: boolean, bypassFunctions?: boolean }): Promise<CommandResult> {
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

    // Prepare execution plan that supports a mix of externals and builtins
    const children: Array<ChildProcess | null> = []
    const builtinResults: Array<CommandResult | null> = Array.from({ length: commands.length }, () => null)
    const exitCodes: Array<number | null> = Array.from({ length: commands.length }, () => null)
    let stderrAgg = ''
    let stdoutLast = ''
    // Per-stage redirections parsed from the original segment
    const stageRedirs: Array<any[] | undefined> = Array.from({ length: commands.length }, () => undefined)

    for (let i = 0; i < commands.length; i++) {
      // Expand alias for this segment if applicable
      const cmd = this.expandAlias(commands[i])
      // xtrace
      if (this.xtrace) {
        const formatArg = (a: string) => (a.includes(' ') ? `"${a}"` : a)
        const argsStr = Array.isArray(cmd.args) ? cmd.args.map((a: string) => formatArg(a)).join(' ') : ''
        try {
          process.stderr.write(`+ ${cmd.name}${argsStr ? ` ${argsStr}` : ''}\n`)
        }
        catch {}
      }

      // If the command is a builtin, execute it inline
      if (this.builtins.has(cmd.name)) {
        const builtin = this.builtins.get(cmd.name)!
        const processedArgs = (cmd as any).preserveQuotedArgs || cmd.name === 'alias'
          ? cmd.args
          : cmd.args.map((arg: string) => this.processAliasArgument(arg))
        // Parse redirections for this stage from the raw segment
        try {
          // Prefer the original segment's raw representation to preserve quotes
          const rawForRedirs = (commands[i] && (commands[i] as any).raw)
            || (cmd as any).raw
            || `${cmd.name} ${(cmd.args || []).join(' ')}`
          const parsed = RedirectionHandler.parseRedirections(rawForRedirs)
          stageRedirs[i] = parsed.redirections
        }
        catch {}
        const res = await builtin.execute(processedArgs, this)
        // Apply builtin redirections to the buffered result before any downstream piping
        if (Array.isArray(stageRedirs[i]) && stageRedirs[i]!.length > 0) {
          await this.applyRedirectionsToBuiltinResult(res, stageRedirs[i]!)
        }
        builtinResults[i] = res
        stderrAgg += res.stderr || ''
        exitCodes[i] = res.exitCode
        children.push(null)
      }
      else {
        // External command
        const extArgs = (cmd.args || []).map((arg: string) => this.processAliasArgument(arg))
        // Parse redirections for this stage from the raw segment
        try {
          // Prefer the original segment's raw representation to preserve quotes
          const rawForRedirs = (commands[i] && (commands[i] as any).raw)
            || (cmd as any).raw
            || `${cmd.name} ${extArgs.join(' ')}`
          const parsed = RedirectionHandler.parseRedirections(rawForRedirs)
          stageRedirs[i] = parsed.redirections
        }
        catch {}
        const child = spawn(cmd.name, extArgs, {
          cwd: this.cwd,
          env: cleanEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        // CI debug: log spawn
        if (process.env.KRUSTY_CI_DEBUG) {
          try {
            this.log.info(`[ci-debug] spawn(pipe stage ${i}): pid=${child.pid} cmd=${cmd.raw || `${cmd.name} ${extArgs.join(' ')}`}`)
          }
          catch {}
        }

        // Add to job manager (foreground)
        try {
          this.addJob(cmd.raw || `${cmd.name} ${extArgs.join(' ')}`, child, false)
        }
        catch {}

        // Apply per-stage redirections to this external child
        if (Array.isArray(stageRedirs[i]) && stageRedirs[i]!.length > 0) {
          try {
            await RedirectionHandler.applyRedirections(child, stageRedirs[i]!, this.cwd)
          }
          catch {}
        }

        // Collect stderr from each process unless this stage duplicates 2>&1,
        // in which case stderr will be merged into stdout and forwarded down the pipe.
        const stageHas2To1 = (stageRedirs[i] || []).some((rd: any) => rd.type === 'fd' && rd.fd === 2 && rd.target === '&1')
        if (!stageHas2To1) {
          child.stderr?.on('data', (d) => {
            stderrAgg += d.toString()
          })
        }

        children.push(child)
      }
    }

    // Helpers to determine if a stage has input/output FD or file redirection that should override piping
    const hasInputSource = (idx: number): boolean => {
      const r = stageRedirs[idx] || []
      return r.some((rd: any) => rd.direction === 'input' && (rd.type === 'file' || rd.type === 'here-string' || rd.type === 'here-doc'))
    }
    const hasStdoutRedirect = (idx: number): boolean => {
      const r = stageRedirs[idx] || []
      return r.some((rd: any) =>
        (rd.type === 'file' && (rd.direction === 'output' || rd.direction === 'append' || rd.direction === 'both'))
        || (rd.type === 'fd' && rd.fd === 1),
      )
    }

    // Wire pipes between processes
    for (let i = 0; i < children.length - 1; i++) {
      const leftChild = children[i]
      const rightChild = children[i + 1]
      const leftBuiltin = builtinResults[i]
      const rightHasOwnInput = hasInputSource(i + 1)
      const leftStdoutOverridden = hasStdoutRedirect(i)
      // If left is external and right is external
      if (leftChild && rightChild) {
        if (rightHasOwnInput || leftStdoutOverridden) {
          // Respect redirection precedence: do not connect pipe when right has input redirect
          // or left stdout was redirected/closed/duplicated.
          // However, if the right does NOT have its own input source, close its stdin to avoid hanging.
          if (!rightHasOwnInput) {
            try {
              rightChild.stdin?.end()
            }
            catch {}
            if (process.env.KRUSTY_CI_DEBUG) {
              try {
                this.log.info(`[ci-debug] pipe(skip wire ext->ext, end right stdin) stage=${i}->${i + 1}`)
              }
              catch {}
            }
          }
        }
        else {
          const wants2To1 = (leftChild as any).__kr_fd_2_to_1 === true
            || (stageRedirs[i] || []).some((rd: any) => rd.type === 'fd' && rd.fd === 2 && rd.target === '&1')
          if (wants2To1) {
            // Merge stdout and stderr into one stream and pipe to next stdin
            const merge = new PassThrough()
            let endedCount = 0
            const tryEnd = () => {
              endedCount += 1
              if (endedCount >= 2) {
                try {
                  merge.end()
                }
                catch {}
              }
            }
            leftChild.stdout?.on('error', () => {})
            leftChild.stderr?.on('error', () => {})
            leftChild.stdout?.on('end', tryEnd)
            leftChild.stderr?.on('end', tryEnd)
            leftChild.stdout?.pipe(merge, { end: false })
            leftChild.stderr?.pipe(merge, { end: false })
            try {
              merge.pipe(rightChild.stdin!, { end: true })
            }
            catch {}
            if (process.env.KRUSTY_CI_DEBUG) {
              try {
                this.log.info(`[ci-debug] pipe(ext 2>&1)->ext wired stage=${i}->${i + 1}`)
              }
              catch {}
            }
          }
          else {
            leftChild.stdout?.pipe(rightChild.stdin!, { end: true })
            if (process.env.KRUSTY_CI_DEBUG) {
              try {
                this.log.info(`[ci-debug] pipe(ext->ext) wired stage=${i}->${i + 1}`)
              }
              catch {}
            }
          }
        }
      }
      // If left is builtin and right is external, write the builtin stdout to right stdin
      else if (!leftChild && rightChild) {
        try {
          if (rightHasOwnInput || leftStdoutOverridden) {
            // Do not feed builtin output if right has its own stdin source or left stdout was redirected
            // But if right has no own input, close its stdin to avoid waiting forever
            if (!rightHasOwnInput) {
              try {
                rightChild.stdin?.end()
              }
              catch {}
              if (process.env.KRUSTY_CI_DEBUG) {
                try {
                  this.log.info(`[ci-debug] pipe(skip wire builtin->ext, end right stdin) stage=${i}->${i + 1}`)
                }
                catch {}
              }
            }
          }
          else {
            // Pseudo-stream builtin output using a Readable to respect backpressure
            const data = leftBuiltin?.stdout || ''
            if (data && data.length > 0) {
              const src = Readable.from([data])
              src.on('error', () => {})
              rightChild.stdin?.on('error', (err: any) => {
                if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_WRITE_AFTER_END')) {
                  // ignore benign pipe errors
                }
              })
              src.pipe(rightChild.stdin!)
              if (process.env.KRUSTY_CI_DEBUG) {
                try {
                  this.log.info(`[ci-debug] pipe(builtin->ext) wrote ${data.length}B stage=${i}->${i + 1}`)
                }
                catch {}
              }
            }
            else {
              // No data to write; explicitly end stdin of the right child to avoid waiting
              try {
                rightChild.stdin?.end()
              }
              catch {}
              if (process.env.KRUSTY_CI_DEBUG) {
                try {
                  this.log.info(`[ci-debug] pipe(builtin->ext) no data, ended right stdin stage=${i}->${i + 1}`)
                }
                catch {}
              }
            }
          }
        }
        catch {}
      }
      // If right is builtin, we don't need to wire anything; builtins don't read stdin in our current model
    }

    // Capture stdout only from the last process in the pipeline
    const lastChild = children[children.length - 1]
    const lastBuiltin = builtinResults[commands.length - 1]
    if (lastChild) {
      lastChild.stdout?.on('data', (d) => {
        stdoutLast += d.toString()
      })
    }
    else if (lastBuiltin) {
      stdoutLast = lastBuiltin.stdout || ''
    }

    // If the final stage redirects or closes stdout, suppress returned stdout buffer
    if (hasStdoutRedirect(children.length - 1)) {
      stdoutLast = ''
    }

    // Ensure first process stdin is closed if no input provider exists and it's an external.
    // Avoid double-ending; piping above already set end for downstreams.
    const firstChild = children[0]
    const firstIsBuiltin = builtinResults[0] !== null
    if (firstChild && !firstIsBuiltin) {
      try {
        // If nothing is piped or redirected into the first child, close its stdin to prevent hanging
        const hasUpstream = false
        const hasOwnInput = hasInputSource(0)
        if (!hasUpstream && !hasOwnInput) {
          firstChild.stdin?.end()
          if (process.env.KRUSTY_CI_DEBUG) {
            try {
              this.log.info(`[ci-debug] first stage stdin explicitly ended`)
            }
            catch {}
          }
        }
      }
      catch {}
    }

    // Await all processes (if any were spawned). If the pipeline is all builtins,
    // there are no children to await and exit codes are already populated.
    if (children.length > 0) {
      await new Promise<void>((resolve) => {
        let closed = 0
        children.forEach((child, idx) => {
          const isBuiltin = builtinResults[idx] !== null
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
              if (process.env.KRUSTY_CI_DEBUG) {
                try {
                  this.log.info(`[ci-debug] child close(stage ${idx}) code=${code} signal=${signal} ec=${ec}`)
                }
                catch {}
              }
              if (closed === children.length)
                resolve()
            })
          }
          else if (isBuiltin) {
            // Already have exit code from builtin; count it as closed
            closed += 1
            if (closed === children.length)
              resolve()
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

    // Handle multiple commands separated by ;, &&, ||
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
        ...process.env,
        ...this.environment,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
        BUN_FORCE_COLOR: '3', // Specifically for bun commands
      }).filter(([_, value]) => value !== undefined) as [string, string][],
    )

    // Determine if we'll stream output for this command (used to avoid duplicate nested echoes)
    const willStream = !command.background && this.config.streamOutput !== false
    // Build echo prefix for package manager script runs (bun/npm/pnpm/yarn)
    // Only include nested expansion when buffering (not streaming) to avoid duplicates
    const echoPrefix = await this.buildPackageRunEcho(command, !willStream)

    // If this command needs an interactive TTY, run it attached to the terminal.
    // We avoid this path if there are redirections or backgrounding.
    if (this.needsInteractiveTTY(command, redirections)) {
      // Ensure the terminal is in cooked mode (AutoSuggestInput turns raw on during readLine).
      try {
        const stdinAny = process.stdin as any
        if (typeof stdinAny.setRawMode === 'function' && stdinAny.isTTY)
          stdinAny.setRawMode(false)
      }
      catch {}

      // If we have an echo prefix and we're attaching the child to our TTY,
      // write it immediately before spawning to ensure correct ordering.
      if (echoPrefix) {
        try {
          process.stdout.write(echoPrefix)
        }
        catch {}
      }

      // Prepare arguments for external command
      const externalArgs = (command.args || []).map((arg: string) => this.processAliasArgument(arg))

      // Spawn child attached to our TTY so it can handle password prompts, etc.
      const child = spawn(command.name, externalArgs, {
        cwd: this.cwd,
        env: cleanEnv,
        stdio: 'inherit',
      })

      // Register the job (foreground)
      const _jobId = this.addJob(command.raw || `${command.name} ${command.args.join(' ')}`, child, false)

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
          // Provide a friendly message when the executable is missing
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
        // We let the child handle all I/O directly to the terminal
        streamed: true,
      }
    }

    // Configure stdio (we keep pipes and let RedirectionHandler rewire/close as needed)
    const stdio: any = ['pipe', 'pipe', 'pipe']

    // For external commands, remove surrounding quotes and unescape so spawn receives clean args
    const externalArgs = (command.args || []).map((arg: string) => this.processAliasArgument(arg))
    const child = spawn(command.name, externalArgs, {
      cwd: this.cwd,
      env: cleanEnv,
      stdio,
    })

    // Apply any parsed redirections (files, fd dup/close, here-string/doc, &> etc.)
    if (redirections && redirections.length > 0) {
      try {
        await RedirectionHandler.applyRedirections(child, redirections, this.cwd)
      }
      catch {}
    }

    // Add job to JobManager and stream output
    const jobId = this.addJob(command.raw || `${command.name} ${command.args.join(' ')}`, child, command.background)

    // If stdout was redirected/closed, avoid capturing it again
    const skipStdoutCapture = Array.isArray(redirections) && redirections.some((rd: any) => {
      if (rd.type === 'file' && (rd.direction === 'output' || rd.direction === 'append' || rd.direction === 'both'))
        return true
      if (rd.type === 'fd' && rd.fd === 1 && (rd.target === '&-' || /^&\d+$/.test(rd.target)))
        return true
      return false
    })

    return this.setupStreamingProcess(child, start, command, undefined, !!skipStdoutCapture, jobId, echoPrefix || undefined)
  }

  /**
   * Apply redirections to builtin command results
   */
  private async applyRedirectionsToBuiltinResult(result: CommandResult, redirections: any[]): Promise<void> {
    for (const redirection of redirections) {
      // Handle FD duplication/closing for builtin results by manipulating buffers
      if (redirection.type === 'fd') {
        const fd: number | undefined = redirection.fd
        const dst: string = redirection.target
        if (typeof fd === 'number') {
          if (dst === '&-') {
            // Close: discard the selected stream buffer
            if (fd === 1) {
              result.stdout = ''
            }
            else if (fd === 2) {
              result.stderr = ''
            }
            else if (fd === 0) {
              // stdin close has no effect on already-produced builtin output
            }
          }
          else {
            const m = dst.match(/^&(\d+)$/)
            if (m) {
              const targetFd = Number.parseInt(m[1], 10)
              // Duplicate: merge buffers accordingly
              if (fd === 2 && targetFd === 1) {
                // 2>&1: send stderr to stdout
                result.stdout = (result.stdout || '') + (result.stderr || '')
                result.stderr = ''
              }
              else if (fd === 1 && targetFd === 2) {
                // 1>&2: send stdout to stderr
                result.stderr = (result.stderr || '') + (result.stdout || '')
                result.stdout = ''
              }
              // Other FDs are not represented for builtins; ignore safely
            }
          }
        }
        continue
      }

      if (redirection.type === 'file') {
        let rawTarget = typeof redirection.target === 'string' && redirection.target.startsWith('APPEND::')
          ? redirection.target.replace(/^APPEND::/, '')
          : redirection.target
        if (typeof rawTarget === 'string' && ((rawTarget.startsWith('"') && rawTarget.endsWith('"')) || (rawTarget.startsWith('\'') && rawTarget.endsWith('\'')))) {
          rawTarget = rawTarget.slice(1, -1)
        }
        if (typeof rawTarget !== 'string') {
          continue
        }
        const outputFile: string = rawTarget.startsWith('/') ? rawTarget : `${this.cwd}/${rawTarget}`

        if (redirection.direction === 'input') {
          // Input redirections do not affect builtin buffered output here
          continue
        }

        if (redirection.direction === 'output') {
          const { writeFileSync } = await import('node:fs')
          writeFileSync(outputFile, result.stdout || '')
          // If only stdout was redirected, clear it from the result
          result.stdout = ''
        }
        else if (redirection.direction === 'append') {
          const { appendFileSync } = await import('node:fs')
          appendFileSync(outputFile, result.stdout || '')
          result.stdout = ''
        }
        else if (redirection.direction === 'error') {
          const { writeFileSync } = await import('node:fs')
          writeFileSync(outputFile, result.stderr || '')
          result.stderr = ''
        }
        else if (redirection.direction === 'error-append') {
          const { appendFileSync } = await import('node:fs')
          appendFileSync(outputFile, result.stderr || '')
          result.stderr = ''
        }
        else if (redirection.direction === 'both') {
          const isAppend = typeof redirection.target === 'string' && redirection.target.startsWith('APPEND::')
          if (isAppend) {
            const { appendFileSync } = await import('node:fs')
            if (result.stdout) {
              appendFileSync(outputFile, result.stdout)
            }
            if (result.stderr) {
              appendFileSync(outputFile, result.stderr)
            }
          }
          else {
            const { writeFileSync } = await import('node:fs')
            // Write stdout then stderr to mimic streaming order approximation
            writeFileSync(outputFile, result.stdout || '')
            if (result.stderr) {
              const { appendFileSync } = await import('node:fs')
              appendFileSync(outputFile, result.stderr)
            }
          }
          // Clear both since they were redirected together
          result.stdout = ''
          result.stderr = ''
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
        ...process.env,
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

  // Set up streaming/buffering for a spawned child process
  private async setupStreamingProcess(
    child: ChildProcess,
    start: number,
    command: any,
    input?: string,
    skipStdoutCapture: boolean = false,
    jobId?: number,
    echoPrefix?: string,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      // Track if the last character written to the terminal ended with a newline when streaming
      let lastWriteEndedWithNewline = true

      // Stream output in real-time by default, unless explicitly disabled or running in background
      const shouldStream = !command.background && this.config.streamOutput !== false

      // Timeout handling setup (foreground only)
      const timeoutMs = this.config.execution?.defaultTimeoutMs
      const killSignal = (this.config.execution?.killSignal || 'SIGTERM') as NodeJS.Signals
      let timeoutTimer: NodeJS.Timeout | null = null
      let timedOut = false
      let settled = false

      // If we're streaming to terminal and stdout is not redirected/closed, print echo lines now
      if (shouldStream && !skipStdoutCapture && echoPrefix) {
        try {
          process.stdout.write(echoPrefix)
        }
        catch {}
      }

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
        // Compute exit code
        let exitCode = code ?? 0
        if (timedOut) {
          // Standard timeout exit
          exitCode = 124
        }
        else if (signal) {
          exitCode = signal === 'SIGTERM' ? 143 : 130
        }
        this.lastExitCode = exitCode

        // If buffering (not streaming) and stdout is captured, prefix echo
        if (!shouldStream && !skipStdoutCapture && echoPrefix) {
          stdout = `${echoPrefix}${stdout}`
        }

        // If we streamed and the last output didn't end with a newline, add one so the next prompt is on a fresh line
        if (shouldStream) {
          try {
            // Determine whether we wrote anything at all; if yes and no trailing newline, write one
            const wroteSomething = (!skipStdoutCapture && stdout.length > 0) || stderr.length > 0
            if (wroteSomething && !lastWriteEndedWithNewline)
              process.stdout.write('\n')
          }
          catch {}
        }

        // Immediately refresh the prompt in interactive sessions after a foreground streamed process ends
        if (shouldStream && this.interactiveSession) {
          try {
            // Render prompt now, and signal the next loop to not print it again
            this.renderPrompt().then((p) => {
              try {
                // Use coordinated prompt refresh via AutoSuggestInput
                try {
                  if (process.env.KRUSTY_DEBUG) {
                    process.stderr.write('[krusty] refreshing prompt after streamed process finish\n')
                  }
                }
                catch {}
                this.autoSuggestInput.refreshPrompt(p)
                this.promptPreRendered = true
              }
              catch {}
            }).catch(() => {})
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

      // Handle completion via both 'close' and 'exit'
      child.on('close', (code, signal) => finish(code ?? 0, signal ?? null))
      child.on('exit', (code, signal) => setTimeout(() => finish(code ?? 0, signal ?? null), 0))

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
              // Attempt graceful termination first with configured signal
              child.kill(killSignal)
            }
            catch {}
            // Resolution will occur via 'close'/'exit' -> finish()
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
          this.log.info(`[${jobId}] ${child.pid} ${command.raw || `${command.name} ${command.args.join(' ')}`}`)
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
