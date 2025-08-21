import { describe, expect, it } from 'bun:test'
import { CommandParser } from '../src/parser'

describe('CommandParser.splitByOperatorsDetailed', () => {
  const parser = new CommandParser()

  it('splits simple operators ;, &&, || left-to-right', () => {
    const parts = parser.splitByOperatorsDetailed('a; b && c || d')
    expect(parts).toEqual([
      { segment: 'a', op: ';' },
      { segment: 'b', op: '&&' },
      { segment: 'c', op: '||' },
      { segment: 'd' },
    ])
  })

  it('does not split inside double quotes', () => {
    const parts = parser.splitByOperatorsDetailed('echo "x && y"; echo z')
    expect(parts).toEqual([
      { segment: 'echo "x && y"', op: ';' },
      { segment: 'echo z' },
    ])
  })

  it('does not split inside single quotes', () => {
    const parts = parser.splitByOperatorsDetailed('echo \'x || y\' && echo z')
    expect(parts).toEqual([
      { segment: 'echo \'x || y\'', op: '&&' },
      { segment: 'echo z' },
    ])
  })

  it('does not split when && is escaped', () => {
    const parts = parser.splitByOperatorsDetailed('echo foo \\&\\& bar; echo done')
    expect(parts).toEqual([
      { segment: 'echo foo \\\&\\\& bar', op: ';' },
      { segment: 'echo done' },
    ])
  })

  it('does not split when || is escaped', () => {
    const parts = parser.splitByOperatorsDetailed('echo foo \\|\\| bar; echo done')
    expect(parts).toEqual([
      { segment: 'echo foo \\\|\\\| bar', op: ';' },
      { segment: 'echo done' },
    ])
  })

  it('multiline here-doc content is not split (conservative behavior)', () => {
    const input = 'cat <<EOF\nA && B || C\nEOF\n&& echo after'
    const parts = parser.splitByOperatorsDetailed(input)
    // Current splitter conservatively avoids splitting once here-doc start is seen
    expect(parts).toEqual([
      { segment: input },
    ])
  })

  it('does not split after here-doc start (single-line safety)', () => {
    const parts = parser.splitByOperatorsDetailed('cat <<EOF && echo should-not-split; echo nope')
    // Once << is encountered, splitter avoids further splitting for this line
    expect(parts).toEqual([
      { segment: 'cat <<EOF && echo should-not-split; echo nope' },
    ])
  })

  it('trims whitespace around segments and ignores empty segments', () => {
    const parts = parser.splitByOperatorsDetailed('  echo a  ;   echo b   ')
    expect(parts).toEqual([
      { segment: 'echo a', op: ';' },
      { segment: 'echo b' },
    ])
  })

  it('does not split inside if...fi blocks', () => {
    const input = 'if true; then echo A && echo B; else echo C || echo D; fi && echo E'
    const parts = parser.splitByOperatorsDetailed(input)
    expect(parts).toEqual([
      { segment: 'if true; then echo A && echo B; else echo C || echo D; fi', op: '&&' },
      { segment: 'echo E' },
    ])
  })

  it('does not split inside nested if...fi blocks', () => {
    const input = 'if true; then if false; then echo X; else echo Y; fi; else echo Z; fi || echo AFTER'
    const parts = parser.splitByOperatorsDetailed(input)
    expect(parts).toEqual([
      { segment: 'if true; then if false; then echo X; else echo Y; fi; else echo Z; fi', op: '||' },
      { segment: 'echo AFTER' },
    ])
  })

  it('does not split inside do...done loops', () => {
    const input = 'for i in 1 2; do echo $i && echo inner; done || echo after'
    const parts = parser.splitByOperatorsDetailed(input)
    expect(parts).toEqual([
      { segment: 'for i in 1 2; do echo $i && echo inner; done', op: '||' },
      { segment: 'echo after' },
    ])
  })

  it('does not split inside case...esac blocks', () => {
    const input = 'case x in a) echo A ;; *) echo B && echo C ;; esac; echo after'
    const parts = parser.splitByOperatorsDetailed(input)
    expect(parts).toEqual([
      { segment: 'case x in a) echo A ;; *) echo B && echo C ;; esac', op: ';' },
      { segment: 'echo after' },
    ])
  })

  it('does not split inside brace blocks', () => {
    const input = '{ echo A && echo B; }; echo C'
    const parts = parser.splitByOperatorsDetailed(input)
    expect(parts).toEqual([
      { segment: '{ echo A && echo B; }', op: ';' },
      { segment: 'echo C' },
    ])
  })
})
