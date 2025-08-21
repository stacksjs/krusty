import { describe, expect, it } from 'bun:test'
import { CommandParser } from '../src/parser'

describe('CommandParser.tokenize edge cases', () => {
  const parser = new CommandParser()

  it('preserves quoted substrings as single tokens', () => {
    const tokens = parser.tokenize('echo "a b" c')
    expect(tokens).toEqual(['echo', '"a b"', 'c'])
  })

  it('keeps escape before a quote', () => {
    const tokens = parser.tokenize('echo \"hello\"')
    expect(tokens).toEqual(['echo', '\"hello\"'])
  })

  it('keeps trailing backslash literally', () => {
    const tokens = parser.tokenize('echo foo\\')
    expect(tokens).toEqual(['echo', 'foo\\'])
  })

  it('handles single quotes with spaces', () => {
    const tokens = parser.tokenize('echo \'a b c\'')
    expect(tokens).toEqual(['echo', '\'a b c\''])
  })

  it('handles escaped spaces within a token', () => {
    const tokens = parser.tokenize('echo a\\ b')
    expect(tokens).toEqual(['echo', 'a\\ b'])
  })

  it('splits on unquoted whitespace (spaces, tabs)', () => {
    const tokens = parser.tokenize('cmd   arg1\targ2')
    expect(tokens).toEqual(['cmd', 'arg1', 'arg2'])
  })
})
