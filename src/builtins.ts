import type { BuiltinCommand, CommandResult, Shell } from './types'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

export function createBuiltins(): Map<string, BuiltinCommand> {
  const builtins = new Map<string, BuiltinCommand>()

  // cd command
  builtins.set('cd', {
    name: 'cd',
    description: 'Change the current directory',
    usage: 'cd [directory]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      try {
        let targetDir = args[0] || homedir()

        // Handle tilde expansion
        if (targetDir.startsWith('~')) {
          targetDir = targetDir.replace('~', homedir())
        }

        // Handle relative paths
        if (!targetDir.startsWith('/')) {
          targetDir = resolve(shell.cwd, targetDir)
        }

        if (!existsSync(targetDir)) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `cd: ${args[0]}: No such file or directory\n`,
            duration: performance.now() - start,
          }
        }

        const stat = statSync(targetDir)
        if (!stat.isDirectory()) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `cd: ${args[0]}: Not a directory\n`,
            duration: performance.now() - start,
          }
        }

        const success = shell.changeDirectory(targetDir)
        return {
          exitCode: success ? 0 : 1,
          stdout: '',
          stderr: success ? '' : `cd: ${args[0]}: Permission denied\n`,
          duration: performance.now() - start,
        }
      }
      catch (error) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `cd: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
          duration: performance.now() - start,
        }
      }
    },
  })

  // pwd command
  builtins.set('pwd', {
    name: 'pwd',
    description: 'Print the current working directory',
    usage: 'pwd',
    async execute(_args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()
      return {
        exitCode: 0,
        stdout: `${shell.cwd}\n`,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // history command
  builtins.set('history', {
    name: 'history',
    description: 'Display command history',
    usage: 'history [-c] [-n number]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.includes('-c')) {
        shell.history.length = 0
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        }
      }

      let limit = shell.history.length
      const nIndex = args.indexOf('-n')
      if (nIndex !== -1 && args[nIndex + 1]) {
        const parsed = Number.parseInt(args[nIndex + 1], 10)
        if (!Number.isNaN(parsed) && parsed > 0) {
          limit = parsed
        }
      }

      const historyToShow = shell.history.slice(-limit)
      const output = historyToShow
        .map((cmd, index) => `${String(shell.history.length - limit + index + 1).padStart(5)} ${cmd}`)
        .join('\n')

      return {
        exitCode: 0,
        stdout: output ? `${output}\n` : '',
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // alias command
  builtins.set('alias', {
    name: 'alias',
    description: 'Define or display aliases',
    usage: 'alias [name[=value] ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      // Helper function to format alias output in the format: name=value
      const formatAlias = (name: string, value: string): string => {
        return `${name}=${value}`
      }

      // If no arguments, list all aliases
      if (args.length === 0) {
        const aliases = Object.entries(shell.aliases)
          .map(([name, value]) => formatAlias(name, value))
          .sort()
          .join('\n')

        return {
          exitCode: 0,
          stdout: aliases + (aliases ? '\n' : ''),
          stderr: '',
          duration: performance.now() - start,
        }
      }

      if (args.length === 1 && !args[0].includes('=')) {
        const aliasName = args[0].trim()
        if (aliasName in shell.aliases) {
          return {
            exitCode: 0,
            stdout: `${formatAlias(aliasName, shell.aliases[aliasName])}\n`,
            stderr: '',
            duration: performance.now() - start,
          }
        }
        else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `alias: ${aliasName}: not found\n`,
            duration: performance.now() - start,
          }
        }
      }

      // Reconstruct and parse definitions: support spaces and '=' in values.
      // We'll iterate tokens and group them into name=value definitions by using the first '='
      // When reconstructing the value, re-quote tokens that require quoting so that
      // complex values are preserved as expected by tests.
      const quoteIfNeeded = (s: string): string => {
        // Needs quoting if contains whitespace or shell-special characters
        const needs = /[\s"'!@#$%^&*()[\]|;<>?]/.test(s)
        if (!needs)
          return s
        // Prefer single quotes, escape internal single quotes by closing/opening
        return `'${s.replace(/'/g, '\'\\\'\'')}'`
      }
      let i = 0
      while (i < args.length) {
        const token = args[i]
        if (!token || !token.trim()) {
          i++
          continue
        }

        const eq = token.indexOf('=')
        if (eq === -1) {
          // No '=' in this token -> treat as lookup for specific alias
          const aliasNameLookup = token.trim()
          if (aliasNameLookup in shell.aliases) {
            return {
              exitCode: 0,
              stdout: `${formatAlias(aliasNameLookup, shell.aliases[aliasNameLookup])}\n`,
              stderr: '',
              duration: performance.now() - start,
            }
          }
          else {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `alias: ${aliasNameLookup}: not found\n`,
              duration: performance.now() - start,
            }
          }
        }

        // Start of a definition
        let aliasName = token.substring(0, eq).trim()
        const valuePart = token.substring(eq + 1)

        if (!aliasName) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'alias: invalid empty alias name\n',
            duration: performance.now() - start,
          }
        }

        // Consume all remaining tokens as part of the value
        const extraParts: string[] = []
        i++
        while (i < args.length) {
          extraParts.push(args[i])
          i++
        }

        // Build alias value: keep the first part (from the same token) as-is, only quote subsequent tokens if needed.
        const aliasValue = [valuePart, ...extraParts.map(quoteIfNeeded)].join(' ')

        // Do not strip quotes here; we intentionally keep them when needed

        // If the alias name is quoted, remove the quotes
        if ((aliasName.startsWith('"') && aliasName.endsWith('"'))
          || (aliasName.startsWith('\'') && aliasName.endsWith('\''))) {
          aliasName = aliasName.slice(1, -1)
        }

        shell.aliases[aliasName] = aliasValue
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // unalias command
  builtins.set('unalias', {
    name: 'unalias',
    description: 'Remove aliases',
    usage: 'unalias [-a] name [name ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args[0] === '-a') {
        // Remove all aliases
        for (const key of Object.keys(shell.aliases)) {
          delete shell.aliases[key]
        }
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        }
      }

      for (const name of args) {
        if (shell.aliases[name]) {
          delete shell.aliases[name]
        }
        else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `unalias: ${name}: not found\n`,
            duration: performance.now() - start,
          }
        }
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // export command
  builtins.set('export', {
    name: 'export',
    description: 'Set environment variables',
    usage: 'export [name[=value] ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        // Display all environment variables
        const output = Object.entries(shell.environment)
          .map(([name, value]) => `${name}=${value}`)
          .join('\n')

        return {
          exitCode: 0,
          stdout: output ? `${output}\n` : '',
          stderr: '',
          duration: performance.now() - start,
        }
      }

      for (const arg of args) {
        if (arg.includes('=')) {
          const [name, ...valueParts] = arg.split('=')
          const value = valueParts.join('=').replace(/^["']|["']$/g, '')
          shell.environment[name] = value
          process.env[name] = value // Also set in process environment
        }
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // echo command
  builtins.set('echo', {
    name: 'echo',
    description: 'Display text',
    usage: 'echo [-n] [string ...]',
    async execute(args: string[], _shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      let noNewline = false
      let textArgs = args

      if (args[0] === '-n') {
        noNewline = true
        textArgs = args.slice(1)
      }

      const output = textArgs.join(' ')

      return {
        exitCode: 0,
        stdout: noNewline ? output : `${output}\n`,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // exit command
  builtins.set('exit', {
    name: 'exit',
    description: 'Exit the shell',
    usage: 'exit [code]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      let exitCode = 0
      if (args[0]) {
        const parsed = Number.parseInt(args[0], 10)
        if (Number.isNaN(parsed)) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'exit: numeric argument required\n',
            duration: performance.now() - start,
          }
        }
        exitCode = parsed
      }

      // Signal shell to exit
      shell.stop()

      return {
        exitCode,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // help command
  builtins.set('help', {
    name: 'help',
    description: 'Display help information',
    usage: 'help [command]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        // Display all commands
        const output = Array.from(shell.builtins.values())
          .map(cmd => `${cmd.name.padEnd(12)} ${cmd.description}`)
          .join('\n')

        return {
          exitCode: 0,
          stdout: `Built-in commands:\n${output}\n\nUse 'help <command>' for detailed information.\n`,
          stderr: '',
          duration: performance.now() - start,
        }
      }

      const commandName = args[0]
      const command = shell.builtins.get(commandName)

      if (!command) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `help: Unknown command: ${commandName}\n`,
          duration: performance.now() - start,
        }
      }

      return {
        exitCode: 0,
        stdout: `${command.name}: ${command.description}\nUsage: ${command.usage}\n`,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // which command
  builtins.set('which', {
    name: 'which',
    description: 'Locate a command (alias, builtin, or executable)',
    usage: 'which name [name ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'which: missing arguments\n',
          duration: performance.now() - start,
        }
      }

      const outputs: string[] = []
      let anyMissing = false

      // Helper to check PATH executables
      const pathVar = shell.environment.PATH || process.env.PATH || ''
      const pathEntries = pathVar.split(':').filter(Boolean)

      const isExecutable = (p: string) => {
        try {
          const st = statSync(p)
          return st.isFile() && (st.mode & 0o111) !== 0
        }
        catch {
          return false
        }
      }

      for (const name of args) {
        let found = false

        // Alias
        if (Object.prototype.hasOwnProperty.call(shell.aliases, name)) {
          outputs.push(`\`${name}\`: aliased to \`${shell.aliases[name]}\``)
          found = true
        }

        // Builtin
        if (shell.builtins.has(name)) {
          outputs.push(`\`${name}\`: shell builtin`)
          found = true
        }

        // PATH search
        for (const dir of pathEntries) {
          const full = resolve(dir, name)
          if (isExecutable(full)) {
            outputs.push(`\`${full}\``)
            found = true
            break // mimic common which behavior: first match
          }
        }

        if (!found) {
          anyMissing = true
        }
      }

      return {
        exitCode: anyMissing ? 1 : 0,
        stdout: outputs.length ? `${outputs.join('\n')}\n` : '',
        stderr: anyMissing ? 'which: some commands not found\n' : '',
        duration: performance.now() - start,
      }
    },
  })

  // reload command
  builtins.set('reload', {
    name: 'reload',
    description: 'Reload krusty configuration, aliases, env, and plugins',
    usage: 'reload',
    async execute(_args: string[], shell: Shell): Promise<CommandResult> {
      return await shell.reload()
    },
  })

  return builtins
}
