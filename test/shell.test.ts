import type { BunshConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { homedir } from 'node:os'
import { defaultConfig } from '../src/config'
import { BunshShell } from '../src/shell'

describe('BunshShell', () => {
  let shell: BunshShell
  let testConfig: BunshConfig

  beforeEach(() => {
    testConfig = {
      ...defaultConfig,
      verbose: true,
      history: {
        ...defaultConfig.history,
        file: `/tmp/test_history_${Math.random().toString(36).substr(2, 9)}`,
      },
    }
    shell = new BunshShell(testConfig)
  })

  afterEach(() => {
    shell.stop()
  })

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const defaultShell = new BunshShell()
      expect(defaultShell.config).toEqual(defaultConfig)
    })

    it('should initialize with custom config', () => {
      expect(shell.config).toEqual(testConfig)
    })

    it('should set initial working directory', () => {
      expect(shell.cwd).toBe(process.cwd())
    })

    it('should initialize empty history', () => {
      expect(shell.history).toEqual([])
    })

    it('should initialize with default aliases', () => {
      expect(shell.aliases).toEqual(testConfig.aliases || {})
    })
  })

  describe('command parsing', () => {
    it('should parse simple command', () => {
      const parsed = shell.parseCommand('ls -la')
      expect(parsed.commands).toHaveLength(1)
      expect(parsed.commands[0].name).toBe('ls')
      expect(parsed.commands[0].args).toEqual(['-la'])
    })

    it('should parse command with multiple arguments', () => {
      const parsed = shell.parseCommand('git commit -m "test message"')
      expect(parsed.commands[0].name).toBe('git')
      expect(parsed.commands[0].args).toEqual(['commit', '-m', 'test message'])
    })

    it('should parse piped commands', () => {
      const parsed = shell.parseCommand('ls -la | grep test')
      expect(parsed.commands).toHaveLength(2)
      expect(parsed.commands[0].name).toBe('ls')
      expect(parsed.commands[1].name).toBe('grep')
    })

    it('should parse background commands', () => {
      const parsed = shell.parseCommand('sleep 10 &')
      expect(parsed.commands[0].background).toBe(true)
    })

    it('should parse redirects', () => {
      const parsed = shell.parseCommand('ls > output.txt')
      expect(parsed.redirects?.stdout).toBe('output.txt')
    })

    it('should handle empty command', () => {
      const parsed = shell.parseCommand('')
      expect(parsed.commands).toHaveLength(0)
    })

    it('should handle whitespace-only command', () => {
      const parsed = shell.parseCommand('   ')
      expect(parsed.commands).toHaveLength(0)
    })
  })

  describe('command execution', () => {
    it('should execute simple command', async () => {
      const result = await shell.execute('echo "hello world"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello world')
      expect(result.stderr).toBe('')
    })

    it('should handle command not found', async () => {
      const result = await shell.execute('nonexistentcommand')
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('command not found')
    })

    it('should measure execution duration', async () => {
      const result = await shell.execute('echo test')
      expect(result.duration).toBeGreaterThan(0)
    })

    it('should add successful commands to history', async () => {
      await shell.execute('echo test')
      expect(shell.history).toContain('echo test')
    })

    it('should handle aliases', async () => {
      shell.aliases.ll = 'ls -la'
      const result = await shell.execute('ll')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('builtin commands', () => {
    it('should have cd builtin', () => {
      expect(shell.builtins.has('cd')).toBe(true)
    })

    it('should have pwd builtin', () => {
      expect(shell.builtins.has('pwd')).toBe(true)
    })

    it('should have history builtin', () => {
      expect(shell.builtins.has('history')).toBe(true)
    })

    it('should have alias builtin', () => {
      expect(shell.builtins.has('alias')).toBe(true)
    })

    it('should execute pwd builtin', async () => {
      const result = await shell.execute('pwd')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(shell.cwd)
    })

    it('should execute cd builtin', async () => {
      const originalCwd = shell.cwd
      const result = await shell.execute('cd /')
      expect(result.exitCode).toBe(0)
      expect(shell.cwd).toBe('/')

      // Restore original directory
      shell.changeDirectory(originalCwd)
    })
  })

  describe('directory management', () => {
    it('should change to valid directory', () => {
      const originalCwd = shell.cwd
      const success = shell.changeDirectory('/')
      expect(success).toBe(true)
      expect(shell.cwd).toBe('/')

      // Restore
      shell.changeDirectory(originalCwd)
    })

    it('should fail to change to invalid directory', () => {
      const originalCwd = shell.cwd
      const success = shell.changeDirectory('/nonexistent/directory')
      expect(success).toBe(false)
      expect(shell.cwd).toBe(originalCwd)
    })

    it('should expand tilde in path', () => {
      const success = shell.changeDirectory('~')
      expect(success).toBe(true)
      expect(shell.cwd).toBe(homedir())
    })
  })

  describe('history management', () => {
    it('should add command to history', () => {
      shell.addToHistory('test command')
      expect(shell.history).toContain('test command')
    })

    it('should not add duplicate commands when configured', () => {
      shell.config.history!.ignoreDuplicates = true
      shell.addToHistory('test command')
      shell.addToHistory('test command')
      expect(shell.history.filter(cmd => cmd === 'test command')).toHaveLength(1)
    })

    it('should ignore commands starting with space when configured', () => {
      shell.config.history!.ignoreSpace = true
      shell.addToHistory(' secret command')
      expect(shell.history).not.toContain(' secret command')
    })

    it('should limit history size', () => {
      // Create a new shell with limited history
      const limitedConfig = {
        ...testConfig,
        history: {
          ...testConfig.history,
          maxEntries: 3,
          file: `/tmp/test_history_limited_${Math.random().toString(36).substr(2, 9)}`,
        },
      }
      const limitedShell = new BunshShell(limitedConfig)

      limitedShell.addToHistory('cmd1')
      limitedShell.addToHistory('cmd2')
      limitedShell.addToHistory('cmd3')
      limitedShell.addToHistory('cmd4')
      expect(limitedShell.history).toHaveLength(3)
      expect(limitedShell.history).not.toContain('cmd1')
      expect(limitedShell.history).toContain('cmd4')

      limitedShell.stop()
    })

    it('should search history', () => {
      shell.addToHistory('git status')
      shell.addToHistory('git commit')
      shell.addToHistory('ls -la')

      const results = shell.searchHistory('git')
      expect(results).toHaveLength(2)
      expect(results).toContain('git status')
      expect(results).toContain('git commit')
    })
  })

  describe('completion', () => {
    it('should provide command completions', () => {
      const completions = shell.getCompletions('l', 1)
      // Since we prioritize builtins and 'ls' is a system command,
      // let's check that we get some completions starting with 'l'
      expect(completions.length).toBeGreaterThan(0)
      expect(completions.every(c => c.startsWith('l'))).toBe(true)
    })

    it('should provide builtin completions', () => {
      const completions = shell.getCompletions('c', 1)
      expect(completions).toContain('cd')
    })

    it('should provide alias completions', () => {
      shell.aliases.myalias = 'echo test'
      const completions = shell.getCompletions('my', 2)
      expect(completions).toContain('myalias')
    })

    it('should provide file completions', () => {
      const completions = shell.getCompletions('ls ./', 5)
      expect(completions.length).toBeGreaterThan(0)
    })
  })
})
