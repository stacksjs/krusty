![Krusty Shell](.github/art/cover.jpg)

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Bun Version](https://img.shields.io/badge/dynamic/json?url=https://bundlejs.com/api/version?name=krusty&style=flat-square&label=bun&query=version&color=blue)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

# Krusty Shell

Krusty is a modern, feature-rich shell built with TypeScript and Bun. It provides a familiar shell experience with enhanced features, extensibility, and developer-friendly tooling.

## Features

- 🚀 **Performance**: Built on Bun
- 🧠 **Smart completion**: Context-aware command/file completions
- 🧩 **Aliases & functions**: Powerful aliasing and shell functions
- 🧵 **Pipelines & redirections**: Full `|`, `>`, `>>`, `2>&1`, here-strings, etc.
- 🧭 **Job control**: `jobs`, `bg`, `fg`, `kill`, `wait` with proper signal handling
- 📜 **Scripting**: if/then/else, for/while/until, case/esac, functions, and more
- 🎨 **Themes**: Configurable prompt with Git integration
- 🔌 **Plugins**: Extend functionality cleanly
- 🧪 **Tested**: Comprehensive test suite for reliability

## Quick start

```bash
# Install Krusty globally
bun add -g krusty
npm install -g krusty
yarn global add krusty
pnpm global add krusty

# Start the shell
krusty
```

## Built-in Commands

Krusty ships with a comprehensive set of built-ins. Run `help` for details.

### Core shell

- [`alias`](https://krusty.sh/commands/alias), [`unalias`](https://krusty.sh/commands/unalias) — manage aliases
- [`type`](https://krusty.sh/commands/type), [`which`](https://krusty.sh/commands/which), [`hash`](https://krusty.sh/commands/hash) — identify commands and hash lookups
- [`help`](https://krusty.sh/commands/help), [`history`](https://krusty.sh/commands/history) — builtin help and command history
- [`set`](https://krusty.sh/commands/set), [`export`](https://krusty.sh/commands/export), [`unset`](https://krusty.sh/commands/unset), [`umask`](https://krusty.sh/commands/umask) — shell/options and environment
- [`source`](https://krusty.sh/commands/source), [`eval`](https://krusty.sh/commands/eval), [`exec`](https://krusty.sh/commands/exec), [`read`](https://krusty.sh/commands/read) — script and execution helpers
- [`printf`](https://krusty.sh/commands/printf), [`echo`](https://krusty.sh/commands/echo), [`test`](https://krusty.sh/commands/test), [`true`](https://krusty.sh/commands/true), [`false`](https://krusty.sh/commands/false) — basic utilities
- [`time`](https://krusty.sh/commands/time), [`times`](https://krusty.sh/commands/times), [`trap`](https://krusty.sh/commands/trap), [`timeout`](https://krusty.sh/commands/timeout), [`getopts`](https://krusty.sh/commands/getopts) — timing, signals, option parsing
- [`command`](https://krusty.sh/commands/command) — run a command bypassing functions/aliases
- [`exit`](https://krusty.sh/commands/exit), [`pwd`](https://krusty.sh/commands/pwd), [`cd`](https://krusty.sh/commands/cd), [`dirs`](https://krusty.sh/commands/dirs), [`pushd`](https://krusty.sh/commands/pushd), [`popd`](https://krusty.sh/commands/popd) — navigation and exit
- [`env`](https://krusty.sh/commands/env), [`clear`](https://krusty.sh/commands/clear) — environment display and screen clear

### Jobs & processes

- [`jobs`](https://krusty.sh/commands/jobs) — list jobs
- [`bg`](https://krusty.sh/commands/bg) — resume a job in background
- [`fg`](https://krusty.sh/commands/fg) — bring a job to foreground
- [`kill`](https://krusty.sh/commands/kill) — send signals to jobs/processes
- [`disown`](https://krusty.sh/commands/disown) — remove jobs from job table
- [`wait`](https://krusty.sh/commands/wait) — wait for jobs to complete

### Developer utilities

- [`reload`](https://krusty.sh/commands/reload) — reload configuration
- [`library`](https://krusty.sh/commands/library) — manage/inspect libraries
- [`show`](https://krusty.sh/commands/show) — display information/details
- [`script-builtins`](https://krusty.sh/commands/script-builtins) — scripting helpers (internal)

### Networking & system helpers

- [`ip`](https://krusty.sh/commands/ip) — display IP info
- [`localip`](https://krusty.sh/commands/localip) — show local IP
- [`reloaddns`](https://krusty.sh/commands/reloaddns) — reload DNS cache

### Productivity helpers

- [`bookmark`](https://krusty.sh/commands/bookmark) — manage bookmarks/paths
- [`copyssh`](https://krusty.sh/commands/copyssh) — copy SSH public key
- [`dotfiles`](https://krusty.sh/commands/dotfiles) — dotfiles helper
- [`emptytrash`](https://krusty.sh/commands/emptytrash) — empty system trash
- [`ft`](https://krusty.sh/commands/ft) — quick fuzzy file helper
- [`hide`](https://krusty.sh/commands/hide) — hide/show files
- [`pstorm`](https://krusty.sh/commands/pstorm) — open in PhpStorm
- [`code`](https://krusty.sh/commands/code) — open in VS Code
- [`shrug`](https://krusty.sh/commands/shrug) — print ¯\\_(ツ)_/¯
- [`web`](https://krusty.sh/commands/web) — open URLs/web helpers
- [`wip`](https://krusty.sh/commands/wip) — work-in-progress helper

### Short aliases (quality-of-life)

- [`b`](https://krusty.sh/commands/b), [`bb`](https://krusty.sh/commands/bb), [`bd`](https://krusty.sh/commands/bd), [`bf`](https://krusty.sh/commands/bf), [`bi`](https://krusty.sh/commands/bi), [`bl`](https://krusty.sh/commands/bl), [`br`](https://krusty.sh/commands/br) — convenience wrappers

_Note: A few items are convenience helpers specific to Krusty and not POSIX/Bash standard._

## Usage

- Execute external commands and pipelines: `echo hi | tr a-z A-Z`
- Redirect output and duplicate FDs: `sh -c 'echo out; echo err 1>&2' 2>&1 | wc -l`
- Backgrounding and job control: `sleep 5 &` → `jobs` → `fg %1`

## Customization

### Aliases

Create command aliases in your `krusty.config.ts` file:

```typescript
export default {
  // ... other config
  aliases: {
    ll: 'ls -la',
    gs: 'git status',
  },
  // ... other config
}
```

### Themes

Theme configuration powers prompt styling and Git status:

```ts
export default {
  theme: {
    prompt: {
      left: '{cwd} ❯ ',
      right: '',
    },
    git: { enabled: true },
  },
}
```

### Environment Variables

Set environment variables in your `krusty.config.ts` file:

```typescript
export default {
  // ... other config
  env: {
    EDITOR: 'code',
    PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
  },
  // ... other config
}
```

## Scripting

Krusty includes a script engine with:

- Control flow: `if/then/else/fi`, `for/while/until`, `case/esac`
- Functions: `name() { … }` and `function name { … }`
- Built-ins: `source`, `test`, `true/false`, `local/declare/readonly`, `return/break/continue`

See `test/scripting.test.ts` for examples.

## Job Control

- Ctrl+Z suspends the foreground job (SIGTSTP), `bg` resumes in background, `fg` brings it back
- Ctrl+C sends SIGINT to the foreground job
- `kill -SIGNAL %n` sends signals to a job; `wait %n` awaits completion

## Development

```bash
# Clone the repository
git clone https://github.com/stacksjs/krusty.git
cd krusty

# Install dependencies
bun install

# Build the project
bun run build
```

## Testing

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/krusty/releases) page for more information on what has changed recently.

## Contributing

Please see [CONTRIBUTING](.github/CONTRIBUTING.md) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/krusty/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where Stacks is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## License

The MIT License (MIT). Please see [LICENSE](LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/krusty?style=flat-square
[npm-version-href]: https://npmjs.com/package/krusty
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/krusty/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/krusty/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/krusty/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/krusty -->
