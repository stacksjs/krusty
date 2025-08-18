import type { BuiltinCommand, CommandResult, Shell } from './types'

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
      const aliases = Object.entries(shell.aliases)
        .map(([name, value]) => formatAlias(name, value))
        .sort()
        .join('\n')

      return {
        exitCode: 0,
        stdout: aliases + (aliases ? '\n' : ''),
        stderr: '',
        duration: performance.now() - start,
      }
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

    // Reconstruct and parse definitions: support spaces and '=' in values.
    // We'll iterate tokens and group them into name=value definitions by using the first '='
    // When reconstructing the value, re-quote tokens that require quoting so that
    // complex values are preserved as expected by tests.
    const quoteIfNeeded = (s: string): string => {
      // Needs quoting if contains whitespace or shell-special characters
      const needs = /[\s"'!@#$%^&*()[\]|;<>?]/.test(s)
      if (!needs) return s
      // Prefer single quotes, escape internal single quotes by closing/opening
      return `'${s.replace(/'/g, '\'\\'\'')}'`
    }

    let i = 0
    while (i < args.length) {
      const token = args[i]
      if (!token || !token.trim()) {
        i++
        continue
      }

      const eq = token.indexOf('=')
      if (eq === -1) {
        // No '=' in this token -> treat as lookup for specific alias
        const aliasNameLookup = token.trim()
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

      // Start of a definition
      let aliasName = token.substring(0, eq).trim()
      const valuePart = token.substring(eq + 1)

      if (!aliasName) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'alias: invalid empty alias name\n',
          duration: performance.now() - start,
        }
      }

      // Consume all remaining tokens as part of the value
      const extraParts: string[] = []
      i++
      while (i < args.length) {
        extraParts.push(args[i])
        i++
      }

      // Build alias value: keep the first part (from the same token) as-is, only quote subsequent tokens if needed.
      const aliasValue = [valuePart, ...extraParts.map(quoteIfNeeded)].join(' ')

      // If the alias name is quoted, remove the quotes
      if ((aliasName.startsWith('"') && aliasName.endsWith('"'))
        || (aliasName.startsWith('\'') && aliasName.endsWith('\''))) {
        aliasName = aliasName.slice(1, -1)
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
