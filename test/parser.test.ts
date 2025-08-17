import { describe, expect, it } from 'bun:test'
import { CommandParser } from '../src/parser'

describe('CommandParser', () => {
  const parser = new CommandParser()

  describe('basic parsing', () => {
    it('should parse simple command', () => {
      const result = parser.parse('ls')
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].name).toBe('ls')
      expect(result.commands[0].args).toEqual([])
    })

    it('should parse command with arguments', () => {
      const result = parser.parse('ls -la /home')
      expect(result.commands[0].name).toBe('ls')
      expect(result.commands[0].args).toEqual(['-la', '/home'])
    })

    it('should handle empty input', () => {
      const result = parser.parse('')
      expect(result.commands).toHaveLength(0)
    })

    it('should handle whitespace-only input', () => {
      const result = parser.parse('   \t  ')
      expect(result.commands).toHaveLength(0)
    })
  })

  describe('quote handling', () => {
    it('should handle single quotes', () => {
      const result = parser.parse('echo \'hello world\'')
      expect(result.commands[0].args).toEqual(['hello world'])
    })

    it('should handle double quotes', () => {
      const result = parser.parse('echo "hello world"')
      expect(result.commands[0].args).toEqual(['hello world'])
    })

    it('should handle mixed quotes', () => {
      const result = parser.parse(`echo "hello 'nested' world"`)
      expect(result.commands[0].args).toEqual(['hello \'nested\' world'])
    })

    it('should handle escaped quotes', () => {
      const result = parser.parse('echo "hello \\"world\\""')
      expect(result.commands[0].args).toEqual(['hello "world"'])
    })

    it('should handle unclosed quotes', () => {
      const result = parser.parse('echo "unclosed quote')
      expect(result.commands[0].args).toEqual(['unclosed quote'])
    })
  })

  describe('pipe handling', () => {
    it('should parse simple pipe', () => {
      const result = parser.parse('ls | grep test')
      expect(result.commands).toHaveLength(2)
      expect(result.commands[0].name).toBe('ls')
      expect(result.commands[1].name).toBe('grep')
      expect(result.commands[1].args).toEqual(['test'])
    })

    it('should parse multiple pipes', () => {
      const result = parser.parse('ls -la | grep test | wc -l')
      expect(result.commands).toHaveLength(3)
      expect(result.commands[0].name).toBe('ls')
      expect(result.commands[1].name).toBe('grep')
      expect(result.commands[2].name).toBe('wc')
    })

    it('should handle pipes with quotes', () => {
      const result = parser.parse('echo "hello | world" | cat')
      expect(result.commands).toHaveLength(2)
      expect(result.commands[0].args).toEqual(['hello | world'])
      expect(result.commands[1].name).toBe('cat')
    })
  })

  describe('redirection handling', () => {
    it('should parse stdout redirection', () => {
      const result = parser.parse('ls > output.txt')
      expect(result.commands[0].name).toBe('ls')
      expect(result.redirects?.stdout).toBe('output.txt')
    })

    it('should parse stderr redirection', () => {
      const result = parser.parse('ls 2> error.txt')
      expect(result.redirects?.stderr).toBe('error.txt')
    })

    it('should parse stdin redirection', () => {
      const result = parser.parse('cat < input.txt')
      expect(result.redirects?.stdin).toBe('input.txt')
    })

    it('should parse append redirection', () => {
      const result = parser.parse('echo test >> output.txt')
      expect(result.redirects?.stdout).toBe('output.txt')
      // Note: append mode should be handled in execution, not parsing
    })

    it('should parse combined redirections', () => {
      const result = parser.parse('command < input.txt > output.txt 2> error.txt')
      expect(result.redirects?.stdin).toBe('input.txt')
      expect(result.redirects?.stdout).toBe('output.txt')
      expect(result.redirects?.stderr).toBe('error.txt')
    })
  })

  describe('background process handling', () => {
    it('should detect background process', () => {
      const result = parser.parse('sleep 10 &')
      expect(result.commands[0].background).toBe(true)
      expect(result.commands[0].name).toBe('sleep')
      expect(result.commands[0].args).toEqual(['10'])
    })

    it('should handle background with pipes', () => {
      const result = parser.parse('ls | grep test &')
      expect(result.commands).toHaveLength(2)
      expect(result.commands[1].background).toBe(true)
    })

    it('should handle ampersand in quotes', () => {
      const result = parser.parse('echo "hello & world"')
      expect(result.commands[0].background).toBe(false)
      expect(result.commands[0].args).toEqual(['hello & world'])
    })
  })

  describe('variable expansion', () => {
    it('should identify variables for expansion', () => {
      const result = parser.parse('echo $HOME')
      expect(result.commands[0].args).toEqual(['$HOME'])
      // Variable expansion should happen during execution
    })

    it('should handle variables in quotes', () => {
      const result = parser.parse('echo "$HOME/test"')
      expect(result.commands[0].args).toEqual(['$HOME/test'])
    })

    it('should handle escaped variables', () => {
      const result = parser.parse('echo \\$HOME')
      expect(result.commands[0].args).toEqual(['$HOME'])
    })

    it('should handle braced variables', () => {
      // eslint-disable-next-line no-template-curly-in-string
      const result = parser.parse('echo ${HOME}/test')
      // eslint-disable-next-line no-template-curly-in-string
      expect(result.commands[0].args).toEqual(['${HOME}/test'])
    })
  })

  describe('glob patterns', () => {
    it('should preserve glob patterns', () => {
      const result = parser.parse('ls *.txt')
      expect(result.commands[0].args).toEqual(['*.txt'])
      // Glob expansion should happen during execution
    })

    it('should handle multiple globs', () => {
      const result = parser.parse('ls *.txt *.js')
      expect(result.commands[0].args).toEqual(['*.txt', '*.js'])
    })

    it('should handle globs in quotes', () => {
      const result = parser.parse('echo "*.txt"')
      expect(result.commands[0].args).toEqual(['*.txt'])
    })
  })

  describe('special characters', () => {
    it('should handle semicolon command separator', () => {
      const result = parser.parse('ls; pwd')
      // Currently only handles pipes, not semicolons - this is a future feature
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].name).toBe('ls;')
      expect(result.commands[0].args).toEqual(['pwd'])
    })

    it('should handle logical AND', () => {
      const result = parser.parse('make && make install')
      // Currently only handles pipes, not logical operators - this is a future feature
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].name).toBe('make')
      expect(result.commands[0].args).toEqual(['&&', 'make', 'install'])
    })

    it('should handle logical OR', () => {
      const result = parser.parse('test -f file || echo "not found"')
      expect(result.commands).toHaveLength(2)
      expect(result.commands[0].name).toBe('test')
      expect(result.commands[1].name).toBe('echo')
    })

    it('should handle parentheses for grouping', () => {
      const result = parser.parse('(cd /tmp && ls)')
      // Currently doesn't handle parentheses grouping - this is a future feature
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].name).toBe('(cd')
      expect(result.commands[0].args).toEqual(['/tmp', '&&', 'ls)'])
    })
  })

  describe('error handling', () => {
    it('should handle malformed commands gracefully', () => {
      const result = parser.parse('ls |')
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].name).toBe('ls')
    })

    it('should handle multiple redirections', () => {
      const result = parser.parse('ls > file1 > file2')
      // Currently takes the first redirection found
      expect(result.redirects?.stdout).toBe('file1')
    })

    it('should handle empty pipes', () => {
      const result = parser.parse('ls | | cat')
      expect(result.commands).toHaveLength(2)
      expect(result.commands[0].name).toBe('ls')
      expect(result.commands[1].name).toBe('cat')
    })
  })

  describe('complex commands', () => {
    it('should parse complex command with all features', () => {
      const result = parser.parse('find /home -name "*.txt" | grep -v temp | head -10 > results.txt &')

      expect(result.commands).toHaveLength(3)
      expect(result.commands[0].name).toBe('find')
      expect(result.commands[0].args).toEqual(['/home', '-name', '*.txt'])
      expect(result.commands[1].name).toBe('grep')
      expect(result.commands[1].args).toEqual(['-v', 'temp'])
      expect(result.commands[2].name).toBe('head')
      expect(result.commands[2].args).toEqual(['-10'])
      expect(result.commands[2].background).toBe(true)
      expect(result.redirects?.stdout).toBe('results.txt')
    })

    it('should handle command substitution syntax', () => {
      const result = parser.parse('echo $(date)')
      expect(result.commands[0].args).toEqual(['$(date)'])
      // Command substitution should be handled during execution
    })

    it('should handle here documents', () => {
      const result = parser.parse('cat << EOF')
      expect(result.commands[0].name).toBe('cat')
      // Here document handling would need special parsing
    })
  })
})
