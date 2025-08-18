/* eslint-disable unused-imports/no-unused-vars */
import type {
  BunshConfig,
  Plugin,
  PluginConfig,
  PluginContext,
  PluginLogger,
  PluginUtils,
  Shell,
} from '../types'
import { exec } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Plugin utilities implementation
class PluginUtilsImpl implements PluginUtils {
  async exec(command: string, options: any = {}): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, options)
      return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', exitCode: 0 }
    }
    catch (error: any) {
      return {
        stdout: (error.stdout?.toString?.() ?? error.stdout ?? ''),
        stderr: (error.stderr?.toString?.() ?? error.message ?? ''),
        exitCode: error.code || 1,
      }
    }
  }

  async readFile(path: string): Promise<string> {
    const { readFileSync } = await import('node:fs')
    return readFileSync(this.expandPath(path), 'utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(this.expandPath(path), content, 'utf-8')
  }

  exists(path: string): boolean {
    return existsSync(this.expandPath(path))
  }

  expandPath(path: string): string {
    if (path.startsWith('~')) {
      return path.replace('~', homedir())
    }
    return resolve(path)
  }

  formatTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => variables[key] || match)
  }
}

// Plugin logger implementation
class PluginLoggerImpl implements PluginLogger {
  constructor(private pluginName: string, private shell: Shell, private verbose: boolean = false) {}

  debug(message: string, ...args: any[]): void {
    if (this.verbose) {
      this.shell.log.debug(`[${this.pluginName}] ${message}`, ...args)
    }
  }

  info(message: string, ...args: any[]): void {
    this.shell.log.info(`[${this.pluginName}] ${message}`, ...args)
  }

  warn(message: string, ...args: any[]): void {
    this.shell.log.warn(`[${this.pluginName}] ${message}`, ...args)
  }

  error(message: string, ...args: any[]): void {
    this.shell.log.error(`[${this.pluginName}] ${message}`, ...args)
  }
}

// Plugin manager
export class PluginManager {
  private plugins = new Map<string, Plugin>()
  private pluginContexts = new Map<string, PluginContext>()
  private utils = new PluginUtilsImpl()

  constructor(private shell: Shell, private config: BunshConfig) {}

  // Load plugins from configuration (with default injection)
  async loadPlugins(): Promise<void> {
    const configured = this.config.plugins || []

    // Compute defaults relative to this file
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const defaultCandidates: PluginConfig[] = [
      { name: 'auto-suggest', path: resolve(__dirname, '../plugins/auto-suggest-plugin.ts'), enabled: true },
      { name: 'highlight', path: resolve(__dirname, '../plugins/highlight-plugin.ts'), enabled: true },
    ]

    // Respect explicit disables and existing entries
    const explicitlyDisabled = new Set(
      configured.filter(p => p.name && p.enabled === false).map(p => p.name as string),
    )
    const existing = new Set(configured.filter(p => p.name && p.enabled !== false).map(p => p.name as string))

    const toLoad: PluginConfig[] = []
    // Load configured ones first
    toLoad.push(...configured.filter(p => p.enabled !== false))

    // Add defaults if not present and not disabled
    for (const cand of defaultCandidates) {
      if (!existing.has(cand.name!) && !explicitlyDisabled.has(cand.name!)) {
        toLoad.push(cand)
      }
    }

    for (const pluginConfig of toLoad) {
      if (pluginConfig.enabled === false)
        continue

      try {
        await this.loadPlugin(pluginConfig)
      }
      catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.shell.log.error(`❌ Failed to load plugin ${pluginConfig.name}: ${errorMessage}`)
      }
    }
  }

  // Load a single plugin
  async loadPlugin(config: PluginConfig): Promise<void> {
    let plugin: Plugin

    if (config.path) {
      // Load from local path
      plugin = await this.loadPluginFromPath(config.path)
    }
    else if (config.url) {
      // Load from URL (future implementation)
      throw new Error('URL-based plugins not yet implemented')
    }
    else {
      // Load from plugin registry (future implementation)
      throw new Error('Registry-based plugins not yet implemented')
    }

    // Validate plugin
    if (!plugin.name || !plugin.version) {
      throw new Error('Plugin must have name and version')
    }

    // Check Bunsh version compatibility
    if (plugin.bunshVersion && !this.isVersionCompatible(plugin.bunshVersion)) {
      throw new Error(`Plugin ${plugin.name} requires Bunsh version ${plugin.bunshVersion}`)
    }

    // Create plugin context
    const context: PluginContext = {
      shell: this.shell,
      config: this.config,
      pluginConfig: config.config,
      logger: new PluginLoggerImpl(plugin.name, this.shell, this.config.verbose),
      utils: this.utils,
    }

    // Initialize plugin
    if (plugin.initialize) {
      await plugin.initialize(context)
    }

    // Register plugin
    this.plugins.set(plugin.name, plugin)
    this.pluginContexts.set(plugin.name, context)

    // Register plugin commands
    if (plugin.commands) {
      for (const [commandName, command] of Object.entries(plugin.commands)) {
        this.shell.builtins.set(`${plugin.name}:${commandName}`, {
          name: `${plugin.name}:${commandName}`,
          description: command.description,
          usage: command.usage || `${plugin.name}:${commandName}`,
          execute: async (args: string[]) => {
            return await command.execute(args, context)
          },
        })
      }
    }

    // Register plugin aliases
    if (plugin.aliases) {
      Object.assign(this.shell.aliases, plugin.aliases)
    }

    // Activate plugin
    if (plugin.activate) {
      await plugin.activate(context)
    }

    context.logger.info(`Plugin ${plugin.name} v${plugin.version} loaded successfully`)
  }

  // Load plugin from local path
  private async loadPluginFromPath(path: string): Promise<Plugin> {
    const pluginPath = this.utils.expandPath(path)

    if (!existsSync(pluginPath)) {
      throw new Error(`Plugin path does not exist: ${pluginPath}`)
    }

    // Try to load as ES module first, then CommonJS
    try {
      const module = await import(pluginPath)
      return module.default || module
    }
    catch (error) {
      // Fallback to require for CommonJS
      try {
        delete require.cache[require.resolve(pluginPath)]
        // eslint-disable-next-line ts/no-require-imports
        return require(pluginPath)
      }
      catch {
        throw new Error(`Failed to load plugin from ${pluginPath}: ${error}`)
      }
    }
  }

  // Check version compatibility
  private isVersionCompatible(requiredVersion: string): boolean {
    const currentVersion = '1.0.0' // This should come from package.json

    // Handle semver range syntax (e.g., ">=1.0.0")
    if (requiredVersion.startsWith('>=')) {
      const minVersion = requiredVersion.substring(2)
      return this.compareVersions(currentVersion, minVersion) >= 0
    }

    if (requiredVersion.startsWith('>')) {
      const minVersion = requiredVersion.substring(1)
      return this.compareVersions(currentVersion, minVersion) > 0
    }

    if (requiredVersion.startsWith('<=')) {
      const maxVersion = requiredVersion.substring(2)
      return this.compareVersions(currentVersion, maxVersion) <= 0
    }

    if (requiredVersion.startsWith('<')) {
      const maxVersion = requiredVersion.substring(1)
      return this.compareVersions(currentVersion, maxVersion) < 0
    }

    // Exact version match
    return this.compareVersions(currentVersion, requiredVersion) === 0
  }

  private compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number)
    const v2Parts = version2.split('.').map(Number)

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0
      const v2Part = v2Parts[i] || 0

      if (v1Part > v2Part)
        return 1
      if (v1Part < v2Part)
        return -1
    }

    return 0
  }

  // Get loaded plugin
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)
  }

  // Get all loaded plugins
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
  }

  // Get plugin context
  getPluginContext(name: string): PluginContext | undefined {
    return this.pluginContexts.get(name)
  }

  // Unload plugin
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    const context = this.pluginContexts.get(name)

    if (!plugin || !context) {
      throw new Error(`Plugin ${name} not found`)
    }

    // Deactivate plugin
    if (plugin.deactivate) {
      await plugin.deactivate(context)
    }

    // Remove plugin commands
    if (plugin.commands) {
      for (const commandName of Object.keys(plugin.commands)) {
        this.shell.builtins.delete(`${plugin.name}:${commandName}`)
      }
    }

    // Remove plugin aliases
    if (plugin.aliases) {
      for (const alias of Object.keys(plugin.aliases)) {
        delete this.shell.aliases[alias]
      }
    }

    // Destroy plugin
    if (plugin.destroy) {
      await plugin.destroy(context)
    }

    // Remove from registry
    this.plugins.delete(name)
    this.pluginContexts.delete(name)

    context.logger.info(`Plugin ${name} unloaded`)
  }

  // Reload plugin
  async reloadPlugin(name: string): Promise<void> {
    const pluginConfig = this.config.plugins?.find(p => p.name === name)
    if (!pluginConfig) {
      throw new Error(`Plugin configuration for ${name} not found`)
    }

    await this.unloadPlugin(name)
    await this.loadPlugin(pluginConfig)
  }

  // Get plugin completions
  getPluginCompletions(input: string, cursor: number): string[] {
    const completions: string[] = []

    for (const plugin of this.plugins.values()) {
      if (plugin.completions) {
        const context = this.pluginContexts.get(plugin.name)
        if (context) {
          for (const completion of plugin.completions) {
            if (input.startsWith(completion.command)) {
              completions.push(...completion.complete(input, cursor, context))
            }
          }
        }
      }
    }

    return completions
  }

  // Shutdown all plugins
  async shutdown(): Promise<void> {
    for (const [name] of this.plugins) {
      try {
        await this.unloadPlugin(name)
      }
      catch (error) {
        this.shell.log.error(`Error unloading plugin ${name}:`, error)
      }
    }
  }
}

// Plugin discovery utilities
export class PluginDiscovery {
  static getPluginDirectories(): string[] {
    const pluginDirs = [
      join(process.cwd(), 'node_modules', '@bunsh'),
      join(process.cwd(), '..', '..', 'node_modules', '@bunsh'),
      '/usr/local/share/bunsh/plugins',
      '/opt/bunsh/plugins',
    ]
    return pluginDirs
  }

  static async discoverPlugins(): Promise<PluginConfig[]> {
    const plugins: PluginConfig[] = []
    const directories = this.getPluginDirectories()

    for (const dir of directories) {
      if (existsSync(dir)) {
        try {
          // eslint-disable-next-line ts/no-require-imports
          const entries = require('node:fs').readdirSync(dir)
          for (const entry of entries) {
            const pluginPath = join(dir, entry)
            const packageJsonPath = join(pluginPath, 'package.json')

            if (existsSync(packageJsonPath)) {
              try {
                const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
                if (packageJson.bunshPlugin) {
                  plugins.push({
                    name: packageJson.name,
                    path: pluginPath,
                    version: packageJson.version,
                    enabled: false,
                  })
                }
              }
              catch (_error) {
                // Skip invalid packages
              }
            }
          }
        }
        catch {
          // Skip directories that can't be read
        }
      }
    }

    return plugins
  }
}

// Base plugin class for easier plugin development
export abstract class BasePlugin implements Plugin {
  abstract name: string
  abstract version: string
  abstract description?: string
  author?: string
  dependencies?: string[]
  bunshVersion?: string

  async initialize(_context: PluginContext): Promise<void> {}

  async activate(_context: PluginContext): Promise<void> {}

  async deactivate(_context: PluginContext): Promise<void> {}

  async destroy(_context: PluginContext): Promise<void> {}
}
