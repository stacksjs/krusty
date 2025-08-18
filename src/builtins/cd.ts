import type { BuiltinCommand, CommandResult, Shell } from './types'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * CD (Change Directory) command - changes the current working directory
 * Supports tilde expansion, relative paths, and proper error handling
 */
export const cdCommand: BuiltinCommand = {
  name: 'cd',
  description: 'Change the current directory',
  usage: 'cd [directory]',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()

    // Default to home directory if no argument is provided
    const targetArg = args[0] || '~'

    try {
      // Handle tilde expansion for home directory
      let targetDir = targetArg.startsWith('~')
        ? targetArg.replace('~', homedir())
        : targetArg

      // Resolve relative paths against current working directory
      if (!targetDir.startsWith('/')) {
        targetDir = resolve(shell.cwd, targetDir)
      }
      else {
        // For absolute paths, resolve to handle any '..' or '.'
        targetDir = resolve(targetDir)
      }

      // Check if target exists
      if (!existsSync(targetDir)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `cd: ${targetArg}: No such file or directory\n`,
          duration: performance.now() - start,
        }
      }

      // Verify it's actually a directory
      const stat = statSync(targetDir)
      if (!stat.isDirectory()) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `cd: ${targetArg}: Not a directory\n`,
          duration: performance.now() - start,
        }
      }

      // Attempt to change directory using shell's method
      const success = shell.changeDirectory(targetDir)

      if (!success) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `cd: ${targetArg}: Permission denied\n`,
          duration: performance.now() - start,
        }
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: performance.now() - start,
      }
    }
    catch (error) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `cd: ${error instanceof Error ? error.message : 'Failed to change directory'}\n`,
        duration: performance.now() - start,
      }
    }
  },
}
