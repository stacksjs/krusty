import { beforeEach, describe, expect, it } from 'bun:test'
import { defaultConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

/**
 * Tests for builtin-aware argument completions
 */
describe('Builtin argument completions', () => {
  let shell: KrustyShell

  beforeEach(() => {
    shell = new KrustyShell({
      ...defaultConfig,
      completion: { enabled: true, caseSensitive: false, maxSuggestions: 50 },
      environment: { ...defaultConfig.environment, PATH: process.env.PATH || '' },
    })
  })

  it('completes command names after `command` builtin', () => {
    const input = 'command ec'
    const out = shell.getCompletions(input, input.length)
    expect(out).toContain('echo')
  })

  it('completes directories for `cd`', () => {
    const input = 'cd ./'
    const out = shell.getCompletions(input, input.length)
    // Should only propose directories (ending with /)
    expect(out.every(x => x.endsWith('/'))).toBe(true)
  })

  it('suggests format strings for `printf` first arg', () => {
    const input = 'printf "'
    const out = shell.getCompletions(input, input.length)
    // At least some quoted format suggestions
    expect(out.some(x => x.startsWith('"%'))).toBe(true)
  })

  it('suggests optstrings and var for `getopts`', () => {
    const first = shell.getCompletions('getopts "', 'getopts "'.length)
    expect(first.length).toBeGreaterThan(0)
    const second = shell.getCompletions('getopts "ab:" ', 'getopts "ab:" '.length)
    expect(second.some(x => x === 'opt' || x === 'flag')).toBe(true)
  })

  it('completes env var names for `export` with =', () => {
    shell.environment.TEST_VAR_X = 'y'
    const input = 'export T'
    const out = shell.getCompletions(input, input.length)
    // includes TEST_VAR_X=
    expect(out.includes('TEST_VAR_X=')).toBe(true)
  })

  it('completes env var names for `unset`', () => {
    shell.environment.TO_REMOVE = '1'
    const input = 'unset T'
    const out = shell.getCompletions(input, input.length)
    expect(out).toContain('TO_REMOVE')
  })

  it('suggests common signals for `kill` and `trap`', () => {
    const killOut = shell.getCompletions('kill SI', 'kill SI'.length)
    expect(killOut.some(x => x.startsWith('SIG'))).toBe(true)
    const trapOut = shell.getCompletions('trap SI', 'trap SI'.length)
    expect(trapOut.some(x => x.startsWith('SIG'))).toBe(true)
  })

  it('completes command names for `type`, `which`, `hash`', () => {
    const typeOut = shell.getCompletions('type ec', 'type ec'.length)
    expect(typeOut).toContain('echo')
    const whichOut = shell.getCompletions('which ec', 'which ec'.length)
    expect(whichOut).toContain('echo')
    const hashOut = shell.getCompletions('hash ec', 'hash ec'.length)
    expect(hashOut).toContain('echo')
  })
})
