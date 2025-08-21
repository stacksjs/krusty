import type { ExpansionContext } from '../src/utils/expansion'
import { describe, expect, it } from 'bun:test'
import { ExpansionEngine } from '../src/utils/expansion'

function makeEngine(ctx?: Partial<ExpansionContext>) {
  const context: ExpansionContext = {
    shell: { nounset: false } as any,
    cwd: process.cwd(),
    environment: {},
    ...ctx,
  }
  return new ExpansionEngine(context)
}

describe('ExpansionEngine command substitution sandbox', () => {
  it('allows echo in sandbox mode by default', async () => {
    const engine = makeEngine()
    const out = await engine.expand('hello $(echo world)')
    expect(out).toBe('hello world')
  })

  it('allows backticks with echo in sandbox mode', async () => {
    const engine = makeEngine()
    const out = await engine.expand('`echo hi` there')
    expect(out).toBe('hi there')
  })

  it('blocks non-allowlisted commands in sandbox mode', async () => {
    const engine = makeEngine()
    await expect(engine.expand('version: $(uname)')).rejects.toThrow()
  })

  it('blocks metacharacters in sandbox mode', async () => {
    const engine = makeEngine()
    await expect(engine.expand('x $(echo hi; echo bye) y')).rejects.toThrow()
    await expect(engine.expand('x $(echo hi | echo bye) y')).rejects.toThrow()
  })

  it('respects custom sandbox allowlist', async () => {
    const engine = makeEngine({ sandboxAllow: ['echo', 'printf', 'uname'] })
    const out = await engine.expand('uname: $(uname)')
    expect(out.startsWith('uname:')).toBe(true)
  })

  it('full mode executes via shell without sandbox restrictions', async () => {
    const engine = makeEngine({ substitutionMode: 'full' })
    const out = await engine.expand('$(printf a; printf b)')
    expect(out).toBe('ab')
  })
})
