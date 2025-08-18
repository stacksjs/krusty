![Krusty Shell](.github/art/cover.jpg)

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Bun Version](https://img.shields.io/badge/dynamic/json?url=https://bundlejs.com/api/version?name=krusty&style=flat-square&label=bun&query=version&color=blue)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

# Krusty Shell

Krusty is a modern, feature-rich shell built with TypeScript and Bun. It provides a familiar shell experience with enhanced features, extensibility, and developer-friendly tooling.

## Features

- 🚀 **Performant** - Built on Bun for exceptional performance
- 🔍 **Intelligent Tab Completion** - Context-aware command and file completion
- 📝 **Scripting Support** - Write complex shell scripts with JavaScript/TypeScript
- 🔧 **Extensible** - Easily add custom commands and plugins
- 🎨 **Themable** - Customize the look and feel to your preference
- 🔄 **Modern Syntax** - Supports modern shell features and operators
- 📦 **Built-in Package Manager** - Manage your shell extensions with ease
- 🧪 **Tested** - Comprehensive test suite for reliability

## Installation

```bash
# Install Krusty globally
bun add -g krusty

# Start the shell
krusty
```

## Built-in Commands

Krusty comes with a variety of built-in commands:

### File Operations

- `cd` - Change directory
- `ls` - List directory contents
- `pwd` - Print working directory

### Process Management

- `jobs` - List background jobs
- `fg` - Bring job to foreground
- `bg` - Run job in background
- `kill` - Send signal to process

### Environment

- `env` - Display or set environment variables
- `set` - Set shell options and variables
- `unset` - Remove variables or functions
- `export` - Set environment variables

### Utilities

- `alias` - Create command aliases
- `type` - Display command type information
- `time` - Time command execution
- `source` - Execute commands from a file

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

Please see our [releases](https://github.com/stackjs/krusty/releases) page for more information on what has changed recently.

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
