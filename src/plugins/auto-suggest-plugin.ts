import type { Plugin, PluginCompletion, PluginContext } from '../types'
import { BasePlugin } from './index'

/**
 * Auto Suggest Plugin
 * - Provides extra completions based on history and common corrections
 */
class AutoSuggestPlugin extends BasePlugin implements Plugin {
  name = 'auto-suggest'
  version = '1.0.0'
  description = 'Inline-like auto suggestions from history and common typos'
  author = 'Bunsh Team'
  bunshVersion = '>=1.0.0'

  // Suggestions from history and common corrections
  completions: PluginCompletion[] = [
    {
      // Match any input to consider suggestions
      command: '',
      complete: (input: string, _cursor: number, context: PluginContext): string[] => {
        const suggestions: string[] = []
        const partial = input.trim()

        // History suggestions (most recent first)
        const history = [...context.shell.history].reverse()
        for (const h of history) {
          if (!partial || h.startsWith(partial)) {
            if (!suggestions.includes(h))
              suggestions.push(h)
            if (suggestions.length >= (context.config.completion?.maxSuggestions || 10))
              break
          }
        }

        // Alias names
        for (const alias of Object.keys(context.shell.aliases)) {
          if (!partial || alias.startsWith(partial)) {
            if (!suggestions.includes(alias))
              suggestions.push(alias)
          }
        }

        // Common typo corrections for git
        const corrections: Record<string, string> = {
          gti: 'git',
          got: 'git',
          gut: 'git',
          gir: 'git',
          gits: 'git status',
          gitst: 'git status',
          gist: 'git status',
        }
        if (corrections[partial]) {
          suggestions.unshift(corrections[partial])
        }

        return suggestions.slice(0, context.config.completion?.maxSuggestions || 10)
      },
    },
  ]

  async activate(context: PluginContext): Promise<void> {
    context.logger.info('Auto-suggest plugin activated')
  }
}

const plugin: Plugin = new AutoSuggestPlugin()
export default plugin
