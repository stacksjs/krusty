#!/usr/bin/env -S bun run
import process from 'node:process'
import { CAC } from 'cac'
import { version } from '../package.json'
import { config as defaultConfig, loadKrustyConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

const cli = new CAC('krusty')

interface CliOptions {
  verbose?: boolean
  config?: string
}

// Default command - start the shell
cli
  .command('[...args]', 'Start the krusty shell', {
    allowUnknownOptions: true,
    ignoreOptionDefaultValue: true,
  })
  .option('--verbose', 'Enable verbose logging')
  .option('--config <config>', 'Path to config file')
  .action(async (args: string[], options: CliOptions) => {
    const cfg = await loadKrustyConfig({ path: options.config })
    const base = { ...defaultConfig, ...cfg }
    // If arguments are provided, execute them as a command
    if (args.length > 0) {
      const shell = new KrustyShell({ ...base, verbose: options.verbose ?? base.verbose })
      const command = args.join(' ')
      const result = await shell.execute(command)

      if (!result.streamed) {
        if (result.stdout)
          process.stdout.write(result.stdout)
        if (result.stderr)
          process.stderr.write(result.stderr)
      }

      process.exit(result.exitCode)
    }
    else {
      // Start interactive shell
      const shell = new KrustyShell({ ...base, verbose: options.verbose ?? base.verbose })

      // Welcome message
      process.stdout.write(`Welcome to krusty v${version}\n`)
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
    const cfg = await loadKrustyConfig({ path: options.config })
    const base = { ...defaultConfig, ...cfg }
    const shell = new KrustyShell({ ...base, verbose: options.verbose ?? base.verbose })

    // Welcome message
    process.stdout.write(`Welcome to krusty v${version}\n`)
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
  .option('--config <config>', 'Path to config file')
  .action(async (command: string, options: CliOptions) => {
    const cfg = await loadKrustyConfig({ path: options.config })
    const base = { ...defaultConfig, ...cfg }
    const shell = new KrustyShell({ ...base, verbose: options.verbose ?? base.verbose })
    const result = await shell.execute(command)

    if (!result.streamed) {
      if (result.stdout)
        process.stdout.write(result.stdout)
      if (result.stderr)
        process.stderr.write(result.stderr)
    }

    process.exit(result.exitCode)
  })

// Set as default shell
cli
  .command('set-shell', 'Set Krusty as the default shell')
  .action(async () => {
    const shellPath = process.argv[1] // Path to current script
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      // Windows implementation
      process.stdout.write('Setting Krusty as default shell on Windows...\n')
      // On Windows, we need to modify the registry
      try {
        const { execSync } = await import('node:child_process')
        const { homedir } = await import('node:os')
        const { writeFileSync } = await import('node:fs')

        // Create a .bat file to launch Krusty
        const batPath = `${homedir()}/krusty_shell.bat`
        writeFileSync(batPath, `@echo off\n"${process.execPath}" "${shellPath}" %*`)

        // Set the registry to use our .bat file
        execSync(`reg add "HKCU\\Software\\Microsoft\\Command Processor" /v "AutoRun" /d "${batPath}" /f`)
        process.stdout.write('Success! Krusty is now your default shell on Windows.\n')
        process.stdout.write('You may need to restart your terminal for changes to take effect.\n')
      }
      catch {
        process.stderr.write('Failed to set Krusty as default shell. Please run as administrator.\n')
        process.exit(1)
      }
    }
    else {
      // Unix-like systems (macOS, Linux)
      process.stdout.write('Setting Krusty as default shell...\n')
      try {
        const { writeFileSync, chmodSync } = await import('node:fs')
        const { execSync } = await import('node:child_process')

        // Create a wrapper script
        const wrapperPath = '/usr/local/bin/krusty-shell'
        const wrapperScript = `#!/bin/sh\nexec "${process.execPath}" "${shellPath}" "$@"\n`

        // Write the wrapper script
        writeFileSync(wrapperPath, wrapperScript)
        chmodSync(wrapperPath, 0o755) // Make it executable

        // Add to /etc/shells if not already present
        execSync(`grep -qF '${wrapperPath}' /etc/shells || echo '${wrapperPath}' | sudo tee -a /etc/shells`)

        // Change the shell
        execSync(`chsh -s ${wrapperPath} ${process.env.USER}`)

        process.stdout.write('Success! Krusty is now your default shell.\n')
        process.stdout.write('You may need to log out and log back in for changes to take effect.\n')
      }
      catch {
        process.stderr.write('Failed to set Krusty as default shell. You may need to run with sudo.\n')
        process.exit(1)
      }
    }
  })

// Version command
cli.command('version', 'Show the version').action(() => {
  process.stdout.write(`${version}\n`)
})

cli.version(version)
cli.help()
cli.parse()
