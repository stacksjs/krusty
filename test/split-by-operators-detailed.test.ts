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
    const parts = parser.splitByOperatorsDetailed("echo 'x || y' && echo z")
    expect(parts).toEqual([
      { segment: "echo 'x || y'", op: '&&' },
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
})
