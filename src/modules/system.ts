import type { ModuleContext, ModuleResult } from '../types'
import { existsSync } from 'node:fs'
import { homedir, hostname, platform, userInfo } from 'node:os'
import { join } from 'node:path'
import { BaseModule, ModuleUtils } from './index'

// OS module
export class OsModule extends BaseModule {
  name = 'os'
  enabled = true

  detect(context: ModuleContext): boolean {
    return true // Always available
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const platformName = platform()
    const symbols: Record<string, string> = {
      darwin: '🍎',
      linux: '🐧',
      win32: '🪟',
      freebsd: '😈',
      openbsd: '🐡',
      netbsd: '🚩',
      aix: '➿',
      sunos: '🌞',
      android: '🤖',
    }

    const symbol = symbols[platformName] || '💻'
    const content = `${symbol} ${this.getPrettyName(platformName)}`

    return this.formatResult(content, { color: '#6b7280' })
  }

  private getPrettyName(platform: string): string {
    const names: Record<string, string> = {
      darwin: 'macOS',
      linux: 'Linux',
      win32: 'Windows',
      freebsd: 'FreeBSD',
      openbsd: 'OpenBSD',
      netbsd: 'NetBSD',
      aix: 'AIX',
      sunos: 'Solaris',
      android: 'Android',
    }

    return names[platform] || platform
  }
}

// Hostname module
export class HostnameModule extends BaseModule {
  name = 'hostname'
  enabled = true

  detect(context: ModuleContext): boolean {
    return true // Always available
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const host = hostname()
    const isSSH = !!(context.environment.SSH_CONNECTION || context.environment.SSH_CLIENT)

    // Only show hostname if in SSH session by default
    if (!isSSH)
      return null

    const content = `@${host}`
    return this.formatResult(content, { color: '#10b981', bold: true })
  }
}

// Directory module
export class DirectoryModule extends BaseModule {
  name = 'directory'
  enabled = true

  detect(context: ModuleContext): boolean {
    return true // Always available
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    let path = context.cwd
    const home = homedir()

    // Replace home directory with ~
    if (path.startsWith(home)) {
      path = path.replace(home, '~')
    }

    // Truncate long paths
    const maxLength = 50
    if (path.length > maxLength) {
      const parts = path.split('/')
      if (parts.length > 3) {
        path = `${parts[0]}/…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      }
    }

    const isReadonly = this.isReadonlyDirectory(context.cwd)
    const symbol = isReadonly ? '🔒' : ''

    const content = `${symbol}${path}`
    const color = context.gitInfo?.isRepo ? '#a855f7' : '#3b82f6'

    return this.formatResult(content, { color, bold: true })
  }

  private isReadonlyDirectory(path: string): boolean {
    try {
      // Try to check if directory is writable
      const testFile = join(path, `.write-test-${Date.now()}`)
      // eslint-disable-next-line ts/no-require-imports
      require('node:fs').writeFileSync(testFile, '')
      // eslint-disable-next-line ts/no-require-imports
      require('node:fs').unlinkSync(testFile)
      return false
    }
    catch {
      return true
    }
  }
}

// Username module
export class UsernameModule extends BaseModule {
  name = 'username'
  enabled = true

  detect(context: ModuleContext): boolean {
    return true // Always available
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const user = userInfo().username
    const isSSH = !!(context.environment.SSH_CONNECTION || context.environment.SSH_CLIENT)
    const isRoot = process.getuid?.() === 0

    // Only show username if in SSH session or root by default
    if (!isSSH && !isRoot)
      return null

    const content = user
    const color = isRoot ? '#ef4444' : '#10b981'

    return this.formatResult(content, { color, bold: true })
  }
}

// Shell module
export class ShellModule extends BaseModule {
  name = 'shell'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!context.environment.SHELL
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const shell = context.environment.SHELL
    if (!shell)
      return null

    const shellName = shell.split('/').pop() || shell
    const indicators: Record<string, string> = {
      bash: 'bash',
      zsh: 'zsh',
      fish: 'fish',
      powershell: 'pwsh',
      pwsh: 'pwsh',
      ion: 'ion',
      elvish: 'elvish',
      tcsh: 'tcsh',
      nu: 'nu',
      xonsh: 'xonsh',
      cmd: 'cmd',
    }

    const indicator = indicators[shellName] || shellName
    const content = indicator

    return this.formatResult(content, { color: '#6b7280' })
  }
}

// Battery module
export class BatteryModule extends BaseModule {
  name = 'battery'
  enabled = true

  detect(context: ModuleContext): boolean {
    return this.hasBattery()
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const batteryInfo = await this.getBatteryInfo()
    if (!batteryInfo)
      return null

    const { percentage, isCharging, isLow } = batteryInfo

    let symbol = '🔋'
    if (isCharging)
      symbol = '🔌'
    else if (isLow)
      symbol = '🪫'

    const content = `${symbol} ${percentage}%`
    const color = isLow ? '#ef4444' : isCharging ? '#10b981' : '#6b7280'

    return this.formatResult(content, { color })
  }

  private hasBattery(): boolean {
    // Simple check - this would need platform-specific implementation
    return platform() === 'darwin' || existsSync('/sys/class/power_supply')
  }

  private async getBatteryInfo(): Promise<{ percentage: number, isCharging: boolean, isLow: boolean } | null> {
    try {
      if (platform() === 'darwin') {
        const output = await ModuleUtils.getCommandOutput('pmset -g batt')
        if (!output)
          return null

        const match = output.match(/(\d+)%.*?(charging|discharging|charged)/i)
        if (!match)
          return null

        const percentage = Number.parseInt(match[1], 10)
        const isCharging = match[2]?.toLowerCase() === 'charging'
        const isLow = percentage < 20

        return { percentage, isCharging, isLow }
      }

      // Linux implementation would go here
      return null
    }
    catch {
      return null
    }
  }
}

// Command duration module
export class CmdDurationModule extends BaseModule {
  name = 'cmd_duration'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!(context.environment.CMD_DURATION_MS || context.environment.STARSHIP_DURATION)
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const durationMs = Number.parseInt(context.environment.CMD_DURATION_MS || context.environment.STARSHIP_DURATION || '0', 10)

    if (durationMs < 2000)
      return null // Only show for commands > 2s

    const duration = this.formatDuration(durationMs)
    const content = `took ${duration}`

    return this.formatResult(content, { color: '#f59e0b' })
  }

  private formatDuration(ms: number): string {
    if (ms < 1000)
      return `${ms}ms`
    if (ms < 60000)
      return `${(ms / 1000).toFixed(1)}s`
    if (ms < 3600000)
      return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
  }
}

// Memory usage module
export class MemoryUsageModule extends BaseModule {
  name = 'memory_usage'
  enabled = true

  detect(context: ModuleContext): boolean {
    return true // Always available
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const memInfo = this.getMemoryInfo()
    if (!memInfo)
      return null

    const { used, total, percentage } = memInfo

    // Only show if usage is above threshold (default 75%)
    if (percentage < 75)
      return null

    const content = `🐏 ${this.formatBytes(used)}/${this.formatBytes(total)} (${percentage}%)`
    const color = percentage > 90 ? '#ef4444' : percentage > 80 ? '#f59e0b' : '#10b981'

    return this.formatResult(content, { color })
  }

  private getMemoryInfo(): { used: number, total: number, percentage: number } | null {
    try {
      // eslint-disable-next-line ts/no-require-imports
      const { totalmem, freemem } = require('node:os')
      const total = totalmem()
      const free = freemem()
      const used = total - free
      const percentage = Math.round((used / total) * 100)

      return { used, total, percentage }
    }
    catch {
      return null
    }
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(1)}${units[unitIndex]}`
  }
}

// Time module
export class TimeModule extends BaseModule {
  name = 'time'
  enabled = true

  detect(context: ModuleContext): boolean {
    return true // Always available
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const now = new Date()
    const timeString = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

    const content = `🕐 ${timeString}`
    return this.formatResult(content, { color: '#6b7280' })
  }
}

// Nix shell module
export class NixShellModule extends BaseModule {
  name = 'nix_shell'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!(context.environment.IN_NIX_SHELL || context.environment.NIX_SHELL_PACKAGES)
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const inNixShell = context.environment.IN_NIX_SHELL
    const packages = context.environment.NIX_SHELL_PACKAGES

    if (!inNixShell && !packages)
      return null

    const symbol = '❄️'
    let content = symbol

    if (inNixShell === 'pure') {
      content += ' pure'
    }
    else if (inNixShell === 'impure') {
      content += ' impure'
    }
    else if (packages) {
      content += ' shell'
    }

    return this.formatResult(content, { color: '#5277c3' })
  }
}
