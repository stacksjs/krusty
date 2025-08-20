import { describe, expect, it } from 'bun:test'
import { displayWidth, stripAnsi, truncateToWidth, visibleLength } from '../src/input/ansi'

describe('ansi utils', () => {
  it('stripAnsi removes common sequences', () => {
    const s = '\x1B[31mred\x1B[0m \x1B[90mdim\x1B[0m'
    expect(stripAnsi(s)).toBe('red dim')
  })

  it('visibleLength counts characters without ANSI', () => {
    const s = '\x1B[36mhello\x1B[0m'
    expect(visibleLength(s)).toBe(5)
  })

  it('displayWidth counts ASCII as width 1', () => {
    expect(displayWidth('abc')).toBe(3)
  })

  it('displayWidth treats combining marks as width 0', () => {
    const s = 'e\u0301' // e + combining acute accent
    expect(displayWidth(s)).toBe(1)
  })

  it('displayWidth treats common CJK as width 2', () => {
    expect(displayWidth('你')).toBe(2)
    expect(displayWidth('好')).toBe(2)
  })

  it('displayWidth ignores ANSI in width', () => {
    const s = '\x1B[32m你\x1B[0mabc'
    expect(displayWidth(s)).toBe(2 + 3)
  })

  it('truncateToWidth respects width, not code units', () => {
    // emoji and CJK should not be split beyond width
    const s = '你a好'
    expect(truncateToWidth(s, 1)).toBe('') // first char is width 2, exceeds 1
    expect(truncateToWidth(s, 2)).toBe('你')
    expect(truncateToWidth(s, 3)).toBe('你a')
    expect(truncateToWidth(s, 4)).toBe('你a') // next char would exceed
    expect(truncateToWidth(s, 5)).toBe('你a好')
  })

  it('truncateToWidth works with combining characters', () => {
    const s = 'e\u0301e' // é + e (as combining)
    expect(truncateToWidth(s, 1)).toBe('e\u0301')
    expect(truncateToWidth(s, 2)).toBe('e\u0301e')
  })
})
