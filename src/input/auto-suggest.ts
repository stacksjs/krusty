import type { Shell } from '../types'
import type { AutoSuggestOptions } from './types'
import process from 'node:process'
import * as readline from 'node:readline'

export type { AutoSuggestOptions } from './types'

export class AutoSuggestInput {
  private shell: Shell
  private options: AutoSuggestOptions
  private rl: readline.Interface | null = null

  constructor(shell: Shell, options: AutoSuggestOptions = {}) {
    this.shell = shell
    this.options = {
      maxSuggestions: 10,
      showInline: true,
      highlightColor: '\x1B[90m',
      suggestionColor: '\x1B[90m',
      keymap: 'emacs',
      syntaxHighlight: true,
      ...options,
    }
  }

  async readLine(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      // Check if stdin is a TTY (interactive) or pipe
      const isInteractive = process.stdin.isTTY

      if (!isInteractive) {
        // Handle piped input directly
        let data = ''
        process.stdin.setEncoding('utf8')
        
        process.stdin.on('data', (chunk) => {
          data += chunk
        })
        
        process.stdin.on('end', () => {
          const input = data.trim()
          if (process.env.KRUSTY_DEBUG) {
            console.error(`[DEBUG] Piped input received: "${input}"`)
          }
          resolve(input || null)
        })
        
        return
      }

      // Interactive mode - use readline
      let inputReceived = false

      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt,
      })

      this.rl.on('line', (input: string) => {
        if (process.env.KRUSTY_DEBUG) {
          console.error(`[DEBUG] Interactive input received: "${input}"`)
        }
        inputReceived = true
        this.rl?.close()
        this.rl = null
        resolve(input)
      })

      this.rl.on('close', () => {
        this.rl = null
        if (!inputReceived) {
          resolve(null)
        }
      })

      this.rl.on('SIGINT', () => {
        this.rl?.close()
        this.rl = null
        resolve('')
      })

      this.rl.prompt()
    })
  }

  // Public method for shells to refresh the prompt
  public refreshPrompt(prompt: string): void {
    // Don't write prompt if readline interface is active - it will handle it
    if (!this.rl) {
      process.stdout.write(prompt)
    }
  }

  // Method to enable shell mode
  setShellMode(_enabled: boolean): void {
    // Simple implementation - no special handling needed
  }

  // Method to reset state
  reset(): void {
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
  }
}
