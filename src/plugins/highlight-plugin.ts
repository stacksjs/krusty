import type { CommandResult, Plugin, PluginCommand, PluginContext } from '../types'
import { BasePlugin } from './index'

/**
 * Highlight Plugin
 * - Provides a demo highlight command and prepares hooks for future inline highlighting
 */
class HighlightPlugin extends BasePlugin implements Plugin {
  name = 'highlight'
  version = '1.0.0'
  description = 'Simple command highlighting utilities'
  author = 'Bunsh Team'
  bunshVersion = '>=1.0.0'

  commands: Record<string, PluginCommand> = {
    demo: {
      description: 'Show a highlighted example of a command line',
      usage: 'highlight:demo "your command here"',
      examples: ['highlight:demo "git commit -m \"feat: add plugin\""'],
      execute: async (args: string[], _context: PluginContext): Promise<CommandResult> => {
        const text = args.join(' ') || 'git commit -m "feat: add plugin" && bun test'
        const colored = this.syntaxColor(text)
        return { exitCode: 0, stdout: `${colored}\n`, stderr: '', duration: 0 }
      },
    },
  }

  // Simple lexer-style colorizer using ANSI sequences
  private syntaxColor(text: string): string {
    const reset = '\x1B[0m'
    const colors = {
      cmd: '\x1B[36m', // cyan
      flag: '\x1B[33m', // yellow
      str: '\x1B[32m', // green
      op: '\x1B[35m', // magenta
      path: '\x1B[34m', // blue
    }

    // Tokenize roughly: strings, flags, operators, paths, words
    const tokens: { v: string, t: 'str' | 'flag' | 'op' | 'path' | 'cmd' }[] = []
    const regex = /("[^"]*"|'[^']*'|-[\w-]+|[|&]{1,2}|\.{1,2}\/[\w./-]+|\/[\w./-]+|\w+)/g
    let m: RegExpExecArray | null
    let lastIndex = 0
    while ((m = regex.exec(text))) {
      if (m.index > lastIndex) {
        tokens.push({ v: text.slice(lastIndex, m.index), t: 'cmd' }) // keep spacing
      }
      const tok = m[0]
      let t: 'str' | 'flag' | 'op' | 'path' | 'cmd' = 'cmd'
      if (tok.startsWith('"') || tok.startsWith('\''))
        t = 'str'
      else if (tok.startsWith('--') || tok.startsWith('-'))
        t = 'flag'
      else if (tok === '|' || tok === '&&' || tok === '&')
        t = 'op'
      else if (tok.startsWith('/') || tok.startsWith('./') || tok.startsWith('../'))
        t = 'path'
      else t = 'cmd'
      tokens.push({ v: tok, t })
      lastIndex = regex.lastIndex
    }
    if (lastIndex < text.length)
      tokens.push({ v: text.slice(lastIndex), t: 'cmd' })

    return tokens
      .map((tk, idx) => {
        if (/^\s+$/.test(tk.v))
          return tk.v // keep spacing uncolored
        const color
          = tk.t === 'str' ? colors.str
            : tk.t === 'flag' ? colors.flag
              : tk.t === 'op' ? colors.op
                : tk.t === 'path' ? colors.path
                  : idx === 0 ? colors.cmd // treat first word as command
                    : colors.cmd
        return color + tk.v + reset
      })
      .join('')
  }

  async activate(context: PluginContext): Promise<void> {
    context.logger.info('Highlight plugin activated')
  }
}

const plugin: Plugin = new HighlightPlugin()
export default plugin
