import { beforeEach, describe, expect, it } from 'bun:test'
import { RedirectionHandler } from '../src/utils/redirection'

describe('RedirectionHandler', () => {
  describe('parseRedirections', () => {
    it('should parse basic output redirection', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('echo hello > output.txt')
      expect(cleanCommand).toBe('echo hello')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'file',
        direction: 'output',
        target: 'output.txt',
      })
    })

    it('should parse append redirection', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('echo hello >> output.txt')
      expect(cleanCommand).toBe('echo hello')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'file',
        direction: 'append',
        target: 'output.txt',
      })
    })

    it('should parse input redirection', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('cat < input.txt')
      expect(cleanCommand).toBe('cat')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'file',
        direction: 'input',
        target: 'input.txt',
      })
    })

    it('should parse stderr redirection', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('command 2> error.log')
      expect(cleanCommand).toBe('command')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'file',
        direction: 'error',
        target: 'error.log',
      })
    })

    it('should parse combined stdout and stderr redirection', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('command &> output.txt')
      expect(cleanCommand).toBe('command')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'file',
        direction: 'both',
        target: 'output.txt',
      })
    })

    it('should parse here string', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('cat <<< "hello world"')
      expect(cleanCommand).toBe('cat')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'here-string',
        direction: 'input',
        target: '"hello world"',
      })
    })

    it('should parse here document', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('cat << EOF')
      expect(cleanCommand).toBe('cat')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'here-doc',
        direction: 'input',
        target: 'EOF',
      })
    })

    it('should parse multiple redirections', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('command < input.txt > output.txt 2> error.log')
      expect(cleanCommand).toBe('command')
      expect(redirections).toHaveLength(3)

      const inputRedir = redirections.find(r => r.direction === 'input')
      const outputRedir = redirections.find(r => r.direction === 'output')
      const errorRedir = redirections.find(r => r.direction === 'error')

      expect(inputRedir?.target).toBe('input.txt')
      expect(outputRedir?.target).toBe('output.txt')
      expect(errorRedir?.target).toBe('error.log')
    })

    it('should parse file descriptor redirection', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('command 2>&1')
      expect(cleanCommand).toBe('command')
      expect(redirections).toHaveLength(1)
      expect(redirections[0]).toEqual({
        type: 'fd',
        direction: 'output',
        target: '&1',
        fd: 2,
      })
    })

    it('should handle commands without redirections', () => {
      const { cleanCommand, redirections } = RedirectionHandler.parseRedirections('echo hello world')
      expect(cleanCommand).toBe('echo hello world')
      expect(redirections).toHaveLength(0)
    })
  })

  describe('parseHereDocument', () => {
    it('should parse here document content', () => {
      const lines = [
        'line 1',
        'line 2',
        'EOF',
        'remaining line',
      ]

      const { content, remainingLines } = RedirectionHandler.parseHereDocument(lines, 'EOF')
      expect(content).toBe('line 1\nline 2')
      expect(remainingLines).toEqual(['remaining line'])
    })

    it('should handle empty here document', () => {
      const lines = ['EOF', 'remaining']
      const { content, remainingLines } = RedirectionHandler.parseHereDocument(lines, 'EOF')
      expect(content).toBe('')
      expect(remainingLines).toEqual(['remaining'])
    })

    it('should handle missing delimiter', () => {
      const lines = ['line 1', 'line 2']
      const { content, remainingLines } = RedirectionHandler.parseHereDocument(lines, 'EOF')
      expect(content).toBe('line 1\nline 2')
      expect(remainingLines).toEqual([])
    })
  })

  describe('createRedirectionConfig', () => {
    it('should create config for input redirection', () => {
      const redirections = [{
        type: 'file' as const,
        direction: 'input' as const,
        target: 'input.txt',
      }]

      const config = RedirectionHandler.createRedirectionConfig(redirections)
      expect(config.stdin).toBe('input.txt')
    })

    it('should create config for output redirection', () => {
      const redirections = [{
        type: 'file' as const,
        direction: 'output' as const,
        target: 'output.txt',
      }]

      const config = RedirectionHandler.createRedirectionConfig(redirections)
      expect(config.stdout).toBe('output.txt')
    })

    it('should create config for append redirection', () => {
      const redirections = [{
        type: 'file' as const,
        direction: 'append' as const,
        target: 'output.txt',
      }]

      const config = RedirectionHandler.createRedirectionConfig(redirections)
      expect(config.stdout).toBe('output.txt')
      expect(config.stdoutAppend).toBe(true)
    })

    it('should create config for here string', () => {
      const redirections = [{
        type: 'here-string' as const,
        direction: 'input' as const,
        target: 'hello world',
      }]

      const config = RedirectionHandler.createRedirectionConfig(redirections)
      expect(config.hereString).toBe('hello world')
    })

    it('should create config for combined redirection', () => {
      const redirections = [{
        type: 'file' as const,
        direction: 'both' as const,
        target: 'output.txt',
      }]

      const config = RedirectionHandler.createRedirectionConfig(redirections)
      expect(config.stdout).toBe('output.txt')
      expect(config.stderr).toBe('output.txt')
      expect(config.combineStderr).toBe(true)
    })
  })
})
