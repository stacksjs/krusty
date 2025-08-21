import type { KrustyConfig } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { defaultConfig, diffKrustyConfigs, validateKrustyConfig } from '../src/config'

describe('Config validation and diff', () => {
  it('validateKrustyConfig flags invalid values', () => {
    const bad: KrustyConfig = {
      ...defaultConfig,
      history: { ...defaultConfig.history, maxEntries: -1, searchMode: 'nope' as any, searchLimit: 0 },
      completion: { ...defaultConfig.completion, maxSuggestions: 0 },
      plugins: {} as any,
      hooks: '' as any,
    }

    const res = validateKrustyConfig(bad)
    expect(res.valid).toBeFalse()
    expect(res.errors.some(e => e.includes('history.maxEntries'))).toBeTrue()
    expect(res.errors.some(e => e.includes('history.searchMode'))).toBeTrue()
    expect(res.errors.some(e => e.includes('history.searchLimit'))).toBeTrue()
    expect(res.errors.some(e => e.includes('completion.maxSuggestions'))).toBeTrue()
    expect(res.errors.some(e => e.includes('plugins must be an array'))).toBeTrue()
    expect(res.errors.some(e => e.includes('hooks must be an object'))).toBeTrue()
  })

  it('validateKrustyConfig accepts good config', () => {
    const good: KrustyConfig = {
      ...defaultConfig,
      history: { ...defaultConfig.history, maxEntries: 100, searchMode: 'fuzzy', searchLimit: 50 },
      completion: { ...defaultConfig.completion, maxSuggestions: 5 },
      plugins: [],
      hooks: {},
    }

    const res = validateKrustyConfig(good)
    expect(res.valid).toBeTrue()
    expect(res.errors.length).toBe(0)
  })

  it('diffKrustyConfigs shows shallow changes', () => {
    const oldCfg: KrustyConfig = { ...defaultConfig }
    const newCfg: KrustyConfig = {
      ...defaultConfig,
      verbose: true,
      history: { ...defaultConfig.history, maxEntries: defaultConfig.history.maxEntries + 1 },
      completion: { ...defaultConfig.completion, maxSuggestions: (defaultConfig.completion.maxSuggestions ?? 10) + 1 },
      aliases: { ...defaultConfig.aliases, ll: 'ls -la' },
    }

    const diff = diffKrustyConfigs(oldCfg, newCfg)
    // Should include changed top-level keys
    expect(diff.some(line => line.startsWith('verbose:'))).toBeTrue()
    expect(diff.some(line => line.startsWith('history:'))).toBeTrue()
    expect(diff.some(line => line.startsWith('completion:'))).toBeTrue()
    expect(diff.some(line => line.startsWith('aliases:'))).toBeTrue()
  })
})
