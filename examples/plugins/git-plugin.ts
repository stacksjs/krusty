import type { CommandResult, HookContext, HookResult, PluginCommand, PluginContext } from '../../src/types'
import { BasePlugin } from '../../src/plugins'

/**
 * Git Plugin - Extends krusty with additional Git functionality
 *
 * This plugin demonstrates:
 * - Custom commands
 * - Hook handlers
 * - Plugin configuration
 * - Utility usage
 */
export class GitPlugin extends BasePlugin {
  name = 'git-plugin'
  version = '1.0.0'
  description = 'Enhanced Git functionality for krusty'
  author = 'Krusty Team'
  krustyVersion = '>=1.0.0'

  // Plugin commands
  commands: Record<string, PluginCommand> = {
    'git-status': {
      description: 'Enhanced git status with colors and icons',
      usage: 'git-plugin:git-status [--short]',
      examples: [
        'git-plugin:git-status',
        'git-plugin:git-status --short',
      ],
      execute: async (args: string[], context: PluginContext): Promise<CommandResult> => {
        const isShort = args.includes('--short')

        try {
          const result = await context.utils.exec('git status --porcelain', { cwd: context.shell.cwd })

          if (result.exitCode !== 0) {
            return {
              exitCode: result.exitCode,
              stdout: '',
              stderr: 'Not a git repository or git not found\n',
              duration: 0,
            }
          }

          const lines = result.stdout.trim().split('\n').filter(line => line.trim())

          if (lines.length === 0) {
            return {
              exitCode: 0,
              stdout: '✅ Working tree clean\n',
              stderr: '',
              duration: 0,
            }
          }

          let output = ''

          if (!isShort) {
            output += `📊 Git Status (${lines.length} changes):\n\n`
          }

          for (const line of lines) {
            const status = line.substring(0, 2)
            const file = line.substring(3)

            let icon = '📄'
            let statusText = status

            // Map status codes to icons and descriptions
            switch (status.trim()) {
              case 'M':
                icon = '📝'
                statusText = isShort ? 'M' : 'Modified'
                break
              case 'A':
                icon = '➕'
                statusText = isShort ? 'A' : 'Added'
                break
              case 'D':
                icon = '🗑️'
                statusText = isShort ? 'D' : 'Deleted'
                break
              case 'R':
                icon = '🔄'
                statusText = isShort ? 'R' : 'Renamed'
                break
              case '??':
                icon = '❓'
                statusText = isShort ? '?' : 'Untracked'
                break
              case 'MM':
                icon = '⚠️'
                statusText = isShort ? 'MM' : 'Modified (staged & unstaged)'
                break
            }

            if (isShort) {
              output += `${icon} ${statusText} ${file}\n`
            }
            else {
              output += `  ${icon} ${statusText.padEnd(10)} ${file}\n`
            }
          }

          return {
            exitCode: 0,
            stdout: output,
            stderr: '',
            duration: 0,
          }
        }
        catch (error) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
            duration: 0,
          }
        }
      },
    },

    'git-quick-commit': {
      description: 'Quick commit with automatic message generation',
      usage: 'git-plugin:git-quick-commit [message]',
      examples: [
        'git-plugin:git-quick-commit',
        'git-plugin:git-quick-commit "Custom commit message"',
      ],
      execute: async (args: string[], context: PluginContext): Promise<CommandResult> => {
        try {
          // Check if there are changes to commit
          const statusResult = await context.utils.exec('git status --porcelain', { cwd: context.shell.cwd })

          if (statusResult.stdout.trim() === '') {
            return {
              exitCode: 0,
              stdout: '✅ Nothing to commit, working tree clean\n',
              stderr: '',
              duration: 0,
            }
          }

          // Stage all changes
          const addResult = await context.utils.exec('git add .', { cwd: context.shell.cwd })
          if (addResult.exitCode !== 0) {
            return {
              exitCode: addResult.exitCode,
              stdout: '',
              stderr: addResult.stderr,
              duration: 0,
            }
          }

          // Generate commit message if not provided
          let message = args.join(' ')
          if (!message) {
            const changes = statusResult.stdout.trim().split('\n')
            const fileCount = changes.length
            const hasModified = changes.some(line => line.startsWith(' M') || line.startsWith('M'))
            const hasAdded = changes.some(line => line.startsWith('A') || line.startsWith('??'))
            const hasDeleted = changes.some(line => line.startsWith(' D') || line.startsWith('D'))

            if (fileCount === 1) {
              const file = changes[0].substring(3)
              message = `Update ${file}`
            }
            else {
              const parts = []
              if (hasAdded)
                parts.push('add')
              if (hasModified)
                parts.push('update')
              if (hasDeleted)
                parts.push('remove')

              message = `${parts.join(', ')} ${fileCount} files`
            }
          }

          // Commit changes
          const commitResult = await context.utils.exec(`git commit -m "${message}"`, { cwd: context.shell.cwd })

          if (commitResult.exitCode === 0) {
            return {
              exitCode: 0,
              stdout: `✅ Committed: ${message}\n${commitResult.stdout}`,
              stderr: '',
              duration: 0,
            }
          }
          else {
            return {
              exitCode: commitResult.exitCode,
              stdout: '',
              stderr: commitResult.stderr,
              duration: 0,
            }
          }
        }
        catch (error) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
            duration: 0,
          }
        }
      },
    },
  }

  // Plugin aliases
  aliases = {
    gs: 'git-plugin:git-status',
    gss: 'git-plugin:git-status --short',
    gqc: 'git-plugin:git-quick-commit',
  }

  // Hook handlers
  hooks = {
    'directory:change': async (context: HookContext): Promise<HookResult> => {
      // Auto-fetch when entering a git repository
      try {
        const result = await context.shell.execute('git rev-parse --is-inside-work-tree')
        if (result.exitCode === 0) {
          // This is a git repository, show status
          const statusResult = await context.shell.execute('git status --porcelain')
          if (statusResult.stdout.trim()) {
            // eslint-disable-next-line no-console
            console.log('📊 Git changes detected in this repository')
          }
        }
      }
      catch {
        // Not a git repository, ignore
      }

      return { success: true }
    },

    'command:before': async (context: HookContext): Promise<HookResult> => {
      // Auto-suggest git commands for common typos
      const command = context.data.command as string

      const suggestions: Record<string, string> = {
        gti: 'git',
        got: 'git',
        gut: 'git',
        gi: 'git',
        gir: 'git',
        gits: 'git status',
        gitst: 'git status',
        gist: 'git status',
      }

      const firstWord = command.split(' ')[0]
      if (suggestions[firstWord]) {
        // eslint-disable-next-line no-console
        console.log(`💡 Did you mean: ${suggestions[firstWord]}?`)
      }

      return { success: true }
    },
  }

  async initialize(context: PluginContext): Promise<void> {
    context.logger.info('Git plugin initializing...')

    // Check if git is available
    try {
      await context.utils.exec('git --version')
      context.logger.info('Git found and ready')
    }
    catch {
      context.logger.warn('Git not found in PATH - some features may not work')
    }
  }

  async activate(context: PluginContext): Promise<void> {
    context.logger.info('Git plugin activated')

    // Show welcome message if in a git repository
    try {
      const result = await context.utils.exec('git rev-parse --is-inside-work-tree', { cwd: context.shell.cwd })
      if (result.exitCode === 0) {
        // eslint-disable-next-line no-console
        console.log('🚀 Git plugin loaded - Enhanced git commands available!')
        // eslint-disable-next-line no-console
        console.log('   Try: gs (git status), gqc (quick commit)')
      }
    }
    catch {
      // Not in a git repository
    }
  }

  async deactivate(context: PluginContext): Promise<void> {
    context.logger.info('Git plugin deactivated')
  }
}

// Export plugin instance
const gitPlugin: GitPlugin = new GitPlugin()
export default gitPlugin
