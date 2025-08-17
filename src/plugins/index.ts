/* eslint-disable no-console */
import type {
  BunshConfig,
  CommandResult,
  Plugin,
  PluginConfig,
  PluginContext,
  PluginLogger,
  PluginUtils,
  Shell,
} from '../types'
import { exec } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Plugin utilities implementation
class PluginUtilsImpl implements PluginUtils {
  async exec(command: string, options: any = {}): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, options)
      return { stdout, stderr, exitCode: 0 }
    }
    catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      }
    }
  }

  async readFile(path: string): Promise<string> {
    return readFileSync(this.expandPath(path), 'utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
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
  constructor(private pluginName: string, private verbose: boolean = false) {}

  debug(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.debug(`[${this.pluginName}] DEBUG:`, message, ...args)
    }
  }

  info(message: string, ...args: any[]): void {
    console.info(`[${this.pluginName}] INFO:`, message, ...args)
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[${this.pluginName}] WARN:`, message, ...args)
  }

  error(message: string, ...args: any[]): void {
    console.error(`[${this.pluginName}] ERROR:`, message, ...args)
  }
}

// Plugin manager
export class PluginManager {
  private plugins = new Map<string, Plugin>()
  private pluginContexts = new Map<string, PluginContext>()
  private utils = new PluginUtilsImpl()

  constructor(private shell: Shell, private config: BunshConfig) {}

  // Load plugins from configuration
  async loadPlugins(): Promise<void> {
    if (!this.config.plugins)
      return

    for (const pluginConfig of this.config.plugins) {
      if (pluginConfig.enabled === false)
        continue

      try {
        await this.loadPlugin(pluginConfig)
      }
      catch (error) {
        console.error(`Failed to load plugin ${pluginConfig.name}:`, error)
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
      logger: new PluginLoggerImpl(plugin.name, this.config.verbose),
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
    // Simple version check - in production, use semver
    const currentVersion = '1.0.0' // This should come from package.json
    return currentVersion >= requiredVersion
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
        console.error(`Error unloading plugin ${name}:`, error)
      }
    }
  }
}

// Plugin discovery utilities
export class PluginDiscovery {
  static getPluginDirectories(): string[] {
    return [
      join(homedir(), '.bunsh', 'plugins'),
      join(process.cwd(), 'plugins'),
      join(process.cwd(), 'node_modules', '@bunsh'),
      '/usr/local/share/bunsh/plugins',
      '/opt/bunsh/plugins',
    ]
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
              catch (error) {
                // Skip invalid package.json files
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

  async initialize?(context: PluginContext): Promise<void> {
    // Override in subclasses
  }

  async activate?(context: PluginContext): Promise<void> {
    // Override in subclasses
  }

  async deactivate?(context: PluginContext): Promise<void> {
    // Override in subclasses
  }

  async destroy?(context: PluginContext): Promise<void> {
    // Override in subclasses
  }
}
