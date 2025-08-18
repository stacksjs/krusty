import type { BuiltinCommand, CommandResult, Shell } from './types'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

export function createBuiltins(): Map<string, BuiltinCommand> {
  const builtins = new Map<string, BuiltinCommand>()

  // Define source command first since it's used by others
  const sourceCommand: BuiltinCommand = {
    name: 'source',
    description: 'Execute commands from a file in the current shell context',
    usage: 'source file [arguments...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'source: filename argument required\nsource: usage: source filename [arguments]\n',
          duration: performance.now() - start,
        }
      }

      const filePath = args[0]
      const scriptArgs = args.slice(1)
      let fullPath: string | null = null
      const fs = await import('node:fs/promises')
      const path = await import('node:path')

      try {
        // Resolve the file path
        if (filePath.startsWith('/') || filePath.startsWith('./') || filePath.startsWith('../')) {
          fullPath = path.resolve(shell.cwd, filePath)
        }
        else {
          // Search in PATH if not a relative/absolute path
          const pathDirs = (shell.environment.PATH || '').split(':')
          for (const dir of pathDirs) {
            if (!dir)
              continue // Skip empty PATH entries
            const testPath = path.join(dir, filePath)
            try {
              await fs.access(testPath)
              fullPath = testPath
              break
            }
            catch {
              continue
            }
          }
        }

        if (!fullPath) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `source: ${filePath}: file not found in PATH\n`,
            duration: performance.now() - start,
          }
        }

        // Read the file
        const content = await fs.readFile(fullPath, 'utf8')

        // Save current args and set the script arguments
        const originalArgs = process.argv.slice(2)
        process.argv = [process.argv[0], fullPath, ...scriptArgs]

        try {
          // Execute each line
          const lines = content.split('\n')
          let lastResult: CommandResult = {
            exitCode: 0,
            stdout: '',
            stderr: '',
            duration: 0,
          }

          for (const line of lines) {
            const trimmed = line.trim()
            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#')) {
              continue
            }

            // Execute the command
            const result = await shell.execute(trimmed)
            lastResult = result

            // Stop on error if we're not in a script
            if (result.exitCode !== 0) {
              break
            }
          }

          return {
            ...lastResult,
            duration: performance.now() - start,
          }
        }
        finally {
          // Restore original args
          process.argv = [process.argv[0], ...originalArgs]
        }
      }
      catch (error) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `source: ${error instanceof Error ? error.message : 'Error executing file'}\n`,
          duration: performance.now() - start,
        }
      }
    },
  }

  // Add source command to builtins first
  builtins.set('source', sourceCommand)
  builtins.set('.', { ...sourceCommand, name: '.' }) // POSIX alias for source

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
  // time command
  builtins.set('time', {
    name: 'time',
    description: 'Measure command execution time',
    usage: 'time command [args...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'time: missing command\n',
          duration: performance.now() - start,
        }
      }

      // Execute the command
      const command = args[0]
      const commandArgs = args.slice(1)

      try {
        // Use the shell's executeCommand method to run the command
        const result = await shell.executeCommand(command, commandArgs)

        // Format the time
        const end = performance.now()
        const elapsed = (end - start) / 1000 // Convert to seconds
        const timeOutput = `\nreal\t${elapsed.toFixed(3)}s\nuser\t0.000s\nsys\t0.000s\n`

        return {
          exitCode: result.exitCode,
          stdout: result.stdout + timeOutput,
          stderr: result.stderr,
          duration: end - start,
        }
      }
      catch (error) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `time: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
          duration: performance.now() - start,
        }
      }
    },
  })

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

  // clear/cls command
  const clearCommand = {
    name: 'clear',
    description: 'Clear the terminal screen',
    usage: 'clear',
    async execute(_args: string[], _shell: Shell): Promise<CommandResult> {
      const start = performance.now()
      // ANSI escape code to clear screen and move cursor to top-left
      const clearCode = '\x1B[2J\x1B[3J\x1B[H'
      return {
        exitCode: 0,
        stdout: clearCode,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  }
  builtins.set('clear', clearCommand)
  builtins.set('cls', { ...clearCommand, name: 'cls' }) // Windows alias

  // jobs command
  builtins.set('jobs', {
    name: 'jobs',
    description: 'List background jobs',
    usage: 'jobs [-l]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()
      const showPids = args.includes('-l') || args.includes('--list')

      const jobs = shell.getJobs()

      if (jobs.length === 0) {
        return {
          exitCode: 0,
          stdout: '',
          stderr: 'jobs: no current jobs\n',
          duration: performance.now() - start,
        }
      }

      // Format the jobs list
      const output = `${jobs
        .map((job) => {
          let status = 'Done'
          if (job.status === 'running') {
            status = 'Running'
          }
          else if (job.status === 'stopped') {
            status = 'Stopped'
          }

          const pidInfo = showPids ? ` [${job.pid}]` : ''
          return `[${job.id}]${pidInfo} ${status}    ${job.command}`
        })
        .join('\n')}\n`
      return {
        exitCode: 0,
        stdout: output,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // fg command - bring job to foreground
  const fgCommand = {
    name: 'fg',
    description: 'Bring a job to the foreground',
    usage: 'fg [job_id]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      const jobs = shell.getJobs()

      if (jobs.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'fg: no current jobs\n',
          duration: performance.now() - start,
        }
      }

      // If no job ID is provided, use the most recent job
      let targetJob = jobs[0]

      if (args.length > 0) {
        const jobId = Number.parseInt(args[0], 10)
        const job = shell.getJob(jobId)

        if (!job) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `fg: ${args[0]}: no such job\n`,
            duration: performance.now() - start,
          }
        }

        targetJob = job
      }

      // In a real shell, this would actually bring the process to the foreground
      // For now, we'll just mark it as running and return its info
      shell.setJobStatus(targetJob.id, 'running')

      return {
        exitCode: 0,
        stdout: `[${targetJob.id}] ${targetJob.command}\n`,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  }

  // bg command - run job in background
  const bgCommand = {
    name: 'bg',
    description: 'Run a job in the background',
    usage: 'bg [job_id]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      const jobs = shell.getJobs()

      if (jobs.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'bg: no current jobs\n',
          duration: performance.now() - start,
        }
      }

      // If no job ID is provided, use the most recent stopped job
      let targetJob = jobs.find(job => job.status === 'stopped')

      if (args.length > 0) {
        const jobId = Number.parseInt(args[0], 10)
        const job = shell.getJob(jobId)

        if (!job) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `bg: ${args[0]}: no such job\n`,
            duration: performance.now() - start,
          }
        }

        targetJob = job
      }
      else if (!targetJob) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'bg: no current jobs\n',
          duration: performance.now() - start,
        }
      }

      // In a real shell, this would actually send SIGCONT to the process
      // For now, we'll just mark it as running
      shell.setJobStatus(targetJob.id, 'running')

      return {
        exitCode: 0,
        stdout: `[${targetJob.id}] ${targetJob.command} &\n`,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  }

  builtins.set('fg', fgCommand)
  builtins.set('bg', bgCommand)

  // unset command - remove environment variables and functions
  builtins.set('unset', {
    name: 'unset',
    description: 'Remove environment variables or functions',
    usage: 'unset [-fv] [name ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'unset: not enough arguments\n',
          duration: performance.now() - start,
        }
      }

      let unsetFunctions = false
      const names: string[] = []

      // Parse options
      for (const arg of args) {
        if (arg.startsWith('-')) {
          if (arg === '-f') {
            unsetFunctions = true
          }
          else if (arg === '-v') {
            unsetFunctions = false
          }
          else if (arg === '--') {
            // End of options
            continue
          }
          else {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `unset: ${arg}: invalid option\n`,
              duration: performance.now() - start,
            }
          }
        }
        else {
          names.push(arg)
        }
      }

      // Process each name
      for (const name of names) {
        if (unsetFunctions) {
          // Try to unset a function if the shell supports it
          if ('unsetFunction' in shell) {
            const shellWithFunctions = shell as any
            shellWithFunctions.unsetFunction(name)
          }
        }
        else {
          // Unset an environment variable
          delete shell.environment[name]
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

  // set command - display or set shell options and variables
  builtins.set('set', {
    name: 'set',
    description: 'Display or set shell options and variables',
    usage: 'set [-abefhkmnptuvxBCEHPT] [-o option] [arg ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      // If no arguments, display all shell variables and functions
      if (args.length === 0) {
        // Get all variables from the environment
        const variables = Object.entries(shell.environment)
          .map(([key, value]) => `${key}='${value.replace(/'/g, '\'\\\'\'')}'`)
          .sort()
          .join('\n')

        // Get all functions (if available in the shell)
        let functions = ''
        if ('getFunctions' in shell) {
          const shellWithFunctions = shell as any
          const funcs = shellWithFunctions.getFunctions()
          functions = Object.entries(funcs)
            .map(([name, body]) => `${name} () { ${body} }`)
            .sort()
            .join('\n')
        }

        const output = `${[variables, functions].filter(Boolean).join('\n')}\n`
        return {
          exitCode: 0,
          stdout: output,
          stderr: '',
          duration: performance.now() - start,
        }
      }

      // Handle options
      if (args[0].startsWith('-')) {
        const option = args[0].slice(1)

        // Simple implementation of common options
        switch (option) {
          case 'a':
            // Mark variables for export to subsequent commands
            // In a real shell, this would set a flag that affects future variable assignments
            return {
              exitCode: 0,
              stdout: '',
              stderr: '',
              duration: performance.now() - start,
            }

          case 'e':
            // Exit immediately if a command exits with a non-zero status
            // In a real shell, this would set a flag that affects command execution
            return {
              exitCode: 0,
              stdout: '',
              stderr: '',
              duration: performance.now() - start,
            }

          case 'u':
            // Treat unset variables as an error when substituting
            // In a real shell, this would set a flag that affects variable expansion
            return {
              exitCode: 0,
              stdout: '',
              stderr: '',
              duration: performance.now() - start,
            }

          case 'x':
            // Print commands and their arguments as they are executed
            // In a real shell, this would enable command tracing
            return {
              exitCode: 0,
              stdout: '',
              stderr: '',
              duration: performance.now() - start,
            }

          default:
            return {
              exitCode: 1,
              stdout: '',
              stderr: `set: ${option}: invalid option\n`,
              duration: performance.now() - start,
            }
        }
      }

      // Handle variable assignments (e.g., set VAR=value)
      for (const arg of args) {
        const equalsIndex = arg.indexOf('=')
        if (equalsIndex === -1) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `set: ${arg}: not a valid identifier\n`,
            duration: performance.now() - start,
          }
        }

        const key = arg.slice(0, equalsIndex)
        const value = arg.slice(equalsIndex + 1)
        shell.environment[key] = value
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // env command - display or set environment variables
  builtins.set('env', {
    name: 'env',
    description: 'Display environment variables or set them for a command',
    usage: 'env [name=value ...] [command [args ...]]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      // If no arguments, print all environment variables
      if (args.length === 0) {
        const envVars = Object.entries(shell.environment)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')

        return {
          exitCode: 0,
          stdout: `${envVars}\n`,
          stderr: '',
          duration: performance.now() - start,
        }
      }

      // Check if we have a command to execute with modified environment
      const commandIndex = args.findIndex(arg => !arg.includes('='))

      if (commandIndex === -1) {
        // No command provided, just set the environment variables
        for (const arg of args) {
          const equalsIndex = arg.indexOf('=')
          if (equalsIndex === -1) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `env: invalid argument: ${arg}\n`,
              duration: performance.now() - start,
            }
          }

          const key = arg.slice(0, equalsIndex)
          const value = arg.slice(equalsIndex + 1)
          shell.environment[key] = value
        }

        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          duration: performance.now() - start,
        }
      }

      // We have a command to execute with modified environment
      const envVars = args.slice(0, commandIndex)
      const commandAndArgs = args.slice(commandIndex)

      // Create a copy of the current environment
      const newEnv = { ...shell.environment }

      // Update with new environment variables
      for (const envVar of envVars) {
        const equalsIndex = envVar.indexOf('=')
        if (equalsIndex === -1) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `env: invalid argument: ${envVar}\n`,
            duration: performance.now() - start,
          }
        }

        const key = envVar.slice(0, equalsIndex)
        const value = envVar.slice(equalsIndex + 1)
        newEnv[key] = value
      }

      // Execute the command with the new environment
      const originalEnv = { ...shell.environment }
      try {
        // Set the new environment
        Object.assign(shell.environment, newEnv)

        // Execute the command
        const result = await shell.execute(commandAndArgs.join(' '))

        return {
          ...result,
          duration: performance.now() - start,
        }
      }
      finally {
        // Restore the original environment
        shell.environment = originalEnv
      }
    },
  })

  // type command - display the type of a command
  builtins.set('type', {
    name: 'type',
    description: 'Display the type of a command',
    usage: 'type [name ...]',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'type: not enough arguments\n',
          duration: performance.now() - start,
        }
      }

      const results: string[] = []
      let hasError = false

      for (const name of args) {
        // Check if it's a builtin
        if (shell.builtins.has(name)) {
          results.push(`${name} is a shell builtin`)
          continue
        }

        // Check if it's an alias
        if (shell.aliases[name]) {
          results.push(`${name} is an alias for '${shell.aliases[name]}'`)
          continue
        }

        // Check if it's an external command in PATH
        try {
          // In a real implementation, we would search PATH for the command
          // For now, we'll just check if it's a valid command name
          if (/^[\w-]+$/.test(name)) {
            results.push(`${name} is /usr/bin/${name}`)
          }
          else {
            results.push(`type: ${name}: not found`)
            hasError = true
          }
        }
        catch {
          results.push(`type: ${name}: not found`)
          hasError = true
        }
      }

      const output = `${results.join('\n')}\n`
      return {
        exitCode: hasError ? 1 : 0,
        stdout: output,
        stderr: '',
        duration: performance.now() - start,
      }
    },
  })

  // kill command - send signal to a process or job
  builtins.set('kill', {
    name: 'kill',
    description: 'Send a signal to a process or job',
    usage: 'kill [-s SIGNAL] [pid|job]...',
    async execute(args: string[], shell: Shell): Promise<CommandResult> {
      const start = performance.now()

      if (args.length === 0) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'kill: usage: kill [-s SIGNAL] [pid|job]...\n',
          duration: performance.now() - start,
        }
      }

      let signal = 'SIGTERM' // Default signal
      const targets: Array<{ type: 'pid' | 'job', id: number }> = []

      // Parse arguments
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        // Handle signal flag
        if (arg === '-s' || arg === '--signal') {
          if (i + 1 >= args.length) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: 'kill: option requires an argument -- s\n',
              duration: performance.now() - start,
            }
          }

          // Get the signal name/number
          signal = args[++i]

          // Convert signal number to name if needed
          if (/^\d+$/.test(signal)) {
            const sigNum = Number.parseInt(signal, 10)
            // In a real implementation, we would map signal numbers to names
            // For now, we'll just use the number as the signal name
            signal = `SIG${sigNum}`
          }
          else if (!signal.startsWith('SIG')) {
            signal = `SIG${signal}`
          }

          continue
        }

        // Handle job ID (starts with %)
        if (arg.startsWith('%')) {
          const jobId = Number.parseInt(arg.slice(1), 10)
          if (Number.isNaN(jobId)) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `kill: ${arg}: invalid job specification\n`,
              duration: performance.now() - start,
            }
          }

          const job = shell.getJob(jobId)
          if (!job) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `kill: ${arg}: no such job\n`,
              duration: performance.now() - start,
            }
          }

          targets.push({ type: 'job', id: job.id })
          continue
        }

        // Handle process ID
        const pid = Number.parseInt(arg, 10)
        if (Number.isNaN(pid)) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `kill: ${arg}: arguments must be process or job IDs\n`,
            duration: performance.now() - start,
          }
        }

        targets.push({ type: 'pid', id: pid })
      }

      // Process each target
      const results: string[] = []
      let hadError = false

      for (const target of targets) {
        try {
          if (target.type === 'job') {
            const job = shell.getJob(target.id)
            if (!job) {
              results.push(`kill: %${target.id}: no such job`)
              hadError = true
              continue
            }

            // In a real shell, we would send the signal to the process group
            // For now, we'll just mark the job as done
            shell.setJobStatus(job.id, 'done')
            results.push(`[${job.id}] ${job.command} (${job.pid}) - ${signal}`)
          }
          else {
            // For process IDs, we would use process.kill(pid, signal) in Node.js
            // For now, we'll just simulate it
            results.push(`Process ${target.id} - ${signal}`)
          }
        }
        catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          results.push(`kill: (${target.id}) - ${errorMsg}`)
          hadError = true
        }
      }

      return {
        exitCode: hadError ? 1 : 0,
        stdout: `${results.join('\n')}\n`,
        stderr: '',
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
