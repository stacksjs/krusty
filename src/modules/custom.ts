import type { ModuleContext, ModuleResult } from '../types'
import { BaseModule, ModuleUtils } from './index'

// Custom module for user-defined modules
export class CustomModule extends BaseModule {
  name: string
  enabled: boolean
  config: Record<string, any>

  constructor(name: string, config: Record<string, any>) {
    super()
    this.name = name
    this.enabled = config.enabled !== false
    this.config = config
  }

  detect(context: ModuleContext): boolean {
    const { when, files, extensions, directories } = this.config

    // Check custom condition
    if (typeof when === 'string') {
      try {
        const func = new Function('context', `return ${when}`)
        if (!func(context))
          return false
      }
      catch {
        return false
      }
    }
    else if (when === false) {
      return false
    }

    // Check for specific files
    if (Array.isArray(files) && files.length > 0) {
      if (!ModuleUtils.hasFiles(context, files))
        return false
    }

    // Check for file extensions
    if (Array.isArray(extensions) && extensions.length > 0) {
      if (!ModuleUtils.hasExtensions(context, extensions))
        return false
    }

    // Check for directories
    if (Array.isArray(directories) && directories.length > 0) {
      if (!ModuleUtils.hasDirectories(context, directories))
        return false
    }

    return true
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const { format, symbol, command } = this.config

    // If command is provided, execute it and use output
    if (command) {
      try {
        const output = await ModuleUtils.getCommandOutput(command)
        if (!output)
          return null

        const content = format
          ? ModuleUtils.formatTemplate(format, { symbol: symbol || '', output })
          : output

        return this.formatResult(content, {
          color: this.config.color || '#6b7280',
          bold: this.config.bold,
          italic: this.config.italic,
        })
      }
      catch {
        return null
      }
    }

    // Otherwise use static content
    const content = format
      ? ModuleUtils.formatTemplate(format, { symbol: symbol || '' })
      : symbol || this.name

    return this.formatResult(content, {
      color: this.config.color || '#6b7280',
      bold: this.config.bold,
      italic: this.config.italic,
    })
  }
}

// Environment variable module
export class EnvVarModule extends BaseModule {
  name: string
  enabled: boolean
  config: Record<string, any>

  constructor(name: string, config: Record<string, any>) {
    super()
    this.name = name
    this.enabled = config.enabled !== false
    this.config = config
  }

  detect(context: ModuleContext): boolean {
    const varName = this.config.variable || this.name.replace('env_var.', '')
    return !!context.environment[varName]
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const varName = this.config.variable || this.name.replace('env_var.', '')
    const value = context.environment[varName] || this.config.default

    if (!value)
      return null

    const symbol = this.config.symbol || ''
    const format = this.config.format || '{symbol}{value}'

    const content = ModuleUtils.formatTemplate(format, {
      symbol,
      value,
      name: varName,
    })

    return this.formatResult(content, {
      color: this.config.color || '#6b7280',
      bold: this.config.bold,
      italic: this.config.italic,
    })
  }
}

// Factory function to create custom modules from config
export function createCustomModules(config: Record<string, any>): BaseModule[] {
  const modules: BaseModule[] = []

  // Create custom modules
  if (config.custom) {
    for (const [name, moduleConfig] of Object.entries(config.custom)) {
      modules.push(new CustomModule(`custom.${name}`, moduleConfig as Record<string, any>))
    }
  }

  // Create environment variable modules
  if (config.env_var) {
    for (const [name, moduleConfig] of Object.entries(config.env_var)) {
      modules.push(new EnvVarModule(`env_var.${name}`, moduleConfig as Record<string, any>))
    }
  }

  return modules
}
