import type { KrustyConfig } from './types'
import { loadConfig } from 'bunfig'

export const defaultConfig: KrustyConfig = {
  verbose: false,
  streamOutput: true,
  logging: {
    prefixes: {
      debug: 'DEBUG',
      info: 'INFO',
      warn: 'WARN',
      error: 'ERROR',
    },
  },
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
    file: '~/.krusty_history',
    ignoreDuplicates: true,
    ignoreSpace: true,
    searchMode: 'fuzzy',
  },
  completion: {
    // Enable/disable completion system
    enabled: true,
    // Case sensitivity for completions
    caseSensitive: false,
    // Show descriptions with completions
    showDescriptions: true,
    // Maximum number of suggestions to show
    maxSuggestions: 10,
    // Enable completion caching
    cache: {
      enabled: true,
      // Cache expiration in milliseconds (1 hour)
      ttl: 60 * 60 * 1000,
      // Maximum number of completions to cache
      maxEntries: 1000,
    },
    // Context-aware completion settings
    context: {
      // Enable context-aware completions
      enabled: true,
      // Maximum depth to analyze context
      maxDepth: 3,
      // File types to analyze for context
      fileTypes: ['.ts', '.js', '.tsx', '.jsx', '.json', '.md'],
    },
    // Command-specific completion settings
    commands: {
      git: {
        // Enable git completions
        enabled: true,
        // Include porcelain commands
        includePorcelain: true,
        // Include plumbing commands
        includePlumbing: false,
      },
      npm: {
        // Enable npm completions
        enabled: true,
        // Include script names from package.json
        includeScripts: true,
      },
    },
  },
  aliases: {
    // Stage all changes and open a commit message prompt
    commit: 'git add .; git commit -m',
    // Work-in-progress: create a WIP commit and push with styled, informative output
    // - Show concise status and staged diff before committing
    // - Suppress commit's own summary (-q) to avoid duplicate info
    // - Skip commit/push if no staged changes are present
    // - Only run post-commit log and push if commit succeeds
    wip: 'printf \'\\x1b[2m\\x1b[36m─── WIP start ───\\x1b[0m\\n\'; git --no-pager -c color.ui=always status -sb; git -c color.ui=always add -A; printf \'\\x1b[2mstaged summary\\x1b[0m\\n\'; git --no-pager -c color.ui=always diff --cached --stat; git diff --cached --quiet && printf \'\\x1b[2m\\x1b[33mno changes to commit; skipping push\\x1b[0m\\n\' || git -c color.ui=always commit -m \'chore: wip\' -q && printf \'\\x1b[2mcommit (last)\\x1b[0m\\n\' && git --no-pager -c color.ui=always log -1 --oneline && printf \'\\x1b[2m\\x1b[36m─── pushing ───\\x1b[0m\\n\' && git -c color.ui=always push; printf \'\\x1b[2m\\x1b[32m─── done ───\\x1b[0m\\n\'',
    // Push current branch
    push: 'git push',
  },
  environment: {},
  // Plugin system configuration
  plugins: [
    // Example plugin configuration:
    // {
    //   name: 'example-plugin',
    //   enabled: true,
    //   path: './plugins/example',
    //   config: {}
    // }
  ],
  theme: {
    // Theme name to use (must match a theme in themes/ directory)
    name: 'default',
    // Auto-detect system color scheme
    autoDetectColorScheme: true,
    // Default color scheme (light/dark/auto)
    defaultColorScheme: 'auto',
    // Enable right prompt
    enableRightPrompt: true,
    // Git status in prompt settings
    gitStatus: {
      enabled: true,
      showStaged: true,
      showUnstaged: true,
      showUntracked: true,
      showAheadBehind: true,
      format: '({branch}{ahead}{behind}{staged}{unstaged}{untracked})',
    },
    // Prompt configuration
    prompt: {
      left: '\u001B[32m{user}@{host}\u001B[0m \u001B[34m{path}\u001B[0m {git}{symbol} ',
      right: '{time}{jobs}{status}',
      continuation: '... ',
      error: '\u001B[31m{code}\u001B[0m',
    },
    // Colors configuration
    colors: {
      primary: '#00D9FF',
      secondary: '#FF6B9D',
      success: '#00FF88',
      warning: '#FFD700',
      error: '#FF4757',
      info: '#74B9FF',
      // Git status colors
      git: {
        branch: '#F8F8F2',
        ahead: '#50FA7B',
        behind: '#FF5555',
        staged: '#50FA7B',
        unstaged: '#FFB86C',
        untracked: '#FF79C6',
        conflict: '#FF5555',
      },
    },
    // Font configuration
    font: {
      // Default to system monospace font stack with fallbacks
      family: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
      size: 14,
      weight: 'normal',
      lineHeight: 1.4,
      ligatures: false,
    },
    // Symbol configuration
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
        conflict: '✗',
      },
    },
  },
  modules: {
    // Language modules - enabled by default
    bun: { enabled: true, format: 'via {symbol} {version}', symbol: '🥟' },
    deno: { enabled: true, format: 'via {symbol} {version}', symbol: '🦕' },
    nodejs: { enabled: true, format: 'via {symbol} {version}', symbol: '⬢' },
    python: { enabled: true, format: 'via {symbol} {version}', symbol: '🐍' },
    golang: { enabled: true, format: 'via {symbol} {version}', symbol: '🐹' },
    java: { enabled: true, format: 'via {symbol} {version}', symbol: '☕' },
    kotlin: { enabled: true, format: 'via {symbol} {version}', symbol: '🅺' },
    php: { enabled: true, format: 'via {symbol} {version}', symbol: '🐘' },
    ruby: { enabled: true, format: 'via {symbol} {version}', symbol: '💎' },
    swift: { enabled: true, format: 'via {symbol} {version}', symbol: '🐦' },
    zig: { enabled: true, format: 'via {symbol} {version}', symbol: '⚡' },
    lua: { enabled: true, format: 'via {symbol} {version}', symbol: '🌙' },
    perl: { enabled: true, format: 'via {symbol} {version}', symbol: '🐪' },
    rlang: { enabled: true, format: 'via {symbol} {version}', symbol: '📊' },
    dotnet: { enabled: true, format: 'via {symbol} {version}', symbol: '.NET' },
    erlang: { enabled: true, format: 'via {symbol} {version}', symbol: 'E' },
    c: { enabled: true, format: 'via {symbol} {version}', symbol: 'C' },
    cpp: { enabled: true, format: 'via {symbol} {version}', symbol: 'C++' },
    cmake: { enabled: true, format: 'via {symbol} {version}', symbol: '△' },
    terraform: { enabled: true, format: 'via {symbol} {version}', symbol: '💠' },
    pulumi: { enabled: true, format: 'via {symbol} {version}', symbol: '🧊' },

    // Cloud modules
    aws: { enabled: true, format: 'on {symbol} {profile}({region})', symbol: '☁️' },
    azure: { enabled: true, format: 'on {symbol} {subscription}', symbol: '󰠅' },
    gcloud: { enabled: true, format: 'on {symbol} {project}', symbol: '☁️' },

    // Git modules
    git_branch: {
      enabled: true,
      format: 'on {symbol} {branch}',
      symbol: '',
      truncation_length: 20,
      truncation_symbol: '…',
    },
    git_commit: { enabled: true, format: '({hash})', commit_hash_length: 7 },
    git_state: { enabled: true, format: '({state})' },
    git_status: { enabled: true, format: '[{status}]' },
    git_metrics: { enabled: true, format: '({metrics})' },

    // System modules
    os: { enabled: false, format: 'on {symbol} {name}' }, // Disabled by default
    hostname: { enabled: true, format: '@{hostname}', ssh_only: true },
    directory: {
      enabled: true,
      format: '{path}',
      truncation_length: 3,
      truncate_to_repo: true,
      home_symbol: '~',
    },
    username: { enabled: true, format: '{username}', show_always: false },
    shell: { enabled: false, format: '{indicator}' }, // Disabled by default
    battery: {
      enabled: true,
      format: '{symbol} {percentage}%',
      full_symbol: '🔋',
      charging_symbol: '🔌',
      discharging_symbol: '🔋',
      unknown_symbol: '🔋',
      empty_symbol: '🪫',
    },
    cmd_duration: {
      enabled: true,
      format: 'took {duration}',
      min_time: 2000,
      show_milliseconds: false,
    },
    memory_usage: {
      enabled: false, // Disabled by default
      format: '🐏 {ram}',
      threshold: 75,
      symbol: '🐏',
    },
    time: { enabled: false, format: '🕐 {time}' }, // Disabled by default
    nix_shell: {
      enabled: true,
      format: 'via {symbol} {state}',
      symbol: '❄️',
      impure_msg: 'impure',
      pure_msg: 'pure',
      unknown_msg: 'shell',
    },

    // Custom modules can be added by users in their config
    env_var: {},
    custom: {},
  },

  // Hooks configuration
  hooks: {
    // Shell lifecycle hooks
    'shell:init': [],
    'shell:start': [],
    'shell:stop': [],
    'shell:exit': [],

    // Command hooks
    'command:before': [],
    'command:after': [],
    'command:error': [],

    // Prompt hooks
    'prompt:before': [],
    'prompt:after': [],
    'prompt:render': [],

    // Directory hooks
    'directory:change': [],
    'directory:enter': [],
    'directory:leave': [],

    // History hooks
    'history:add': [],
    'history:search': [],

    // Completion hooks
    'completion:before': [],
    'completion:after': [],
  },
}

// Use a function to avoid top-level await issues
export const config: KrustyConfig = (() => {
  try {
    return loadConfig({
      name: 'krusty',
      defaultConfig,
    }) as any
  }
  catch {
    return defaultConfig
  }
})()

// Provide a reusable loader that always fetches the latest config from disk
export async function loadKrustyConfig(): Promise<KrustyConfig> {
  return await loadConfig({
    name: 'krusty',
    defaultConfig,
  })
}
