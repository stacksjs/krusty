import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { config } from '../config'

interface CompletionCache {
  timestamp: number
  completions: string[]
  context?: Record<string, any>
}

export class CompletionManager {
  private cache: Map<string, CompletionCache> = new Map()
  private cacheDir: string
  private cacheTtl: number
  private maxCacheSize: number

  constructor() {
    this.cacheDir = join(homedir(), '.krusty', 'cache', 'completions')
    this.cacheTtl = config.completion?.cache?.ttl || 60 * 60 * 1000 // 1 hour default
    this.maxCacheSize = config.completion?.cache?.maxEntries || 1000
    this.ensureCacheDir()
    this.loadCache()
  }

  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  private getCachePath(key: string): string {
    return join(this.cacheDir, `${key}.json`)
  }

  private loadCache(): void {
    try {
      if (!existsSync(this.cacheDir))
        return

      const now = Date.now()
      const files = readFileSync(this.cacheDir, 'utf8')
        .split('\n')
        .filter(Boolean)

      for (const file of files) {
        try {
          const cachePath = join(this.cacheDir, file)
          const cacheData = JSON.parse(readFileSync(cachePath, 'utf8'))

          // Skip expired cache entries
          if (cacheData.timestamp + this.cacheTtl > now) {
            this.cache.set(file.replace(/\.json$/, ''), cacheData)
          }
          else {
            // Clean up expired cache files
            // Note: In a real implementation, you'd delete the file
          }
        }
        catch (error) {
          console.warn(`Failed to load cache file ${file}:`, error)
        }
      }
    }
    catch (error) {
      console.warn('Failed to load completion cache:', error)
    }
  }

  private saveCache(): void {
    try {
      const entries = Array.from(this.cache.entries())
        .slice(0, this.maxCacheSize)
        .map(([key, value]) => [key, value] as const)

      // Clear existing cache files
      // Note: In a real implementation, you'd clear the cache directory

      // Write new cache entries
      for (const [key, data] of entries) {
        const cachePath = this.getCachePath(key)
        writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8')
      }
    }
    catch (error) {
      console.warn('Failed to save completion cache:', error)
    }
  }

  public async getCompletions(
    input: string,
    context: Record<string, any> = {},
    forceRefresh = false,
  ): Promise<string[]> {
    const cacheKey = this.generateCacheKey(input, context)
    const cached = this.cache.get(cacheKey)
    const now = Date.now()

    // Return cached results if they exist and are still valid
    if (!forceRefresh && cached && (cached.timestamp + this.cacheTtl) > now) {
      return cached.completions
    }

    // Generate new completions
    const completions = await this.generateCompletions(input, context)

    // Update cache
    this.cache.set(cacheKey, {
      timestamp: now,
      completions,
      context,
    })

    // Ensure we don't exceed max cache size
    if (this.cache.size > this.maxCacheSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, this.maxCacheSize)

      this.cache = new Map(entries)
    }

    this.saveCache()
    return completions
  }

  private generateCacheKey(input: string, context: Record<string, any>): string {
    // Create a deterministic key based on input and relevant context
    const contextStr = Object.entries(context)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
      .join('|')

    return `${input}|${contextStr}`
  }

  private async generateCompletions(
    input: string,
    context: Record<string, any>,
  ): Promise<string[]> {
    const shell = context.shell
    if (!shell) return []

    const cursor = context.cursor || input.length
    const tokens = this.tokenize(input)
    const before = input.slice(0, Math.max(0, cursor))
    const isFirstToken = !before.includes(' ') || before.trim() === tokens[0]

    let completions: string[] = []

    try {
      if (isFirstToken) {
        // Command completions (builtins, aliases, PATH commands)
        const partial = before.trim()
        completions = this.getCommandCompletions(partial, shell)
      } else {
        // Argument completions (files, directories, etc.)
        const lastToken = tokens[tokens.length - 1] || ''
        completions = this.getArgumentCompletions(lastToken, shell)
      }

      // Add plugin completions
      if (shell.pluginManager?.getPluginCompletions) {
        try {
          const pluginCompletions = shell.pluginManager.getPluginCompletions(input, cursor) || []
          completions = [...new Set([...completions, ...pluginCompletions])]
        } catch (error) {
          console.warn('Error getting plugin completions:', error)
        }
      }

      // Apply filtering and sorting
      const filtered = completions.filter(c => c && c.trim().length > 0)
      const maxSuggestions = shell.config.completion?.maxSuggestions || 10
      
      return filtered
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .slice(0, maxSuggestions)

    } catch (error) {
      console.warn('Error generating completions:', error)
      return []
    }
  }

  private getCommandCompletions(prefix: string, shell: any): string[] {
    const builtins = Array.from(shell.builtins.keys()) as string[]
    const aliases = Object.keys(shell.aliases || {})
    const pathCommands = this.getPathCommands()
    const caseSensitive = shell.config.completion?.caseSensitive ?? false

    const match = (s: string) =>
      caseSensitive ? s.startsWith(prefix) : s.toLowerCase().startsWith(prefix.toLowerCase())

    const b = builtins.filter(match)
    const a = aliases.filter(match)
    const p = pathCommands.filter(match)

    // Keep order: builtins, aliases, then PATH commands; dedupe while preserving order
    const ordered = [...b, ...a, ...p]
    const seen = new Set<string>()
    const result: string[] = []
    for (const cmd of ordered) {
      if (!seen.has(cmd)) {
        seen.add(cmd)
        result.push(cmd)
      }
    }

    return result
  }

  private getArgumentCompletions(partial: string, _shell: any): string[] {
    // File and directory completions
    try {
      let searchPath = partial
      let prefix = ''

      if (partial.includes('/')) {
        searchPath = dirname(partial)
        prefix = basename(partial)
      } else {
        searchPath = '.'
        prefix = partial
      }

      // Handle ~ expansion
      if (searchPath.startsWith('~')) {
        searchPath = searchPath.replace(/^~/, homedir())
      }

      const fullPath = resolve(searchPath)
      const entries = readdirSync(fullPath)

      return entries
        .filter((entry: string) => entry.startsWith(prefix))
        .map((entry: string) => {
          const entryPath = join(fullPath, entry)
          const isDir = statSync(entryPath).isDirectory()
          const result = partial.includes('/') 
            ? join(searchPath, entry) 
            : entry
          return isDir ? `${result}/` : result
        })
        .slice(0, 20) // Limit file completions
    } catch {
      return []
    }
  }

  private getPathCommands(): string[] {
    const pathCache = this.cache.get('PATH_COMMANDS')
    const now = Date.now()
    
    if (pathCache && (pathCache.timestamp + this.cacheTtl) > now) {
      return pathCache.completions
    }

    try {
      const pathDirs = (process.env.PATH || '').split(':').filter(Boolean)
      const commands = new Set<string>()

      for (const dir of pathDirs) {
        try {
          const entries = readdirSync(dir)
          for (const entry of entries) {
            try {
              const fullPath = join(dir, entry)
              const stat = statSync(fullPath)
              if (stat.isFile() && (stat.mode & 0o111)) {
                commands.add(entry)
              }
            } catch {
              // Skip inaccessible files
            }
          }
        } catch {
          // Skip inaccessible directories
        }
      }

      const result = Array.from(commands).sort()
      
      // Cache the result
      this.cache.set('PATH_COMMANDS', {
        timestamp: now,
        completions: result,
      })

      return result
    } catch {
      return []
    }
  }

  private tokenize(input: string): string[] {
    const tokens: string[] = []
    let current = ''
    let inQuotes = false
    let quoteChar = ''
    let escapeNext = false

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

      if (escapeNext) {
        current += char
        escapeNext = false
        continue
      }

      if (char === '\\' && (!inQuotes || (inQuotes && quoteChar === '"'))) {
        escapeNext = true
        continue
      }

      if ((char === '"' || char === '\'') && !escapeNext) {
        if (inQuotes && char === quoteChar) {
          current += char
          inQuotes = false
          quoteChar = ''
        } else if (!inQuotes) {
          inQuotes = true
          quoteChar = char
          current += char
        } else {
          current += char
        }
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          tokens.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }

    if (current) {
      tokens.push(current)
    }

    return tokens
  }

  public clearCache(): void {
    this.cache.clear()
    // In a real implementation, you would also delete the cache files
  }
}

export const completionManager: CompletionManager = new CompletionManager()
