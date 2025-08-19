import type { Shell } from '../src/types'
import { beforeEach, describe, expect, it } from 'bun:test'
import { CommandParser } from '../src/parser'

describe('CommandParser', () => {
  let parser: CommandParser
  let mockShell: Shell

  beforeEach(() => {
    parser = new CommandParser()
    mockShell = {
      cwd: '/test',
      environment: {
        USER: 'testuser',
        HOME: '/home/testuser',
        TEST_VAR: 'test_value',
        NUM_VAR: '42',
      },
    } as any
  })

  describe('Variable Expansion Integration', () => {
    it('should expand variables during parsing', async () => {
      const result = await parser.parse('echo $USER', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].name).toBe('echo')
      expect(result.commands[0].args).toEqual(['testuser'])
    })

    it('should expand variables in arguments', async () => {
      const result = await parser.parse('ls $HOME/documents', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['/home/testuser/documents'])
    })

    it('should handle arithmetic expansion', async () => {
      const result = await parser.parse('echo $((2 + 3))', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['5'])
    })
  })

  describe('Brace Expansion Integration', () => {
    it('should expand brace lists', async () => {
      const result = await parser.parse('touch file.{txt,log,conf}', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['file.txt', 'file.log', 'file.conf'])
    })

    it('should expand numeric ranges', async () => {
      const result = await parser.parse('echo {1..3}', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['1', '2', '3'])
    })

    it('should expand character ranges', async () => {
      const result = await parser.parse('echo {a..c}', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['a', 'b', 'c'])
    })
  })

  describe('Enhanced Redirection Parsing', () => {
    it('should parse advanced output redirection', async () => {
      const result = await parser.parse('echo hello > output.txt', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.redirects?.stdout).toBe('output.txt')
    })

    it('should parse stderr redirection', async () => {
      const result = await parser.parse('command 2> error.log', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.redirects?.stderr).toBe('error.log')
    })

    it('should parse combined redirection', async () => {
      const result = await parser.parse('command &> output.txt', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.redirects?.stdout).toBe('output.txt')
      expect(result.redirects?.stderr).toBe('output.txt')
    })

    it('should parse input redirection', async () => {
      const result = await parser.parse('cat < input.txt', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.redirects?.stdin).toBe('input.txt')
    })
  })

  describe('Complex Command Parsing', () => {
    it('should handle commands with multiple expansions and redirections', async () => {
      const result = await parser.parse('echo $USER {1..2} > $HOME/output.txt', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].name).toBe('echo')
      expect(result.commands[0].args).toEqual(['testuser', '1', '2'])
      expect(result.redirects?.stdout).toBe('/home/testuser/output.txt')
    })

    it('should handle pipes with expansions', async () => {
      const result = await parser.parse('echo {a,b,c} | grep $TEST_VAR', mockShell)
      expect(result.commands).toHaveLength(2)
      expect(result.commands[0].args).toEqual(['a', 'b', 'c'])
      expect(result.commands[1].args).toEqual(['test_value'])
    })

    it('should handle background processes with expansions', async () => {
      const result = await parser.parse('long-command $USER &', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].background).toBe(true)
      expect(result.commands[0].args).toEqual(['testuser'])
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty commands', async () => {
      const result = await parser.parse('', mockShell)
      expect(result.commands).toHaveLength(0)
    })

    it('should handle commands without shell context', async () => {
      const result = await parser.parse('echo hello')
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['hello'])
    })

    it('should handle quoted expansions', async () => {
      const result = await parser.parse('echo "Hello $USER"', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['"Hello testuser"'])
    })

    it('should handle escaped expansions', async () => {
      const result = await parser.parse('echo \\$USER', mockShell)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].args).toEqual(['\\$USER'])
    })
  })

  describe('Tokenization with Expansions', () => {
    it('should properly tokenize expanded arguments', () => {
      const tokens = parser.tokenize('file.{txt,log} "quoted arg" $VAR')
      expect(tokens).toEqual(['file.{txt,log}', '"quoted arg"', '$VAR'])
    })

    it('should handle complex tokenization', () => {
      const tokens = parser.tokenize('cmd --flag=value "arg with spaces" {a,b}')
      expect(tokens).toEqual(['cmd', '--flag=value', '"arg with spaces"', '{a,b}'])
    })

    it('should handle escaped characters in tokenization', () => {
      const tokens = parser.tokenize('arg1\\ with\\ space arg2')
      expect(tokens).toEqual(['arg1\\ with\\ space', 'arg2'])
    })
  })
})
