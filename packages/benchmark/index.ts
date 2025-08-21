/* eslint-disable no-console */
import type { ExpansionContext } from '../../src/utils/expansion'
import process from 'node:process'
import { ExpansionEngine, ExpansionUtils } from '../../src/utils/expansion'

function hrtimeMs(): number {
  const t = process.hrtime.bigint()
  return Number(t / 1_000_000n)
}

async function timeit<T>(name: string, fn: () => Promise<T> | T, iters = 10000) {
  // warmup
  for (let i = 0; i < 100; i++) await fn()
  const start = hrtimeMs()
  for (let i = 0; i < iters; i++) await fn()
  const end = hrtimeMs()
  const total = end - start
  const per = total / iters
  console.log(`${name}: ${iters} iterations -> ${total} ms (${per.toFixed(3)} ms/op)`)
}

function makeEngine(ctx?: Partial<ExpansionContext>) {
  const context: ExpansionContext = {
    shell: { nounset: false } as any,
    cwd: process.cwd(),
    environment: { ...process.env } as Record<string, string>,
    ...ctx,
  }
  return new ExpansionEngine(context)
}

async function benchExpand() {
  console.log('\n=== expand() microbenchmarks ===')
  const engine = makeEngine()
  const noExp = 'just a normal string with no expansions'
  const simple = 'Hello $(echo world)'
  const nested = 'outer $(echo inner $(printf ok)) end'
  // eslint-disable-next-line no-template-curly-in-string
  const vars = 'Path is $PATH and home is ${HOME}'
  const large = `${'X'.repeat(5000)} $(echo y) ${'Z'.repeat(5000)}`

  await timeit('expand(no expansions)', () => engine.expand(noExp), 5000)
  await timeit('expand(vars only)', () => engine.expand(vars), 5000)
  await timeit('expand(command substitution sandbox echo)', () => engine.expand(simple), 2000)
  await timeit('expand(nested command substitution)', () => engine.expand(nested), 2000)
  await timeit('expand(large string with one expansion)', () => engine.expand(large), 1000)
}

async function benchSplitArgs() {
  console.log('\n=== splitArguments() cache microbenchmarks ===')
  const s = 'cmd "arg with spaces" single \'quote\' plain {a,b,c}'
  await timeit('splitArguments uncached (unique keys)', () => ExpansionUtils.splitArguments(s + Math.random()), 5000)
  await timeit('splitArguments cached (same key)', () => ExpansionUtils.splitArguments(s), 20000)
}

async function benchResolveExecutable() {
  console.log('\n=== resolveExecutable() memoization ===')
  const env = { ...process.env } as Record<string, string>
  await timeit('resolveExecutable("node") cached', () => ExpansionUtils.resolveExecutable('node', env), 5000)
  await timeit('resolveExecutable("uname" or "cmd") cached', () => ExpansionUtils.resolveExecutable(process.platform === 'win32' ? 'cmd' : 'uname', env), 5000)
}

async function benchArithmetic() {
  console.log('\n=== arithmetic expansion and cache ===')
  const engine = makeEngine({ environment: { ...process.env, A: '5', B: '10' } as Record<string, string> })
  const arith = '$(( 1 + 2 * 3 + 0x10 + 010 + A + B ))'
  await timeit('expand(arithmetic) cached', () => engine.expand(arith), 10000)
  // Change expression slightly to defeat cache
  await timeit('expand(arithmetic) varying', () => engine.expand(`$(( 1 + 2 * 3 + 0x10 + 010 + A + B + ${Math.floor(Math.random() * 2)} ))`), 5000)
}

async function benchCacheControls() {
  console.log('\n=== cache config and clear ===')
  ExpansionUtils.setCacheLimits({ arg: 50, exec: 100, arithmetic: 100 })
  ExpansionUtils.clearCaches()
  // simple smoke after clear
  const engine = makeEngine()
  await engine.expand('$(echo hi) $((1+2))')
}

async function main() {
  await benchExpand()
  await benchSplitArgs()
  await benchResolveExecutable()
  await benchArithmetic()
  await benchCacheControls()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
