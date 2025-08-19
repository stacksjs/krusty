import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
    _input: string,
    _context: Record<string, any>,
  ): Promise<string[]> {
    // This is a simplified implementation
    // In a real implementation, you would:
    // 1. Parse the input to determine the type of completion needed
    // 2. Delegate to appropriate completion providers (git, npm, file system, etc.)
    // 3. Apply any context-aware filtering

    // Placeholder implementation
    return []
  }

  public clearCache(): void {
    this.cache.clear()
    // In a real implementation, you would also delete the cache files
  }
}

export const completionManager: CompletionManager = new CompletionManager()
