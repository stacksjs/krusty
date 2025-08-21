import type { Logger } from './logger'

export interface KrustyConfig {
  verbose: boolean
  streamOutput?: boolean
  execution?: ExecutionConfig
  prompt?: PromptConfig
  history?: HistoryConfig
  completion?: CompletionConfig
  aliases?: Record<string, string>
  environment?: Record<string, string>
  plugins?: PluginConfig[]
  theme?: ThemeConfig
  modules?: ModuleConfig
  hooks?: HooksConfig
  logging?: LoggingConfig
}

export interface PromptConfig {
  format?: string
  showGit?: boolean
  showTime?: boolean
  showUser?: boolean
  showHost?: boolean
  showPath?: boolean
  showExitCode?: boolean
  rightPrompt?: string
  transient?: boolean
}

export interface HistoryConfig {
  maxEntries?: number
  file?: string
  ignoreDuplicates?: boolean
  ignoreSpace?: boolean
  searchMode?: 'fuzzy' | 'exact'
}

export interface CompletionCacheConfig {
  enabled?: boolean
  ttl?: number
  maxEntries?: number
}

export interface CompletionContextConfig {
  enabled?: boolean
  maxDepth?: number
  fileTypes?: string[]
}

export interface GitCompletionConfig {
  enabled?: boolean
  includePorcelain?: boolean
  includePlumbing?: boolean
}

export interface NpmCompletionConfig {
  enabled?: boolean
  includeScripts?: boolean
  includeConfig?: boolean
}

export interface CompletionCommandsConfig {
  git?: GitCompletionConfig
  npm?: NpmCompletionConfig
  [key: string]: any
}

export interface CompletionConfig {
  enabled?: boolean
  caseSensitive?: boolean
  showDescriptions?: boolean
  maxSuggestions?: number
  /**
   * Maximum number of PATH full-path executable suggestions (e.g. "/usr/bin/ls")
   * returned by completions like the `which` builtin.
   * Defaults to 20 when not specified.
   */
  binPathMaxSuggestions?: number
  cache?: CompletionCacheConfig
  context?: CompletionContextConfig
  commands?: CompletionCommandsConfig
}

export interface LoggingConfig {
  prefixes?: {
    debug?: string
    info?: string
    warn?: string
    error?: string
  }
}

export interface ThemeFontConfig {
  /**
   * Font family for the terminal
   * @example '"JetBrains Mono", monospace'
   */
  family?: string

  /**
   * Base font size in pixels
   * @default 14
   */
  size?: number

  /**
   * Font weight (100-900)
   * @default 400
   */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 'normal' | 'bold' | 'lighter' | 'bolder'

  /**
   * Line height as a multiplier of font size
   * @default 1.4
   */
  lineHeight?: number

  /**
   * Enable/disable ligatures
   * @default false
   */
  ligatures?: boolean
}

export interface ThemeGitStatusConfig {
  enabled?: boolean
  showStaged?: boolean
  showUnstaged?: boolean
  showUntracked?: boolean
  showAheadBehind?: boolean
  format?: string
}

export interface ThemePromptConfig {
  left?: string
  right?: string
  continuation?: string
  error?: string
}

export interface ThemeGitColors {
  branch?: string
  ahead?: string
  behind?: string
  staged?: string
  unstaged?: string
  untracked?: string
  conflict?: string
}

export interface ThemeColors {
  primary?: string
  secondary?: string
  success?: string
  warning?: string
  error?: string
  info?: string
  git?: ThemeGitColors
}

export interface ThemeGitSymbols {
  branch?: string
  ahead?: string
  behind?: string
  staged?: string
  unstaged?: string
  untracked?: string
  conflict?: string
}

export interface ThemeSymbols {
  prompt?: string
  continuation?: string
  git?: ThemeGitSymbols
}

export interface ThemeConfig {
  // Theme name to use (must match a theme in themes/ directory)
  name?: string
  // Auto-detect system color scheme
  autoDetectColorScheme?: boolean
  // Default color scheme (light/dark/auto)
  defaultColorScheme?: string
  // Enable right prompt
  enableRightPrompt?: boolean
  // Git status in prompt settings
  gitStatus?: ThemeGitStatusConfig
  // Prompt configuration
  prompt?: ThemePromptConfig
  // Colors configuration
  colors?: ThemeColors
  // Font configuration
  font?: ThemeFontConfig
  // Symbol configuration
  symbols?: ThemeSymbols
  // CSS overrides
  css?: string
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  duration?: number
  success?: boolean
  /**
   * Indicates whether the command's output was already streamed live.
   * If true, callers should avoid re-printing stdout/stderr to prevent duplicates.
   * Builtins typically set this to false/undefined and return buffered output.
   */
  streamed?: boolean
  /**
   * Additional metadata for script control flow
   */
  metadata?: {
    isReturn?: boolean
    isBreak?: boolean
    isContinue?: boolean
    level?: number
  }
}

export interface Command {
  name: string
  args: string[]
  raw: string
  background?: boolean
  pipes?: Command[]
  originalArgs?: string[]
}

export interface Redirection {
  type: 'file' | 'fd' | 'here-doc' | 'here-string' | 'process-substitution'
  direction: 'input' | 'output' | 'append' | 'error' | 'error-append' | 'both'
  target: string
  fd?: number
}

export interface ParsedCommand {
  commands: Command[]
  redirections?: Redirection[]
  redirects?: {
    stdin?: string
    stdout?: string
    stderr?: string
  }
}

export interface BuiltinCommand {
  name: string
  description: string
  usage: string
  examples?: string[]
  execute: (args: string[], shell: Shell) => Promise<CommandResult>
}

export interface Shell {
  config: KrustyConfig
  cwd: string
  environment: Record<string, string>
  history: string[]
  aliases: Record<string, string>
  builtins: Map<string, BuiltinCommand>
  log: Logger

  // Execution flags
  nounset?: boolean
  xtrace?: boolean
  pipefail?: boolean

  // Optional state used by some builtins
  hashTable?: Map<string, string>
  signalHandlers?: Map<string, string | null>
  umask?: number

  // Core methods
  execute: (command: string, options?: { bypassAliases?: boolean, bypassFunctions?: boolean, bypassScriptDetection?: boolean }) => Promise<CommandResult>
  executeCommand: (command: string, args: string[]) => Promise<CommandResult>
  parseCommand: (input: string) => Promise<ParsedCommand>
  changeDirectory: (path: string) => boolean
  reload: () => Promise<CommandResult>

  // REPL methods
  start: () => Promise<void>
  stop: () => void

  // Prompt methods
  renderPrompt: () => Promise<string>

  // History methods
  addToHistory: (command: string) => void
  searchHistory: (query: string) => string[]

  // Completion methods
  getCompletions: (input: string, cursor: number) => string[]

  // Job management methods
  jobs: Array<{
    id: number
    command: string
    pid?: number
    status: 'running' | 'stopped' | 'done'
    background?: boolean
  }>
  addJob: (command: string, childProcess?: any, background?: boolean) => number
  getJob: (id: number) => {
    id: number
    command: string
    pid?: number
    status: 'running' | 'stopped' | 'done'
    background?: boolean
  } | undefined
  getJobs: () => Array<{
    id: number
    command: string
    pid?: number
    status: 'running' | 'stopped' | 'done'
    background?: boolean
  }>
  setJobStatus: (id: number, status: 'running' | 'stopped' | 'done') => boolean
  removeJob: (id: number, force?: boolean) => boolean

  // Enhanced job control methods
  suspendJob?: (jobId: number) => boolean
  resumeJobBackground?: (jobId: number) => boolean
  resumeJobForeground?: (jobId: number) => boolean
  terminateJob?: (jobId: number, signal?: string) => boolean
  waitForJob?: (jobId: number) => Promise<any>
}

export interface GitInfo {
  branch?: string
  ahead?: number
  behind?: number
  staged?: number
  unstaged?: number
  untracked?: number
  stashed?: number
  isRepo: boolean
  isDirty: boolean
}

export interface SystemInfo {
  user: string
  hostname: string
  platform: string
  arch: string
  nodeVersion: string
  bunVersion: string
}

export interface PromptSegment {
  content: string
  style?: {
    color?: string
    background?: string
    bold?: boolean
    italic?: boolean
    underline?: boolean
  }
}

export interface CompletionItem {
  text: string
  description?: string
  type: 'command' | 'file' | 'directory' | 'alias' | 'builtin' | 'variable'
}

// Module system types
export interface ModuleContext {
  cwd: string
  environment: Record<string, string>
  gitInfo?: GitInfo
  systemInfo?: SystemInfo
  config?: ModuleConfig
  logger: {
    debug: (message: string, ...args: any[]) => void
    info: (message: string, ...args: any[]) => void
    warn: (message: string, ...args: any[]) => void
    error: (message: string, ...args: any[]) => void
  }
}

export interface ModuleResult {
  content: string
  style?: {
    color?: string
    background?: string
    bold?: boolean
    italic?: boolean
  }
}

export interface Module {
  name: string
  enabled: boolean
  detect: (context: ModuleContext) => boolean
  render: (context: ModuleContext) => Promise<ModuleResult | null>
  config?: Record<string, any>
}

export interface ModuleConfig {
  // Development environments
  aws?: {
    enabled?: boolean
    format?: string
    symbol?: string
    region_aliases?: Record<string, string>
    profile_aliases?: Record<string, string>
  }
  azure?: {
    enabled?: boolean
    format?: string
    symbol?: string
    subscription_aliases?: Record<string, string>
  }
  bun?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  deno?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  nodejs?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  golang?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  python?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  java?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  kotlin?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  php?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  ruby?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  swift?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  zig?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  lua?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  perl?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  rlang?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  dotnet?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  erlang?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  cmake?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  c?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  cpp?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  terraform?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }
  pulumi?: {
    enabled?: boolean
    format?: string
    symbol?: string
    detect_files?: string[]
    detect_extensions?: string[]
  }

  // Cloud providers
  gcloud?: {
    enabled?: boolean
    format?: string
    symbol?: string
    region_aliases?: Record<string, string>
    project_aliases?: Record<string, string>
  }

  // Git modules
  git_branch?: {
    enabled?: boolean
    format?: string
    symbol?: string
    truncation_length?: number
    truncation_symbol?: string
  }
  git_commit?: {
    enabled?: boolean
    format?: string
    commit_hash_length?: number
  }
  git_state?: {
    enabled?: boolean
    format?: string
    cherry_pick?: string
    rebase?: string
    merge?: string
    revert?: string
    bisect?: string
    am?: string
    progress_format?: string
  }
  git_status?: {
    enabled?: boolean
    format?: string
    ahead?: string
    behind?: string
    conflicted?: string
    deleted?: string
    diverged?: string
    modified?: string
    renamed?: string
    staged?: string
    stashed?: string
    untracked?: string
    typechanged?: string
  }
  git_metrics?: {
    enabled?: boolean
    format?: string
  }

  // System modules
  os?: {
    enabled?: boolean
    format?: string
    symbol?: string
  }
  hostname?: {
    enabled?: boolean
    format?: string
    ssh_only?: boolean
  }
  directory?: {
    enabled?: boolean
    format?: string
    truncation_length?: number
    truncate_to_repo?: boolean
    home_symbol?: string
  }
  username?: {
    enabled?: boolean
    format?: string
    show_always?: boolean
  }
  shell?: {
    enabled?: boolean
    format?: string
  }
  battery?: {
    enabled?: boolean
    format?: string
    full_symbol?: string
    charging_symbol?: string
    discharging_symbol?: string
    unknown_symbol?: string
    empty_symbol?: string
  }
  cmd_duration?: {
    enabled?: boolean
    format?: string
    min_time?: number
    show_milliseconds?: boolean
  }
  memory_usage?: {
    enabled?: boolean
    format?: string
    threshold?: number
    symbol?: string
  }
  time?: {
    enabled?: boolean
    format?: string
  }
  nix_shell?: {
    enabled?: boolean
    format?: string
    symbol?: string
    impure_msg?: string
    pure_msg?: string
    unknown_msg?: string
  }

  env_var?: Record<string, {
    enabled?: boolean
    format?: string
    symbol?: string
    variable?: string
    default?: string
  }>
  custom?: Record<string, {
    enabled?: boolean
    format?: string
    symbol?: string
    command?: string
    when?: string | boolean
    shell?: string[]
    description?: string
    files?: string[]
    extensions?: string[]
    directories?: string[]
  }>
}

// Plugin system types
export interface PluginUpdateConfig {
  autoUpdate?: boolean
  checkInterval?: number
  lastChecked?: number
}

export interface PluginConfig {
  // Enable/disable plugin system
  enabled?: boolean
  // Directory to look for plugins (relative to config directory)
  directory?: string
  // List of plugins to load (can be local paths or npm package names)
  list?: Array<{
    name: string
    enabled?: boolean
    /**
     * Lazily load this plugin on first access (e.g., when completions or getPlugin are requested).
     * Defaults to false to preserve current behavior.
     */
    lazy?: boolean
    path?: string
    url?: string
    version?: string
    config?: Record<string, any>
  }>
  // Plugin update settings
  update?: PluginUpdateConfig
}

// Execution behavior configuration
export interface ExecutionConfig {
  /**
   * Default timeout in milliseconds for external commands (0 to disable).
   * When exceeded, the process receives killSignal (default SIGTERM),
   * followed by SIGKILL after a short grace period.
   */
  defaultTimeoutMs?: number
  /**
   * Signal used to terminate timed-out processes. Defaults to 'SIGTERM'.
   */
  killSignal?: string
}

export interface Plugin {
  name: string
  version: string
  description?: string
  author?: string

  // Plugin lifecycle methods
  initialize?: (context: PluginContext) => Promise<void> | void
  activate?: (context: PluginContext) => Promise<void> | void
  deactivate?: (context: PluginContext) => Promise<void> | void
  destroy?: (context: PluginContext) => Promise<void> | void

  // Plugin capabilities
  commands?: Record<string, PluginCommand>
  modules?: Module[]
  hooks?: Record<string, HookHandler>
  completions?: PluginCompletion[]
  aliases?: Record<string, string>

  // Plugin metadata
  dependencies?: string[]
  krustyVersion?: string
}

export interface PluginContext {
  shell: Shell
  config: KrustyConfig
  pluginConfig?: Record<string, any>
  logger: PluginLogger
  utils: PluginUtils
}

export interface PluginCommand {
  description: string
  usage?: string
  examples?: string[]
  execute: (args: string[], context: PluginContext) => Promise<CommandResult>
}

export interface PluginCompletion {
  command: string
  complete: (input: string, cursor: number, context: PluginContext) => string[]
}

export interface PluginLogger {
  debug: (message: string, ...args: any[]) => void
  info: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
}

export interface PluginUtils {
  exec: (command: string, options?: any) => Promise<{ stdout: string, stderr: string, exitCode: number }>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  exists: (path: string) => boolean
  expandPath: (path: string) => string
  formatTemplate: (template: string, variables: Record<string, string>) => string
}

// Hooks system types
export interface HooksConfig {
  // Shell lifecycle hooks
  'shell:init'?: HookConfig[]
  'shell:start'?: HookConfig[]
  'shell:stop'?: HookConfig[]
  'shell:exit'?: HookConfig[]

  // Command hooks
  'command:before'?: HookConfig[]
  'command:after'?: HookConfig[]
  'command:error'?: HookConfig[]

  // Prompt hooks
  'prompt:before'?: HookConfig[]
  'prompt:after'?: HookConfig[]
  'prompt:render'?: HookConfig[]

  // Directory hooks
  'directory:change'?: HookConfig[]
  'directory:enter'?: HookConfig[]
  'directory:leave'?: HookConfig[]

  // History hooks
  'history:add'?: HookConfig[]
  'history:search'?: HookConfig[]

  // Completion hooks
  'completion:before'?: HookConfig[]
  'completion:after'?: HookConfig[]

  // Custom hooks
  [key: string]: HookConfig[] | undefined
}

export interface HookConfig {
  name?: string
  enabled?: boolean
  command?: string
  script?: string
  function?: string
  plugin?: string
  priority?: number
  conditions?: (HookCondition | string)[]
  async?: boolean
  timeout?: number
}

export interface HookCondition {
  type: 'env' | 'file' | 'directory' | 'command' | 'custom'
  value: string
  operator?: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'exists' | 'not'
}

export interface HookContext {
  shell: Shell
  event: string
  data: any
  config: KrustyConfig
  environment: Record<string, string>
  cwd: string
  timestamp: number
}

export type HookHandler = (context: HookContext) => Promise<HookResult> | HookResult

export interface HookResult {
  success: boolean
  data?: any
  error?: string
  preventDefault?: boolean
  stopPropagation?: boolean
}
