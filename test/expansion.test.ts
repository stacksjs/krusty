/* eslint-disable no-template-curly-in-string */
import type { Shell } from '../src/types'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ExpansionEngine, ExpansionUtils } from '../src/utils/expansion'

describe('ExpansionEngine', () => {
  let mockShell: Shell
  let expansionEngine: ExpansionEngine

  beforeEach(() => {
    mockShell = {
      cwd: '/test',
      environment: {
        USER: 'testuser',
        HOME: '/home/testuser',
        PATH: '/usr/bin:/bin',
        TEST_VAR: 'test_value',
        NUM_VAR: '42',
        EMPTY_VAR: '',
      },
    } as Shell

    expansionEngine = new ExpansionEngine({
      shell: mockShell,
      cwd: mockShell.cwd,
      environment: mockShell.environment,
    })
  })

  describe('Variable Expansion', () => {
    it('should expand simple variables', async () => {
      const result = await expansionEngine.expand('Hello $USER')
      expect(result).toBe('Hello testuser')
    })

    it('should expand variables with braces', async () => {
      const result = await expansionEngine.expand('Path: ${HOME}/bin')
      expect(result).toBe('Path: /home/testuser/bin')
    })

    it('should handle default values', async () => {
      const result = await expansionEngine.expand('${UNDEFINED_VAR:-default}')
      expect(result).toBe('default')
    })

    it('should handle alternative values', async () => {
      const result = await expansionEngine.expand('${USER:+exists}')
      expect(result).toBe('exists')
    })

    it('should handle empty variable alternative', async () => {
      const result = await expansionEngine.expand('${EMPTY_VAR:+exists}')
      expect(result).toBe('')
    })

    it('should handle error on undefined with :?', async () => {
      await expect(expansionEngine.expand('${UNDEFINED_VAR:?error message}')).rejects.toThrow('UNDEFINED_VAR: error message')
    })

    it('should handle assignment with =', async () => {
      const result = await expansionEngine.expand('${NEW_VAR=assigned}')
      expect(result).toBe('assigned')
      expect(mockShell.environment.NEW_VAR).toBe('assigned')
    })
  })

  describe('Arithmetic Expansion', () => {
    it('should evaluate simple arithmetic', async () => {
      const result = await expansionEngine.expand('$((2 + 3))')
      expect(result).toBe('5')
    })

    it('should handle multiplication and division', async () => {
      const result = await expansionEngine.expand('$((10 * 2 / 4))')
      expect(result).toBe('5')
    })

    it('should expand variables in arithmetic', async () => {
      const result = await expansionEngine.expand('$((NUM_VAR + 8))')
      expect(result).toBe('50')
    })

    it('should handle modulo operation', async () => {
      const result = await expansionEngine.expand('$((10 % 3))')
      expect(result).toBe('1')
    })

    it('should return 0 for invalid expressions', async () => {
      const result = await expansionEngine.expand('$((invalid))')
      expect(result).toBe('0')
    })
  })

  describe('Brace Expansion', () => {
    it('should expand comma-separated lists', async () => {
      const result = await expansionEngine.expand('file.{txt,log,conf}')
      expect(result).toBe('file.txt file.log file.conf')
    })

    it('should expand numeric ranges', async () => {
      const result = await expansionEngine.expand('{1..5}')
      expect(result).toBe('1 2 3 4 5')
    })

    it('should expand reverse numeric ranges', async () => {
      const result = await expansionEngine.expand('{5..1}')
      expect(result).toBe('5 4 3 2 1')
    })

    it('should expand character ranges', async () => {
      const result = await expansionEngine.expand('{a..e}')
      expect(result).toBe('a b c d e')
    })

    it('should expand reverse character ranges', async () => {
      const result = await expansionEngine.expand('{e..a}')
      expect(result).toBe('e d c b a')
    })

    it('should handle nested expansions', async () => {
      const result = await expansionEngine.expand('prefix_{1..3}_suffix')
      expect(result).toBe('prefix_1_suffix prefix_2_suffix prefix_3_suffix')
    })
  })

  describe('Command Substitution', () => {
    it('should handle $() syntax', async () => {
      // Mock the command execution to return a predictable result
      const originalExecuteCommand = expansionEngine.executeCommand
      expansionEngine.executeCommand = async (cmd: string) => {
        if (cmd === 'echo hello')
          return 'hello\n'
        return ''
      }

      const result = await expansionEngine.expand('Output: $(echo hello)')
      expect(result).toBe('Output: hello')

      // Restore original method
      expansionEngine.executeCommand = originalExecuteCommand
    })

    it('should handle backtick syntax', async () => {
      // Mock the command execution
      const originalExecuteCommand = expansionEngine.executeCommand
      expansionEngine.executeCommand = async (cmd: string) => {
        if (cmd === 'pwd')
          return '/current/dir\n'
        return ''
      }

      const result = await expansionEngine.expand('Current dir: `pwd`')
      expect(result).toBe('Current dir: /current/dir')

      // Restore original method
      expansionEngine.executeCommand = originalExecuteCommand
    })
  })

  describe('Combined Expansions', () => {
    it('should handle multiple expansion types', async () => {
      const result = await expansionEngine.expand('User: $USER, Numbers: {1..3}, Math: $((2*3))')
      expect(result).toBe('User: testuser, Numbers: 1 2 3, Math: 6')
    })

    it('should handle nested variable and brace expansion', async () => {
      mockShell.environment.PREFIX = 'test'
      const result = await expansionEngine.expand('${PREFIX}_{a,b,c}')
      expect(result).toBe('test_a test_b test_c')
    })
  })
})

describe('ExpansionUtils', () => {
  describe('hasExpansion', () => {
    it('should detect variable expansion', () => {
      expect(ExpansionUtils.hasExpansion('$VAR')).toBe(true)
      expect(ExpansionUtils.hasExpansion('${VAR}')).toBe(true)
    })

    it('should detect command substitution', () => {
      expect(ExpansionUtils.hasExpansion('$(cmd)')).toBe(true)
      expect(ExpansionUtils.hasExpansion('`cmd`')).toBe(true)
    })

    it('should detect brace expansion', () => {
      expect(ExpansionUtils.hasExpansion('{a,b,c}')).toBe(true)
      expect(ExpansionUtils.hasExpansion('{1..10}')).toBe(true)
    })

    it('should return false for plain text', () => {
      expect(ExpansionUtils.hasExpansion('plain text')).toBe(false)
    })
  })

  describe('splitArguments', () => {
    it('should split simple arguments', () => {
      const result = ExpansionUtils.splitArguments('arg1 arg2 arg3')
      expect(result).toEqual(['arg1', 'arg2', 'arg3'])
    })

    it('should handle quoted arguments', () => {
      const result = ExpansionUtils.splitArguments('arg1 "quoted arg" arg3')
      expect(result).toEqual(['arg1', '"quoted arg"', 'arg3'])
    })

    it('should handle brace expansion in arguments', () => {
      const result = ExpansionUtils.splitArguments('file.{txt,log} other')
      expect(result).toEqual(['file.{txt,log}', 'other'])
    })

    it('should handle escaped characters', () => {
      const result = ExpansionUtils.splitArguments('arg1\\ with\\ space arg2')
      expect(result).toEqual(['arg1\\ with\\ space', 'arg2'])
    })
  })

  describe('escapeExpansion', () => {
    it('should escape expansion characters', () => {
      const result = ExpansionUtils.escapeExpansion('$VAR {a,b} `cmd`')
      expect(result).toBe('\\$VAR \\{a,b} \\`cmd\\`')
    })
  })
})
