import type { BuiltinCommand, CommandResult, Shell } from '../types'

/**
 * Alias command - defines or displays command aliases
 * Supports creating, listing, and looking up aliases
 */
export const aliasCommand: BuiltinCommand = {
  name: 'alias',
  description: 'Define or display aliases',
  usage: 'alias [name[=value] ...]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    
    // Helper function to format alias output in the format: name=value
    const formatAlias = (name: string, value: string): string => {
      return `${name}=${value}`
    }

    // If no arguments, list all aliases
    if (args.length === 0) {
      // List all aliases
      const aliasEntries = Object.entries(shell.aliases)
      if (aliasEntries.length === 0) {
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      
      const output = aliasEntries
        .map(([name, value]) => `${name}=${value}`)
        .join('\n') + '\n'
      
      return { exitCode: 0, stdout: output, stderr: '' }
    }

    if (args.length === 1 && !args[0].includes('=')) {
      const aliasName = args[0].trim()
      if (aliasName in shell.aliases) {
        return {
          exitCode: 0,
          stdout: `${formatAlias(aliasName, shell.aliases[aliasName])}\n`,
          stderr: '',
          duration: performance.now() - start,
        }
      }
      else {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `alias: ${aliasName}: not found\n`,
          duration: performance.now() - start,
        }
      }
    }

    // Process each argument to set aliases
    for (const arg of args) {
      const trimmed = arg.trim()
      if (!trimmed) continue

      const eq = trimmed.indexOf('=')
      if (eq === -1) {
        // No '=' in this token -> treat as lookup for specific alias
        const aliasNameLookup = trimmed
        if (aliasNameLookup in shell.aliases) {
          return {
            exitCode: 0,
            stdout: `${formatAlias(aliasNameLookup, shell.aliases[aliasNameLookup])}\n`,
            stderr: '',
            duration: performance.now() - start,
          }
        }
        else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `alias: ${aliasNameLookup}: not found\n`,
            duration: performance.now() - start,
          }
        }
      }

      // Parse alias definition
      let aliasName = trimmed.substring(0, eq).trim()
      let aliasValue = trimmed.substring(eq + 1)

      if (!aliasName) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'alias: invalid empty alias name\n',
          duration: performance.now() - start,
        }
      }

      // Remove quotes from alias name if present
      if ((aliasName.startsWith('"') && aliasName.endsWith('"'))
        || (aliasName.startsWith('\'') && aliasName.endsWith('\''))) {
        aliasName = aliasName.slice(1, -1)
      }

      // Remove quotes from alias value if present
      if ((aliasValue.startsWith('"') && aliasValue.endsWith('"'))
        || (aliasValue.startsWith('\'') && aliasValue.endsWith('\''))) {
        aliasValue = aliasValue.slice(1, -1)
      }

      shell.aliases[aliasName] = aliasValue
    }

    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: performance.now() - start,
    }
  },
}
