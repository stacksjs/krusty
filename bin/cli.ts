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
      const shell = new BunshShell({ ...config, verbose: options.verbose })
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
      const shell = new BunshShell({ ...config, verbose: options.verbose })

      console.log(`Welcome to Bunsh v${version}`)
      console.log('Type "help" for available commands or "exit" to quit.\n')

      await shell.start()
    }
  })

// Explicit shell command
cli
  .command('shell', 'Start the interactive shell')
  .option('--verbose', 'Enable verbose logging')
  .option('--config <config>', 'Path to config file')
  .action(async (options: CliOptions) => {
    const shell = new BunshShell({ ...config, verbose: options.verbose })

    console.log(`Welcome to Bunsh v${version}`)
    console.log('Type "help" for available commands or "exit" to quit.\n')

    await shell.start()
  })

// Execute a single command
cli
  .command('exec <command>', 'Execute a single command')
  .option('--verbose', 'Enable verbose logging')
  .action(async (command: string, options: CliOptions) => {
    const shell = new BunshShell({ ...config, verbose: options.verbose })
    const result = await shell.execute(command)

    if (result.stdout)
      process.stdout.write(result.stdout)
    if (result.stderr)
      process.stderr.write(result.stderr)

    process.exit(result.exitCode)
  })

// Version command
cli.command('version', 'Show the version').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
