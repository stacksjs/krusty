import type { KrustyConfig, Plugin, PluginConfig, PluginContext, Shell } from '../types'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { config } from '../config'
import { Logger } from '../logger'

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private pluginDir: string
  private updateInterval: NodeJS.Timeout | null = null
  private shell: Shell
  private config: KrustyConfig
  // Keep lazily-configured plugins to load on demand
  private lazyPlugins: Map<string, { item: NonNullable<PluginConfig['list']>[number], parent: PluginConfig }> = new Map()

  // Safely invoke lifecycle methods and isolate errors per plugin
  private async callLifecycle<K extends 'initialize' | 'activate' | 'deactivate' | 'destroy'>(
    plugin: Plugin,
    phase: K,
    context: PluginContext | undefined,
  ): Promise<boolean> {
    const logger = this.shell?.log
    try {
      const fn = (plugin as any)[phase] as ((ctx: PluginContext) => Promise<void> | void) | undefined
      if (!fn) {
        return true
      }
      if (!context) {
        // If no context could be created, skip but do not treat as failure of plugin code
        logger?.warn?.(`Skipping plugin ${plugin.name} ${phase} due to missing context`)
        return false
      }
      await fn(context)
      return true
    }
    catch (error) {
      if (logger) {
        logger.error(`Plugin ${plugin.name} ${phase} failed:`, error)
      }
      else {
        console.error(`Plugin ${plugin.name} ${phase} failed:`, error)
      }
      return false
    }
  }

  constructor(shell: Shell, shellConfig: KrustyConfig) {
    this.shell = shell
    this.config = shellConfig
    this.pluginDir = this.resolvePath(shellConfig.plugins?.[0]?.directory || config.plugins?.[0]?.directory || '~/.krusty/plugins')
    this.ensurePluginDir()
  }

  private createPluginLogger(name: string): Logger {
    // Use shell config verbosity and provide a namespaced logger for plugins
    const verbose = !!this.shell?.config?.verbose
    return new Logger(verbose, `plugin:${name}`)
  }

  private resolvePath(path: string): string {
    return path.replace(/^~(?=$|\/|\\)/, homedir())
  }

  private async loadBuiltinPlugin(name: string, _config?: Record<string, any>): Promise<void> {
    // Create a temporary plugin entry to get context
    const tempPlugin: Plugin = { name, version: '1.0.0' }
    this.plugins.set(name, tempPlugin)

    const context = this.getPluginContext(name)
    if (!context)
      return

    if (name === 'auto-suggest') {
      // Load the sophisticated auto-suggest plugin from file
      try {
        const autoSuggestPlugin = await import('./auto-suggest-plugin')
        const plugin = autoSuggestPlugin.default

        this.plugins.set(name, plugin)
        const okInit = await this.callLifecycle(plugin, 'initialize', context)
        if (okInit)
          await this.callLifecycle(plugin, 'activate', context)
      }
      catch (error) {
        console.error('Failed to load auto-suggest plugin:', error)
        // Fallback: remove the plugin entry
        this.plugins.delete(name)
      }
    }
    else if (name === 'highlight') {
      const plugin: Plugin = {
        name: 'highlight',
        version: '1.0.0',
        description: 'Provides syntax highlighting for commands',
        commands: {
          'highlight:demo': {
            description: 'Demo command that outputs colored text',
            execute: async (_args: string[], _context: any) => ({
              exitCode: 0,
              stdout: `\x1B[32mecho\x1B[0m \x1B[33mhi\x1B[0m\n`,
              stderr: '',
              duration: 0,
            }),
          },
        },
      }

      this.plugins.set(name, plugin)
      const okInit = await this.callLifecycle(plugin, 'initialize', context)
      if (okInit)
        await this.callLifecycle(plugin, 'activate', context)
    }
  }

  // Begin: Lazy loading helpers
  private async loadLazyByName(name: string): Promise<void> {
    const lazy = this.lazyPlugins.get(name)
    if (!lazy)
      return

    const { item } = lazy
    try {
      // Handle built-in default plugins
      if (item.name === 'auto-suggest' || item.name === 'highlight') {
        await this.loadBuiltinPlugin(item.name, item.config)
      }
      else {
        const pluginPath = item.path
          ? this.resolvePath(item.path)
          : join(this.pluginDir, item.name)

        if (!existsSync(pluginPath)) {
          if (item.url) {
            await this.installPluginItem(item)
          }
          else {
            this.shell.log?.warn(`Plugin not found: ${item.name}`)
            return
          }
        }

        const pluginModule = await import(pluginPath)
        const plugin: Plugin = pluginModule.default || pluginModule
        if (this.validatePlugin(plugin)) {
          this.plugins.set(plugin.name, plugin)
          await this.initializePlugin(plugin, item.config || {})
        }
      }
    }
    catch (error) {
      if (this.shell.log)
        this.shell.log.error(`Failed to load lazy plugin ${name}:`, error)
      else
        console.error(`Failed to load lazy plugin ${name}:`, error)
    }
    finally {
      // Remove from lazy registry regardless of success to avoid repeated attempts
      this.lazyPlugins.delete(name)
    }
  }

  // Fire-and-forget background load for specific plugins
  ensureLazyLoaded(names?: string[]): void {
    const targets = names && names.length > 0 ? names : Array.from(this.lazyPlugins.keys())
    for (const n of targets) {
      // Trigger async load without awaiting to avoid blocking callers
      this.loadLazyByName(n).catch(err => this.shell.log?.error?.(`Lazy load error for ${n}:`, err))
    }
  }
  // End: Lazy loading helpers

  private ensurePluginDir(): void {
    if (!existsSync(this.pluginDir)) {
      mkdirSync(this.pluginDir, { recursive: true })
    }
  }

  public async loadPlugins(): Promise<void> {
    let pluginsToLoad = this.config.plugins || []

    // Inject default plugins if no plugins are configured
    if (pluginsToLoad.length === 0) {
      pluginsToLoad = [{
        enabled: true,
        list: [
          { name: 'auto-suggest', enabled: true },
          { name: 'highlight', enabled: true },
        ],
      }]
    }
    else {
      // Check which default plugins are explicitly configured
      const configuredPlugins = new Map<string, { enabled: boolean }>()
      for (const config of pluginsToLoad) {
        if (config.list) {
          for (const item of config.list) {
            configuredPlugins.set(item.name, { enabled: item.enabled !== false })
          }
        }
      }

      const defaultPlugins = [
        { name: 'auto-suggest', enabled: true },
        { name: 'highlight', enabled: true },
      ]

      // Only add defaults that aren't explicitly configured
      const missingDefaults = defaultPlugins.filter(p => !configuredPlugins.has(p.name))
      if (missingDefaults.length > 0) {
        pluginsToLoad.push({
          enabled: true,
          list: missingDefaults,
        })
      }
    }

    for (const pluginConfig of pluginsToLoad) {
      if (pluginConfig.enabled === false)
        continue
      await this.loadPlugin(pluginConfig)
    }
    this.startAutoUpdate()
  }

  public async loadPlugin(pluginConfig: PluginConfig): Promise<void> {
    try {
      const pluginList = pluginConfig.list || []

      for (const pluginItem of pluginList) {
        if (pluginItem.enabled === false)
          continue

        // If marked as lazy, defer actual loading
        if (pluginItem.lazy) {
          this.lazyPlugins.set(pluginItem.name, { item: pluginItem, parent: pluginConfig })
          continue
        }

        // Handle built-in default plugins
        if (pluginItem.name === 'auto-suggest' || pluginItem.name === 'highlight') {
          await this.loadBuiltinPlugin(pluginItem.name, pluginItem.config)
          continue
        }

        const pluginPath = pluginItem.path
          ? this.resolvePath(pluginItem.path)
          : join(this.pluginDir, pluginItem.name)

        if (!existsSync(pluginPath)) {
          if (pluginItem.url) {
            await this.installPluginItem(pluginItem)
          }
          else {
            this.shell.log?.warn(`Plugin not found: ${pluginItem.name}`)
            continue
          }
        }

        const pluginModule = await import(pluginPath)
        const plugin: Plugin = pluginModule.default || pluginModule

        if (this.validatePlugin(plugin)) {
          this.plugins.set(plugin.name, plugin)
          await this.initializePlugin(plugin, pluginItem.config || {})
        }
      }
    }
    catch (error) {
      // Use shell logger if available, fallback to console.error
      if (this.shell.log) {
        this.shell.log.error(`Failed to load plugin:`, error)
      }
      else {
        console.error(`Failed to load plugin:`, error)
      }
    }
  }

  private validatePlugin(plugin: Plugin): boolean {
    return !!(plugin.name && plugin.version && plugin.activate)
  }

  private async initializePlugin(plugin: Plugin, pluginConfig: any): Promise<void> {
    const context: PluginContext = {
      shell: this.shell,
      config: this.config,
      pluginConfig,
      logger: this.createPluginLogger(plugin.name),
      utils: {
        exec: async (command: string, _options?: any) => {
          const result = await this.shell.execute(command)
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          }
        },
        readFile: async (path: string) => {
          const { readFile } = await import('node:fs/promises')
          return readFile(path, 'utf-8')
        },
        writeFile: async (path: string, content: string) => {
          const { writeFile } = await import('node:fs/promises')
          await writeFile(path, content, 'utf-8')
        },
        exists: (path: string) => existsSync(path),
        expandPath: (path: string) => this.resolvePath(path),
        formatTemplate: (template: string, variables: Record<string, string>) => {
          return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '')
        },
      },
    }
    const okInit = await this.callLifecycle(plugin, 'initialize', context)
    if (okInit)
      await this.callLifecycle(plugin, 'activate', context)
  }

  private async installPluginItem(pluginItem: { name: string, url?: string, version?: string }): Promise<void> {
    // Implementation for installing plugins from npm or git
    console.warn(`Installing plugin: ${pluginItem.name}`)
    // TODO: Implement actual installation logic
  }

  public async updatePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin)
      return

    console.warn(`Updating plugin: ${name}`)
    // TODO: Implement update logic
  }

  private startAutoUpdate(): void {
    if (this.updateInterval)
      clearInterval(this.updateInterval)

    const updateInterval = 24 * 60 * 60 * 1000 // 24 hours
    this.updateInterval = setInterval(() => {
      this.checkForUpdates()
    }, updateInterval)
  }

  private async checkForUpdates(): Promise<void> {
    for (const [name] of this.plugins) {
      try {
        await this.updatePlugin(name)
      }
      catch (error) {
        console.error(`Failed to update plugin ${name}:`, error)
      }
    }
  }

  public async shutdown(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }

    for (const [name, plugin] of this.plugins) {
      try {
        const context: PluginContext = {
          shell: this.shell,
          config: this.config,
          logger: this.createPluginLogger(plugin.name),
          utils: {} as any, // Simplified for shutdown
        }
        await this.callLifecycle(plugin, 'deactivate', context)
      }
      catch (error) {
        console.error(`Error deactivating plugin ${name}:`, error)
      }
    }

    this.plugins.clear()
  }

  public getPlugin(name: string): Plugin | undefined {
    // Trigger background lazy load if needed, then return what's available now
    if (this.lazyPlugins.has(name))
      this.ensureLazyLoaded([name])
    return this.plugins.get(name)
  }

  public getAllPlugins(): Map<string, Plugin> {
    return this.plugins
  }

  public getPluginContext(name: string): PluginContext | undefined {
    const plugin = this.plugins.get(name)
    if (!plugin)
      return undefined

    return {
      shell: this.shell,
      config: this.config,
      logger: this.createPluginLogger(plugin.name),
      utils: {
        exec: async (command: string, _options?: any) => {
          const result = await this.shell.execute(command)
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          }
        },
        readFile: async (path: string) => {
          const { readFile } = await import('node:fs/promises')
          return readFile(path, 'utf-8')
        },
        writeFile: async (path: string, content: string) => {
          const { writeFile } = await import('node:fs/promises')
          await writeFile(path, content, 'utf-8')
        },
        exists: (path: string) => existsSync(path),
        expandPath: (path: string) => this.resolvePath(path),
        formatTemplate: (template: string, variables: Record<string, string>) => {
          return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '')
        },
      },
    }
  }

  public getPluginCompletions(input: string, cursor: number): string[] {
    const completions: string[] = []

    // Ensure any lazy plugins are being loaded before gathering completions
    if (this.lazyPlugins.size > 0)
      this.ensureLazyLoaded()

    for (const [name, plugin] of this.plugins) {
      if (plugin.completions) {
        for (const completion of plugin.completions) {
          try {
            const context = this.getPluginContext(name)
            if (context) {
              const pluginCompletions = completion.complete(input, cursor, context)
              completions.push(...pluginCompletions)
            }
          }
          catch (error) {
            // Use shell logger if available, fallback to console.error
            if (this.shell.log) {
              this.shell.log.error(`Error getting completions from plugin ${name}:`, error)
            }
            else {
              console.error(`Error getting completions from plugin ${name}:`, error)
            }
          }
        }
      }
    }

    return completions
  }

  public async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin)
      return

    try {
      const context = this.getPluginContext(name)
      await this.callLifecycle(plugin, 'deactivate', context)
      this.plugins.delete(name)
    }
    catch (error) {
      console.error(`Error unloading plugin ${name}:`, error)
    }
  }
}

// Export class only, instances should be created with shell and config
