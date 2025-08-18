import { beforeEach, describe, expect, it } from 'bun:test'
import { defaultConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

describe('Bun CLI completions', () => {
  let shell: KrustyShell

  beforeEach(() => {
    shell = new KrustyShell({
      ...defaultConfig,
      completion: {
        enabled: true,
        caseSensitive: false,
        maxSuggestions: 50,
      },
    })
  })

  it('suggests bun subcommands and global flags as first arg', () => {
    const input = 'bun '
    const out = shell.getCompletions(input, input.length)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('run')
    expect(out).toContain('test')
    expect(out).toContain('--version')
  })

  it('filters subcommands by prefix', () => {
    const input = 'bun r'
    const out = shell.getCompletions(input, input.length)
    expect(out).toContain('run')
    // Should not include unrelated subcommands like 'test' for prefix 'r'
    expect(out.includes('test')).toBe(false)
  })

  it('suggests flags for bun run when last token starts with -', () => {
    const input = 'bun run -'
    const out = shell.getCompletions(input, input.length)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('--watch')
    expect(out).toContain('--inspect')
  })

  it('suggests values for value-bearing flags (e.g., --jsx-runtime)', () => {
    const input = 'bun run --jsx-runtime '
    const out = shell.getCompletions(input, input.length)
    expect(out).toContain('classic')
    expect(out).toContain('automatic')
  })

  it('suggests build flags for bun build', () => {
    const input = 'bun build -'
    const out = shell.getCompletions(input, input.length)
    expect(out).toContain('--outdir')
    expect(out).toContain('--sourcemap')
  })

  it('suggests install flags for add/install', () => {
    const input = 'bun add -'
    const out = shell.getCompletions(input, input.length)
    expect(out).toContain('--dev')
    expect(out).toContain('--exact')
  })

  it('suggests global flags by prefix', () => {
    const input = 'bun --v'
    const out = shell.getCompletions(input, input.length)
    expect(out).toContain('--version')
  })
})
