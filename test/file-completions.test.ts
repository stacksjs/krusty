import { beforeEach, describe, expect, it } from 'bun:test'
import { defaultConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

describe('File/path completions edge cases', () => {
  let shell: KrustyShell

  beforeEach(() => {
    shell = new KrustyShell({
      ...defaultConfig,
      completion: {
        enabled: true,
        caseSensitive: false,
        maxSuggestions: 100,
      },
    })
  })

  it('handles single-quoted path fragments', () => {
    const input = 'cat \'./src/co'
    const out = shell.getCompletions(input, input.length)
    expect(out.some(x => x.includes('completion.ts'))).toBe(true)
  })

  it('hides dot-directories unless prefix starts with .', () => {
    // Without leading dot prefix, should not show .github/
    const noDot = shell.getCompletions('ls ./', 'ls ./'.length)
    expect(noDot.includes('.github/')).toBe(false)

    // With dot prefix, should suggest .github/
    const withDot = shell.getCompletions('ls .g', 'ls .g'.length)
    expect(withDot).toContain('.github/')
  })

  it('suggests directory entries with trailing slash when base ends with /', () => {
    const input = 'ls docs/'
    const out = shell.getCompletions(input, input.length)
    // Should contain subdirectories of docs ending with /
    expect(out.some(x => x.endsWith('/'))).toBe(true)
  })
})
