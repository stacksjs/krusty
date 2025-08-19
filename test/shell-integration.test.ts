/* eslint-disable no-template-curly-in-string */
import type { KrustyConfig } from '../src/types'
import { beforeEach, describe, expect, it } from 'bun:test'
import { KrustyShell } from '../src/shell'

describe('Shell Integration with Enhanced Features', () => {
  let shell: KrustyShell
  let config: KrustyConfig

  beforeEach(() => {
    config = {
      verbose: false,
      aliases: {
        ll: 'ls -la',
        gs: 'git status',
      },
      environment: {
        TEST_VAR: 'test_value',
        NUM_VAR: '42',
        USER: 'testuser',
      },
    }
    shell = new KrustyShell(config)
  })

  describe('Variable Expansion in Commands', () => {
    it('should expand environment variables', async () => {
      const result = await shell.execute('echo $USER')
      expect(result.stdout.trim()).toBe('testuser')
      expect(result.exitCode).toBe(0)
    })

    it('should expand variables with default values', async () => {
      const result = await shell.execute('echo ${UNDEFINED_VAR:-default_value}')
      expect(result.stdout.trim()).toBe('default_value')
      expect(result.exitCode).toBe(0)
    })

    it('should handle arithmetic expansion', async () => {
      const result = await shell.execute('echo $((5 + 3))')
      expect(result.stdout.trim()).toBe('8')
      expect(result.exitCode).toBe(0)
    })

    it('should expand variables in arithmetic', async () => {
      const result = await shell.execute('echo $((NUM_VAR * 2))')
      expect(result.stdout.trim()).toBe('84')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Brace Expansion in Commands', () => {
    it('should expand comma-separated braces', async () => {
      const result = await shell.execute('echo {a,b,c}')
      expect(result.stdout.trim()).toBe('a b c')
      expect(result.exitCode).toBe(0)
    })

    it('should expand numeric ranges', async () => {
      const result = await shell.execute('echo {1..5}')
      expect(result.stdout.trim()).toBe('1 2 3 4 5')
      expect(result.exitCode).toBe(0)
    })

    it('should expand character ranges', async () => {
      const result = await shell.execute('echo {a..e}')
      expect(result.stdout.trim()).toBe('a b c d e')
      expect(result.exitCode).toBe(0)
    })

    it('should handle reverse ranges', async () => {
      const result = await shell.execute('echo {3..1}')
      expect(result.stdout.trim()).toBe('3 2 1')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Advanced Redirection', () => {
    it('should handle output redirection', async () => {
      const testFile = '/tmp/krusty_test_output.txt'
      await shell.execute(`echo "test output" > ${testFile}`)

      // Read the file to verify content
      const result = await shell.execute(`cat ${testFile}`)
      expect(result.stdout.trim()).toBe('test output')
      expect(result.exitCode).toBe(0)

      // Clean up
      await shell.execute(`rm -f ${testFile}`)
    })

    it('should handle append redirection', async () => {
      const testFile = '/tmp/krusty_test_append.txt'
      await shell.execute(`echo "line 1" > ${testFile}`)
      await shell.execute(`echo "line 2" >> ${testFile}`)

      const result = await shell.execute(`cat ${testFile}`)
      expect(result.stdout.trim()).toBe('line 1\nline 2')

      // Clean up
      await shell.execute(`rm -f ${testFile}`)
    })

    it('should handle input redirection', async () => {
      const testFile = '/tmp/krusty_test_input.txt'
      await shell.execute(`echo "input content" > ${testFile}`)

      const result = await shell.execute(`cat < ${testFile}`)
      expect(result.stdout.trim()).toBe('input content')

      // Clean up
      await shell.execute(`rm -f ${testFile}`)
    })
  })

  describe('Combined Features', () => {
    it('should handle expansion with redirection', async () => {
      const testFile = '/tmp/krusty_test_combined.txt'
      await shell.execute(`echo $USER {1..3} > ${testFile}`)

      const result = await shell.execute(`cat ${testFile}`)
      expect(result.stdout.trim()).toBe('testuser 1 2 3')

      // Clean up
      await shell.execute(`rm -f ${testFile}`)
    })

    it('should handle arithmetic with variables and redirection', async () => {
      const testFile = '/tmp/krusty_test_math.txt'
      await shell.execute(`echo $((NUM_VAR + 8)) > ${testFile}`)

      const result = await shell.execute(`cat ${testFile}`)
      expect(result.stdout.trim()).toBe('50')

      // Clean up
      await shell.execute(`rm -f ${testFile}`)
    })

    it('should handle complex brace expansion with variables', async () => {
      shell.environment.PREFIX = 'file'
      const result = await shell.execute('echo ${PREFIX}_{a,b,c}.txt')
      expect(result.stdout.trim()).toBe('file_a.txt file_b.txt file_c.txt')
    })
  })

  describe('Error Handling', () => {
    it('should handle undefined variable with error syntax', async () => {
      const result = await shell.execute('echo ${UNDEFINED_VAR:?Variable not set}')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Variable not set')
    })

    it('should handle invalid arithmetic gracefully', async () => {
      const result = await shell.execute('echo $((invalid_expression))')
      expect(result.stdout.trim()).toBe('0')
      expect(result.exitCode).toBe(0)
    })

    it('should handle malformed brace expansion', async () => {
      const result = await shell.execute('echo {unclosed')
      expect(result.stdout.trim()).toBe('{unclosed')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Pipes with Expansions', () => {
    it('should handle pipes with variable expansion', async () => {
      const result = await shell.execute('echo $USER | grep test')
      expect(result.stdout.trim()).toBe('testuser')
      expect(result.exitCode).toBe(0)
    })

    it('should handle pipes with brace expansion', async () => {
      const result = await shell.execute('echo {apple,banana,cherry} | grep apple')
      expect(result.stdout.trim()).toBe('apple banana cherry')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Background Processes with Expansions', () => {
    it('should handle background processes with variable expansion', async () => {
      const result = await shell.execute('echo $USER &')
      expect(result.exitCode).toBe(0)
      // Background process should be added to jobs
      expect(shell.jobs.length).toBeGreaterThan(0)
    })
  })

  describe('Aliases with Expansions', () => {
    it('should expand variables in aliased commands', async () => {
      shell.aliases.test_alias = 'echo $USER'
      const result = await shell.execute('test_alias')
      expect(result.stdout.trim()).toBe('testuser')
      expect(result.exitCode).toBe(0)
    })

    it('should handle brace expansion in aliases', async () => {
      shell.aliases.range_alias = 'echo {1..3}'
      const result = await shell.execute('range_alias')
      expect(result.stdout.trim()).toBe('1 2 3')
      expect(result.exitCode).toBe(0)
    })
  })
})
