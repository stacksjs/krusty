#!/usr/bin/env bun
import process from 'node:process'
import { CAC } from 'cac'
import { version } from '../package.json'
import { config } from '../src/config'
import { BunshShell } from '../src/shell'

const cli = new CAC('bunsh')

interface CliOptions {
  verbose?: boolean
  config?: string
}

// Default command - start the shell
cli
  .command('[...args]', 'Start the Bunsh shell', { allowUnknownOptions: true })
  .option('--verbose', 'Enable verbose logging')
  .option('--config <config>', 'Path to config file')
  .action(async (args: string[], options: CliOptions) => {
    // If arguments are provided, execute them as a command
    if (args.length > 0) {
      const shell = new BunshShell({ ...config, verbose: options.verbose ?? config.verbose })
      const command = args.join(' ')
      const result = await shell.execute(command)

      if (result.stdout)
        process.stdout.write(result.stdout)
      if (result.stderr)
        process.stderr.write(result.stderr)

      process.exit(result.exitCode)
    }
    else {
      // Start interactive shell
      const shell = new BunshShell({ ...config, verbose: options.verbose ?? config.verbose })

      // Welcome message
      process.stdout.write(`Welcome to Bunsh v${version}\n`)
      process.stdout.write('Type "help" for available commands or "exit" to quit.\n\n')

      // Graceful shutdown handlers
      const onSigint = async () => {
        try {
          shell.stop()
        }
        finally {
          process.stdout.write('\n')
          process.exit(130) // 128 + SIGINT
        }
      }
      const onSigterm = async () => {
        try {
          shell.stop()
        }
        finally {
          process.exit(143) // 128 + SIGTERM
        }
      }
      process.on('SIGINT', onSigint)
      process.on('SIGTERM', onSigterm)

      try {
        await shell.start()
      }
      catch (err: any) {
        process.stderr.write(`Shell error: ${err?.message ?? String(err)}\n`)
        process.exitCode = 1
      }
      finally {
        process.off('SIGINT', onSigint)
        process.off('SIGTERM', onSigterm)
      }
    }
  })

// Explicit shell command
cli
  .command('shell', 'Start the interactive shell')
  .option('--verbose', 'Enable verbose logging')
  .option('--config <config>', 'Path to config file')
  .action(async (options: CliOptions) => {
    const shell = new BunshShell({ ...config, verbose: options.verbose ?? config.verbose })

    // Welcome message
    process.stdout.write(`Welcome to Bunsh v${version}\n`)
    process.stdout.write('Type "help" for available commands or "exit" to quit.\n\n')

    const onSigint = async () => {
      try {
        shell.stop()
      }
      finally {
        process.stdout.write('\n')
        process.exit(130)
      }
    }
    const onSigterm = async () => {
      try {
        shell.stop()
      }
      finally {
        process.exit(143)
      }
    }
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)

    try {
      await shell.start()
    }
    catch (err: any) {
      process.stderr.write(`Shell error: ${err?.message ?? String(err)}\n`)
      process.exitCode = 1
    }
    finally {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
  })

// Execute a single command
cli
  .command('exec <command>', 'Execute a single command')
  .option('--verbose', 'Enable verbose logging')
  .action(async (command: string, options: CliOptions) => {
    const shell = new BunshShell({ ...config, verbose: options.verbose ?? config.verbose })
    const result = await shell.execute(command)

    if (result.stdout)
      process.stdout.write(result.stdout)
    if (result.stderr)
      process.stderr.write(result.stderr)

    process.exit(result.exitCode)
  })

// Version command
cli.command('version', 'Show the version').action(() => {
  process.stdout.write(`${version}\n`)
})

cli.version(version)
cli.help()
cli.parse()
