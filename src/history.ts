import type { HistoryConfig } from './types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export class HistoryManager {
  private history: string[] = []
  private config: HistoryConfig

  constructor(config?: HistoryConfig) {
    this.config = {
      maxEntries: 10000,
      file: '~/.krusty_history',
      ignoreDuplicates: true,
      ignoreSpace: true,
      searchMode: 'fuzzy',
      ...config,
    }

    this.load()
  }

  add(command: string): void {
    // Skip empty commands
    if (!command.trim())
      return

    // Skip commands starting with space if configured
    if (this.config.ignoreSpace && command.startsWith(' '))
      return

    // Skip duplicates if configured
    if (this.config.ignoreDuplicates && this.history[this.history.length - 1] === command) {
      return
    }

    this.history.push(command)

    // Limit history size
    if (this.config.maxEntries && this.history.length > this.config.maxEntries) {
      this.history = this.history.slice(-this.config.maxEntries)
    }
  }

  getHistory(): string[] {
    return [...this.history]
  }

  search(query: string): string[] {
    if (!query.trim())
      return []

    const lowerQuery = query.toLowerCase()

    if (this.config.searchMode === 'exact') {
      return this.history.filter(cmd =>
        cmd.toLowerCase().includes(lowerQuery),
      )
    }

    // Fuzzy search
    return this.history.filter((cmd) => {
      const lowerCmd = cmd.toLowerCase()
      let queryIndex = 0

      for (let i = 0; i < lowerCmd.length && queryIndex < lowerQuery.length; i++) {
        if (lowerCmd[i] === lowerQuery[queryIndex]) {
          queryIndex++
        }
      }

      return queryIndex === lowerQuery.length
    })
  }

  clear(): void {
    this.history = []
  }

  load(): void {
    try {
      const filePath = this.expandPath(this.config.file!)

      if (!existsSync(filePath)) {
        return
      }

      const content = readFileSync(filePath, 'utf-8')
      this.history = content
        .split('\n')
        .filter(line => line.trim())
        .slice(-this.config.maxEntries!)
    }
    catch {
      // Silently fail - history is not critical
    }
  }

  save(): void {
    try {
      const filePath = this.expandPath(this.config.file!)
      const dir = dirname(filePath)

      // Ensure directory exists
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const content = this.history.join('\n')
      writeFileSync(filePath, content, 'utf-8')
    }
    catch {
      // Silently fail - history saving is not critical
    }
  }

  private expandPath(path: string): string {
    if (path.startsWith('~')) {
      return path.replace('~', homedir())
    }
    return resolve(path)
  }

  // Get recent commands (for completion)
  getRecent(limit = 10): string[] {
    return this.history.slice(-limit).reverse()
  }

  // Get command at specific index (1-based, like bash history)
  getCommand(index: number): string | undefined {
    if (index < 1 || index > this.history.length) {
      return undefined
    }
    return this.history[index - 1]
  }

  // Get commands matching pattern
  getMatching(pattern: RegExp): string[] {
    return this.history.filter(cmd => pattern.test(cmd))
  }

  // Remove command at index
  remove(index: number): boolean {
    if (index < 1 || index > this.history.length) {
      return false
    }
    this.history.splice(index - 1, 1)
    return true
  }

  // Get statistics
  getStats(): {
    totalCommands: number
    uniqueCommands: number
    mostUsed: Array<{ command: string, count: number }>
  } {
    const commandCounts = new Map<string, number>()

    for (const cmd of this.history) {
      const count = commandCounts.get(cmd) || 0
      commandCounts.set(cmd, count + 1)
    }

    const mostUsed = Array.from(commandCounts.entries())
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      totalCommands: this.history.length,
      uniqueCommands: commandCounts.size,
      mostUsed,
    }
  }
}
