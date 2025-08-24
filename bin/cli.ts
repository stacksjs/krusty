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
    // Terminals may pass shell-style flags (e.g., -l). Ignore leading dash args for command execution
    const nonFlagArgs = args.filter(a => !(a?.startsWith?.('-')))
    // If non-flag arguments are provided, execute them as a command
    if (nonFlagArgs.length > 0) {
      const shell = new KrustyShell({ ...base, verbose: options.verbose ?? base.verbose })
      const command = nonFlagArgs.join(' ')
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

// Print completions (debug utility)
cli
  .command('complete <input>', 'Print JSON of completions for given input (optional [cursor])')
  .option('--cursor <n>', 'Cursor position within input (defaults to input length)')
  .option('--verbose', 'Enable verbose logging')
  .option('--config <config>', 'Path to config file')
  .action(async (inputText: string, options: CliOptions & { cursor?: string }) => {
    try {
      const cfg = await loadKrustyConfig({ path: options.config })
      const base = { ...defaultConfig, ...cfg }
      const shell = new KrustyShell({ ...base, verbose: options.verbose ?? base.verbose })
      // Ensure plugins are loaded so plugin completions are available
      await shell.loadPlugins()
      const cursor = (options.cursor != null && options.cursor !== '')
        ? Math.max(0, Math.min(inputText.length, Number.parseInt(String(options.cursor), 10) || 0))
        : inputText.length
      const completions = shell.getCompletions(inputText, cursor)
      process.stdout.write(`${JSON.stringify(completions, null, 2)}\n`)
      process.exit(0)
    }
    catch (err: any) {
      process.stderr.write(`complete error: ${err?.message ?? String(err)}\n`)
      process.exit(1)
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

// Setup command: install wrapper, optionally register and set as default shell
cli
  .command('setup', 'Setup krusty (install wrapper; optionally set as default shell)')
  .option('--prefix <path>', 'Install prefix for the wrapper (defaults to /usr/local/bin or ~/.local/bin)')
  .option('--no-chsh', 'Install wrapper only; do not change the login shell')
  .example('krusty setup --prefix /usr/local/bin --no-chsh')
  .action(async (options: { prefix?: string, noChsh?: boolean }) => {
    const isWindows = process.platform === 'win32'
    const shellPath = process.argv[1]

    if (isWindows) {
      process.stdout.write('Setup on Windows will configure a launcher; setting default shell depends on terminal.\n')
      try {
        const { writeFileSync } = await import('node:fs')
        const { homedir } = await import('node:os')
        const batPath = `${homedir()}/krusty_shell.bat`
        writeFileSync(batPath, `@echo off\n"${process.execPath}" "${shellPath}" %*`)
        process.stdout.write(`Installed Windows launcher at: ${batPath}\n`)
        process.stdout.write('Configure your terminal profile to use this launcher.\n')
      }
      catch (err: any) {
        process.stderr.write(`Failed to write launcher: ${err?.message ?? String(err)}\n`)
        process.exit(1)
      }
      return
    }

    process.stdout.write('Setting up krusty on this system...\n')
    try {
      const { writeFileSync, chmodSync, mkdirSync } = await import('node:fs')
      const { execSync } = await import('node:child_process')
      const { join } = await import('node:path')
      const { homedir } = await import('node:os')

      // Determine install prefix
      let prefix = options.prefix
      const candidates = ['/usr/local/bin', '/opt/homebrew/bin']
      if (!prefix) {
        prefix = candidates.find((p) => {
          try {
            execSync(`[ -d "${p}" ] && [ -w "${p}" ] && echo ok`)
            return true
          }
          catch {
            return false
          }
        }) || join(homedir(), '.local', 'bin')
      }

      // Ensure directory exists
      try {
        mkdirSync(prefix, { recursive: true })
      }
      catch {}

      const wrapperPath = join(prefix, 'krusty')
      const wrapperScript = `#!/bin/sh\nSHELL="${wrapperPath}"\nexport SHELL\nexec "${process.execPath}" "${shellPath}" "$@"\n`
      writeFileSync(wrapperPath, wrapperScript)
      chmodSync(wrapperPath, 0o755)
      process.stdout.write(`Installed wrapper: ${wrapperPath}\n`)

      // Register as a valid login shell
      try {
        execSync(`grep -qF '${wrapperPath}' /etc/shells || echo '${wrapperPath}' | sudo tee -a /etc/shells > /dev/null`, { stdio: 'inherit' })
      }
      catch {
        process.stdout.write('\nNote: Could not add to /etc/shells automatically. Run this manually (may require sudo):\n')
        process.stdout.write(`  echo '${wrapperPath}' | sudo tee -a /etc/shells\n`)
      }

      // Change the user's login shell unless --no-chsh was provided
      const doChsh = options.noChsh !== true
      if (doChsh) {
        try {
          execSync(`chsh -s ${wrapperPath} ${process.env.USER}`, { stdio: 'inherit' })
          process.stdout.write('\nSuccess! krusty set as your default shell. Log out and back in to take effect.\n')
        }
        catch {
          process.stdout.write('\nNote: Could not change login shell automatically. Run manually:\n')
          process.stdout.write(`  chsh -s ${wrapperPath} ${process.env.USER}\n`)
        }
      }
      else {
        process.stdout.write('Wrapper installed. Skipping login shell change due to --no-chsh.\n')
      }
    }
    catch (err: any) {
      process.stderr.write(`setup error: ${err?.message ?? String(err)}\n`)
      process.exit(1)
    }
  })

// Version command
cli.command('version', 'Show the version').action(() => {
  process.stdout.write(`${version}\n`)
})

cli.version(version)
cli.help()
cli.parse()
