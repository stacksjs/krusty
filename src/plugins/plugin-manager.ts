import type { Plugin, PluginConfig, PluginContext } from '../types'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { config } from '../config'
import { themeManager } from '../theme/theme-manager'

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private pluginDir: string
  private updateInterval: NodeJS.Timeout | null = null

  constructor() {
    this.pluginDir = this.resolvePath(config.plugins?.[0]?.directory || '~/.krusty/plugins')
    this.ensurePluginDir()
  }

  private resolvePath(path: string): string {
    return path.replace(/^~(?=$|\/|\\)/, homedir())
  }

  private ensurePluginDir(): void {
    if (!existsSync(this.pluginDir)) {
      mkdirSync(this.pluginDir, { recursive: true })
    }
  }

  public async loadPlugins(): Promise<void> {
    if (!config.plugins?.length)
      return

    for (const pluginConfig of config.plugins) {
      if (!pluginConfig.enabled)
        continue

      try {
        const pluginPath = pluginConfig.path
          ? this.resolvePath(pluginConfig.path)
          : join(this.pluginDir, pluginConfig.name)

        if (!existsSync(pluginPath)) {
          if (pluginConfig.url) {
            await this.installPlugin(pluginConfig)
          }
          else {
            console.warn(`Plugin not found: ${pluginConfig.name}`)
            continue
          }
        }

        const pluginModule = await import(pluginPath)
        const plugin: Plugin = pluginModule.default || pluginModule

        if (this.validatePlugin(plugin)) {
          this.plugins.set(plugin.name, plugin)
          await this.initializePlugin(plugin, pluginConfig.config || {})
        }
      }
      catch (error) {
        console.error(`Failed to load plugin ${pluginConfig.name}:`, error)
      }
    }

    this.startAutoUpdate()
  }

  private validatePlugin(plugin: Plugin): boolean {
    return !!(plugin.name && plugin.version && plugin.activate)
  }

  private async initializePlugin(plugin: Plugin, pluginConfig: any): Promise<void> {
    const context: PluginContext = {
      config: pluginConfig,
      theme: themeManager,
      logger: {
        debug: console.debug.bind(console, `[${plugin.name}]`),
        info: console.info.bind(console, `[${plugin.name}]`),
        warn: console.warn.bind(console, `[${plugin.name}]`),
        error: console.error.bind(console, `[${plugin.name}]`),
      },
    }

    if (plugin.initialize) {
      await plugin.initialize(context)
    }

    await plugin.activate(context)
  }

  public async installPlugin(pluginConfig: PluginConfig): Promise<void> {
    // Implementation for installing plugins from npm or git
    console.log(`Installing plugin: ${pluginConfig.name}`)
    // TODO: Implement actual installation logic
  }

  public async updatePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin)
      return

    console.log(`Updating plugin: ${name}`)
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

  public async unloadPlugins(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }

    for (const [name, plugin] of this.plugins) {
      try {
        if (plugin.deactivate) {
          await plugin.deactivate({} as any) // Simplified context for deactivation
        }
      }
      catch (error) {
        console.error(`Error deactivating plugin ${name}:`, error)
      }
    }

    this.plugins.clear()
  }
}

export const pluginManager: PluginManager = new PluginManager()
