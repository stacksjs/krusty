import type { CommandResult, Shell } from '../types'
import { ScriptExecutor } from './script-executor'
import { ScriptParser } from './script-parser'

export class ScriptManager {
  private parser = new ScriptParser()
  private executor = new ScriptExecutor()
  private shell: Shell

  constructor(shell: Shell) {
    this.shell = shell
  }

  async executeScript(input: string, options: { 
    exitOnError?: boolean
    isFile?: boolean 
  } = {}): Promise<CommandResult> {
    try {
      // Check if this looks like a script (contains control flow keywords)
      if (!this.isScript(input) && !options.isFile) {
        // Not a script, parse and execute directly without going through shell.execute to avoid recursion
        const parsed = await this.shell.parseCommand(input)
        if (parsed.commands.length === 0) {
          return { exitCode: 0, stdout: '', stderr: '', success: true }
        }
        // Execute the command chain directly
        return await (this.shell as any).executeCommandChain(parsed)
      }

      const script = await this.parser.parseScript(input, this.shell)
      return await this.executor.executeScript(script, this.shell, {
        exitOnError: options.exitOnError
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `Script execution error: ${errorMsg}`
      }
    }
  }

  async executeScriptFile(filePath: string, options: { exitOnError?: boolean } = {}): Promise<CommandResult> {
    try {
      const fs = await import('node:fs/promises')
      const content = await fs.readFile(filePath, 'utf-8')
      return await this.executeScript(content, { ...options, isFile: true })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `Failed to read script file: ${errorMsg}`
      }
    }
  }

  private isScript(input: string): boolean {
    const scriptKeywords = [
      'if ', 'then', 'else', 'elif', 'fi',
      'for ', 'while ', 'until ', 'do', 'done',
      'case ', 'in', 'esac',
      'function ', '() {'
    ]

    const lines = input.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (scriptKeywords.some(keyword => trimmed.includes(keyword))) {
        return true
      }
    }

    return false
  }

  isScriptKeyword(word: string): boolean {
    const keywords = new Set([
      'if', 'then', 'else', 'elif', 'fi',
      'for', 'while', 'until', 'do', 'done',
      'case', 'in', 'esac',
      'function', 'return', 'break', 'continue',
      'local', 'set'
    ])
    return keywords.has(word)
  }
}
