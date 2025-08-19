import type { ThemeColors, ThemeConfig, ThemeGitColors, ThemeGitSymbols, ThemeSymbols } from '../types'
import { config } from '../config'

export class ThemeManager {
  private currentTheme: ThemeConfig
  private colorScheme: 'light' | 'dark' | 'auto' = 'auto'
  private systemColorScheme: 'light' | 'dark' = 'light'

  constructor() {
    this.currentTheme = config.theme || {}
    this.detectSystemColorScheme()
    this.applyColorScheme()
  }

  private detectSystemColorScheme(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches
      this.systemColorScheme = darkMode ? 'dark' : 'light'

      // Listen for system color scheme changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        this.systemColorScheme = e.matches ? 'dark' : 'light'
        this.applyColorScheme()
      })
    }
  }

  private applyColorScheme(): void {
    const scheme = this.colorScheme === 'auto'
      ? this.systemColorScheme
      : this.colorScheme

    // Apply color scheme to document
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', scheme)
    }
  }

  public setColorScheme(scheme: 'light' | 'dark' | 'auto'): void {
    this.colorScheme = scheme
    this.applyColorScheme()
  }

  public getColorScheme(): 'light' | 'dark' | 'auto' {
    return this.colorScheme
  }

  public getColors(): ThemeColors {
    return this.currentTheme.colors || {}
  }

  public getSymbols(): ThemeSymbols {
    return this.currentTheme.symbols || {}
  }

  public getGitColors(): ThemeGitColors {
    return this.getColors().git || {}
  }

  public getGitSymbols(): ThemeGitSymbols {
    return this.getSymbols().git || {}
  }

  public formatGitStatus(status: {
    branch?: string
    ahead?: number
    behind?: number
    staged?: number
    unstaged?: number
    untracked?: number
    conflict?: boolean
  }): string {
    const { branch, ahead = 0, behind = 0, staged = 0, unstaged = 0, untracked = 0, conflict = false } = status
    if (!branch)
      return ''

    const parts: string[] = []
    const colors = this.getGitColors()
    const symbols = this.getGitSymbols()

    // Add branch name
    parts.push(`%F{${colors.branch || 'green'}}${symbols.branch || ''} ${branch}%f`)

    // Add ahead/behind indicators
    if (ahead > 0) {
      parts.push(`%F{${colors.ahead || 'green'}}${symbols.ahead || '↑'}${ahead}%f`)
    }
    if (behind > 0) {
      parts.push(`%F{${colors.behind || 'red'}}${symbols.behind || '↓'}${behind}%f`)
    }

    // Add status indicators
    if (conflict) {
      parts.push(`%F{${colors.conflict || 'red'}}${symbols.conflict || '!'}%f`)
    }
    if (staged > 0) {
      parts.push(`%F{${colors.staged || 'green'}}${symbols.staged || '+'}${staged}%f`)
    }
    if (unstaged > 0) {
      parts.push(`%F{${colors.unstaged || 'red'}}${symbols.unstaged || '!'}${unstaged}%f`)
    }
    if (untracked > 0) {
      parts.push(`%F{${colors.untracked || 'red'}}${symbols.untracked || '?'}${untracked}%f`)
    }

    return parts.join(' ')
  }

  public renderPrompt(left: string, right: string = ''): string {
    if (!this.currentTheme.prompt)
      return left

    let result = left

    // Apply right prompt if enabled and content exists
    if (this.currentTheme.enableRightPrompt && right) {
      const padding = Math.max(0, process.stdout.columns - (left.length + right.length) - 1)
      result = `${left}${' '.repeat(padding)}${right}`
    }

    return result
  }
}

export const themeManager = new ThemeManager()
