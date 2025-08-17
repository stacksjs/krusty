import type { ModuleContext, ModuleResult } from '../types'
import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BaseModule, ModuleUtils } from './index'

const execAsync = promisify(exec)

// Environment variable module
export class EnvVarModule extends BaseModule {
  name = 'env_var'
  enabled = true

  constructor(
    private varName: string,
    private config: {
      enabled?: boolean
      format?: string
      symbol?: string
      variable?: string
      default?: string
    } = {},
  ) {
    super()
  }

  detect(context: ModuleContext): boolean {
    if (!this.isEnabled(this.config))
      return false

    const variable = this.config.variable || this.varName
    return !!(context.environment[variable] || this.config.default)
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const variable = this.config.variable || this.varName
    const value = context.environment[variable] || this.config.default

    if (!value)
      return null

    const symbol = this.config.symbol || ''
    const format = this.config.format || '{symbol}{value}'

    const content = ModuleUtils.formatTemplate(format, {
      symbol,
      value,
      variable,
    })

    return this.formatResult(content, { color: '#6b7280' })
  }
}

// Custom command module
export class CustomModule extends BaseModule {
  name = 'custom'
  enabled = true

  constructor(
    private moduleName: string,
    private config: {
      enabled?: boolean
      format?: string
      symbol?: string
      command?: string
      when?: string | boolean
      shell?: string[]
      description?: string
      files?: string[]
      extensions?: string[]
      directories?: string[]
    } = {},
  ) {
    super()
    this.name = `custom_${moduleName}`
  }

  detect(context: ModuleContext): boolean {
    if (!this.isEnabled(this.config))
      return false

    // Check file/extension/directory conditions
    if (this.config.files && !ModuleUtils.hasFiles(context, this.config.files)) {
      return false
    }

    if (this.config.extensions && !ModuleUtils.hasExtensions(context, this.config.extensions)) {
      return false
    }

    if (this.config.directories && !ModuleUtils.hasDirectories(context, this.config.directories)) {
      return false
    }

    // Check when condition
    if (this.config.when !== undefined) {
      if (typeof this.config.when === 'boolean') {
        return this.config.when
      }

      if (typeof this.config.when === 'string') {
        return this.evaluateWhenCondition(this.config.when, context)
      }
    }

    return true
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    if (!this.config.command)
      return null

    try {
      const output = await this.executeCommand(this.config.command, context)
      if (!output || output.trim() === '')
        return null

      const symbol = this.config.symbol || ''
      const format = this.config.format || '{symbol}{output}'

      const content = ModuleUtils.formatTemplate(format, {
        symbol,
        output: output.trim(),
      })

      return this.formatResult(content, { color: '#6b7280' })
    }
    catch {
      return null
    }
  }

  private async executeCommand(command: string, context: ModuleContext): Promise<string | null> {
    try {
      const shell = this.config.shell || ['/bin/sh', '-c']
      const fullCommand = shell.length > 1
        ? `${shell[0]} ${shell.slice(1).join(' ')} "${command}"`
        : `${shell[0]} "${command}"`

      const { stdout } = await execAsync(fullCommand, {
        cwd: context.cwd,
        env: { ...process.env, ...context.environment },
        timeout: 10000, // 10 second timeout
      })

      return stdout
    }
    catch {
      return null
    }
  }

  private evaluateWhenCondition(condition: string, context: ModuleContext): boolean {
    try {
      // Simple condition evaluation - in a real implementation, you'd want a proper expression parser
      // For now, just check if it's a command that exits successfully
      return this.executeCommand(condition, context).then(output => output !== null).catch(() => false)
    }
    catch {
      return false
    }
  }
}

// Factory functions for creating modules
export function createEnvVarModule(name: string, config: any): EnvVarModule {
  return new EnvVarModule(name, config)
}

export function createCustomModule(name: string, config: any): CustomModule {
  return new CustomModule(name, config)
}
