import { describe, it, expect } from 'bun:test'
import { supportsColor, dim, bold, cyan, yellow, green, red, color256, hexTo256, banner, ansi } from '../src/utils/style'

describe('style utils', () => {
  it('supportsColor respects overrides', () => {
    expect(supportsColor({ forceColor: true })).toBe(true)
    expect(supportsColor({ noColor: true })).toBe(false)
  })

  it('dim wraps when color enabled', () => {
    const s = dim('x', true)
    expect(s.startsWith(ansi.codes.dim)).toBe(true)
    expect(s.endsWith(ansi.codes.reset)).toBe(true)
  })

  it('dim is pass-through when disabled', () => {
    const s = dim('x', false)
    expect(s).toBe('x')
  })

  it('basic colors produce ansi', () => {
    const s1 = bold('a', true)
    const s2 = cyan('a', true)
    const s3 = yellow('a', true)
    const s4 = green('a', true)
    const s5 = red('a', true)
    expect(s1.startsWith(ansi.codes.bold)).toBe(true)
    expect(s2.startsWith(ansi.codes.cyan)).toBe(true)
    expect(s3.startsWith(ansi.codes.yellow)).toBe(true)
    expect(s4.startsWith(ansi.codes.green)).toBe(true)
    expect(s5.startsWith(ansi.codes.red)).toBe(true)
    ;[s1, s2, s3, s4, s5].forEach(s => {
      expect(s.endsWith(ansi.codes.reset)).toBe(true)
    })
  })

  it('banner composes dim + color', () => {
    const b = banner('test', 'cyan', { forceColor: true })
    expect(b.includes('─── test ───')).toBe(true)
    // Should start with dim then cyan; exact nesting order equals dim(cyan(text)) in implementation
    expect(b.startsWith(ansi.codes.dim)).toBe(true)
    expect(b.includes(ansi.codes.cyan)).toBe(true)
    expect(b.endsWith(ansi.codes.reset)).toBe(true)
  })

  it('hexTo256 maps colors', () => {
    const n = hexTo256('#ffffff')
    expect(typeof n).toBe('number')
    expect(n).toBeGreaterThanOrEqual(16)
    expect(n).toBeLessThanOrEqual(231)
  })

  it('color256 applies 256-color sequence', () => {
    const s = color256('z', 33, true)
    expect(s.startsWith(ansi.codes.fg(33))).toBe(true)
    expect(s.endsWith(ansi.codes.reset)).toBe(true)
  })

  it('ansi exports raw codes', () => {
    expect(typeof ansi.codes.reset).toBe('string')
  })
})
