import type { BuiltinCommand, CommandResult, Shell } from './types'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, statSync } from 'node:fs'

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
      } catch (error) {
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
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
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
        const parsed = parseInt(args[nIndex + 1], 10)
        if (!isNaN(parsed) && parsed > 0) {
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
    description: 'Create or display aliases',
    usage: 'alias [name[=value] ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        // Display all aliases
        const output = Object.entries(shell.aliases)
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
          // Set alias
          const [name, ...valueParts] = arg.split('=')
          const value = valueParts.join('=').replace(/^["']|["']$/g, '')
          shell.aliases[name] = value
        } else {
          // Display specific alias
          if (shell.aliases[arg]) {
            return {
              exitCode: 0,
              stdout: `${arg}=${shell.aliases[arg]}\n`,
              stderr: '',
              duration: performance.now() - start,
            }
          } else {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `alias: ${arg}: not found\n`,
              duration: performance.now() - start,
            }
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

  // unalias command
  builtins.set('unalias', {
    name: 'unalias',
    description: 'Remove aliases',
    usage: 'unalias [-a] name [name ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.includes('-a')) {
        // Remove all aliases
        Object.keys(shell.aliases).forEach(key => {
          delete shell.aliases[key]
        })
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
        } else {
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
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
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
        const parsed = parseInt(args[0], 10)
        if (isNaN(parsed)) {
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

  return builtins
}
