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
    enabled: true,
    caseSensitive: false,
    showDescriptions: true,
    maxSuggestions: 10,
  },
  aliases: {
    // Stage all changes and open a commit message prompt
    commit: 'git add .; git commit -m',
    // Work-in-progress: use the commit alias to create a WIP commit and then push
    wip: "commit 'chore: wip'; push",
    // Push current branch
    push: 'git push',
  },
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
    font: {
      // Default to system monospace font stack with fallbacks
      family: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
      size: 14,
      weight: 'normal',
      lineHeight: 1.4,
      ligatures: false,
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

// eslint-disable-next-line antfu/no-top-level-await
export const config: KrustyConfig = await loadConfig({
  name: 'krusty',
  defaultConfig,
})

// Provide a reusable loader that always fetches the latest config from disk
export async function loadKrustyConfig(): Promise<KrustyConfig> {
  return await loadConfig({
    name: 'krusty',
    defaultConfig,
  })
}
