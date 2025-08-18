import type { krustyConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rmdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/config'
import { krustyShell } from '../src/shell'

describe('Builtin Commands', () => {
  let shell: krustyShell
  let testConfig: krustyConfig
  let tempDir: string

  beforeEach(async () => {
    testConfig = {
      ...defaultConfig,
      verbose: false,
      history: {
        ...defaultConfig.history,
        file: `/tmp/test_history_builtin_${Math.random().toString(36).substr(2, 9)}`,
      },
    }
    shell = new krustyShell(testConfig)
    tempDir = await mkdtemp(join(tmpdir(), 'krusty-test-'))
  })

  afterEach(async () => {
    shell.stop()
    try {
      await rmdir(tempDir, { recursive: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  describe('cd command', () => {
    it('should change to specified directory', async () => {
      const originalCwd = shell.cwd
      const result = await shell.execute(`cd ${tempDir}`)

      expect(result.exitCode).toBe(0)
      expect(shell.cwd).toBe(tempDir)

      // Restore
      shell.changeDirectory(originalCwd)
    })

    it('should change to home directory with no arguments', async () => {
      const result = await shell.execute('cd')
      expect(result.exitCode).toBe(0)
      expect(shell.cwd).toBe(homedir())
    })

    it('should handle cd with tilde', async () => {
      const result = await shell.execute('cd ~')
      expect(result.exitCode).toBe(0)
      expect(shell.cwd).toBe(homedir())
    })

    it('should return error for non-existent directory', async () => {
      const result = await shell.execute('cd /nonexistent/directory')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No such file or directory')
    })

    it('should handle relative paths', async () => {
      const originalCwd = shell.cwd
      shell.changeDirectory(tempDir)

      const result = await shell.execute('cd ..')
      expect(result.exitCode).toBe(0)
      expect(shell.cwd).not.toBe(tempDir)

      shell.changeDirectory(originalCwd)
    })
  })

  describe('pwd command', () => {
    it('should return current working directory', async () => {
      const result = await shell.execute('pwd')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(shell.cwd)
    })

    it('should ignore arguments', async () => {
      const result = await shell.execute('pwd --help -l')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(shell.cwd)
    })
  })

  describe('history command', () => {
    it('should display command history', async () => {
      // Create fresh shell for this test
      const historyConfig = {
        ...testConfig,
        history: {
          ...testConfig.history,
          file: `/tmp/test_history_display_${Math.random().toString(36).substr(2, 9)}`,
        },
      }
      const historyShell = new krustyShell(historyConfig)

      historyShell.addToHistory('command1')
      historyShell.addToHistory('command2')
      historyShell.addToHistory('command3')

      const result = await historyShell.execute('history')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('command1')
      expect(result.stdout).toContain('command2')
      expect(result.stdout).toContain('command3')

      historyShell.stop()
    })

    it('should number history entries', async () => {
      // Create fresh shell for this test
      const historyConfig = {
        ...testConfig,
        history: {
          ...testConfig.history,
          file: `/tmp/test_history_number_${Math.random().toString(36).substr(2, 9)}`,
        },
      }
      const historyShell = new krustyShell(historyConfig)

      historyShell.addToHistory('command1')
      historyShell.addToHistory('command2')
      historyShell.addToHistory('command3')

      const result = await historyShell.execute('history')
      expect(result.stdout).toMatch(/\s*1\s+command1/)
      expect(result.stdout).toMatch(/\s*2\s+command2/)
      expect(result.stdout).toMatch(/\s*3\s+command3/)

      historyShell.stop()
    })

    it('should limit history with -n option', async () => {
      // Create fresh shell for this test
      const historyConfig = {
        ...testConfig,
        history: {
          ...testConfig.history,
          file: `/tmp/test_history_limit_${Math.random().toString(36).substr(2, 9)}`,
        },
      }
      const historyShell = new krustyShell(historyConfig)

      historyShell.addToHistory('command1')
      historyShell.addToHistory('command2')
      historyShell.addToHistory('command3')

      const result = await historyShell.execute('history -n 2')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines.length).toBe(2)
      // The history command itself gets added, so we expect the last 2 entries
      expect(result.stdout).toContain('command3')
      expect(result.stdout).toContain('history -n 2')

      historyShell.stop()
    })

    it('should clear history with -c option', async () => {
      const result = await shell.execute('history -c')
      expect(result.exitCode).toBe(0)
      expect(shell.history).toHaveLength(0)
    })
  })

  describe('alias command', () => {
    it('should create new alias', async () => {
      const result = await shell.execute('alias ll="ls -la"')
      expect(result.exitCode).toBe(0)
      expect(shell.aliases.ll).toBe('ls -la')
    })

    it('should display all aliases when no arguments', async () => {
      shell.aliases.ll = 'ls -la'
      shell.aliases.la = 'ls -A'

      const result = await shell.execute('alias')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('ll=ls -la')
      expect(result.stdout).toContain('la=ls -A')
    })

    it('should display specific alias', async () => {
      shell.aliases.ll = 'ls -la'

      const result = await shell.execute('alias ll')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('ll=ls -la')
    })

    it('should handle alias without quotes', async () => {
      const result = await shell.execute('alias ll=ls')
      expect(result.exitCode).toBe(0)
      expect(shell.aliases.ll).toBe('ls')
    })

    it('should return error for non-existent alias', async () => {
      const result = await shell.execute('alias nonexistent')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('not found')
    })
  })

  describe('unalias command', () => {
    beforeEach(() => {
      shell.aliases.ll = 'ls -la'
      shell.aliases.la = 'ls -A'
    })

    it('should remove specific alias', async () => {
      const result = await shell.execute('unalias ll')
      expect(result.exitCode).toBe(0)
      expect(shell.aliases.ll).toBeUndefined()
      expect(shell.aliases.la).toBe('ls -A')
    })

    it('should remove all aliases with -a option', async () => {
      const result = await shell.execute('unalias -a')
      expect(result.exitCode).toBe(0)
      expect(Object.keys(shell.aliases)).toHaveLength(0)
    })

    it('should return error for non-existent alias', async () => {
      const result = await shell.execute('unalias nonexistent')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('not found')
    })
  })

  describe('export command', () => {
    it('should set environment variable', async () => {
      const result = await shell.execute('export TEST_VAR=test_value')
      expect(result.exitCode).toBe(0)
      expect(shell.environment.TEST_VAR).toBe('test_value')
    })

    it('should display all environment variables when no arguments', async () => {
      shell.environment.TEST_VAR = 'test_value'

      const result = await shell.execute('export')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('TEST_VAR=test_value')
    })

    it('should handle variables with spaces', async () => {
      const result = await shell.execute('export TEST_VAR="value with spaces"')
      expect(result.exitCode).toBe(0)
      expect(shell.environment.TEST_VAR).toBe('value with spaces')
    })

    it('should handle multiple variables', async () => {
      const result = await shell.execute('export VAR1=value1 VAR2=value2')
      expect(result.exitCode).toBe(0)
      expect(shell.environment.VAR1).toBe('value1')
      expect(shell.environment.VAR2).toBe('value2')
    })
  })

  describe('echo command', () => {
    it('should output arguments', async () => {
      const result = await shell.execute('echo hello world')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello world')
    })

    it('should handle empty arguments', async () => {
      const result = await shell.execute('echo')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('')
    })

    it('should handle special characters', async () => {
      const result = await shell.execute('echo "hello $USER"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hello')
    })

    it('should support -n option (no newline)', async () => {
      const result = await shell.execute('echo -n hello')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello')
      expect(result.stdout).not.toContain('\n')
    })
  })

  describe('exit command', () => {
    it('should exit with code 0 by default', async () => {
      const result = await shell.execute('exit')
      expect(result.exitCode).toBe(0)
    })

    it('should exit with specified code', async () => {
      const result = await shell.execute('exit 42')
      expect(result.exitCode).toBe(42)
    })

    it('should handle invalid exit codes', async () => {
      const result = await shell.execute('exit invalid')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('numeric argument required')
    })
  })

  describe('help command', () => {
    it('should display help for all commands', async () => {
      const result = await shell.execute('help')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('cd')
      expect(result.stdout).toContain('pwd')
      expect(result.stdout).toContain('history')
    })

    it('should display help for specific command', async () => {
      const result = await shell.execute('help cd')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('cd')
      expect(result.stdout).toContain('Change the current directory')
    })

    it('should return error for unknown command', async () => {
      const result = await shell.execute('help unknown')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Unknown command')
    })
  })
})
