import type { BunshConfig, GitInfo, PromptSegment, SystemInfo } from './types'
import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { arch, homedir, hostname, platform, userInfo } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export class PromptRenderer {
  constructor(private config: BunshConfig) {}

  async render(cwd: string, systemInfo: SystemInfo, gitInfo: GitInfo, exitCode: number): Promise<string> {
    const format = this.config.prompt?.format || '{user}@{host} {path}{git} {symbol} '
    return this.renderFormat(format, cwd, systemInfo, gitInfo, exitCode)
  }

  async renderRight(cwd: string, systemInfo: SystemInfo, gitInfo: GitInfo, exitCode: number): Promise<string> {
    const format = this.config.prompt?.rightPrompt
    if (!format)
      return ''
    return this.renderFormat(format, cwd, systemInfo, gitInfo, exitCode)
  }

  private async renderFormat(format: string, cwd: string, systemInfo: SystemInfo, gitInfo: GitInfo, exitCode: number): Promise<string> {
    let result = format

    // Replace placeholders
    result = result.replace(/\{user\}/g, this.renderUser(systemInfo))
    result = result.replace(/\{host\}/g, this.renderHost(systemInfo))
    result = result.replace(/\{path\}/g, this.renderPath(cwd))

    // Render git asynchronously since it now uses modules
    const gitContent = await this.renderGit(gitInfo, cwd)
    result = result.replace(/\{git\}/g, gitContent)

    const modulesContent = this.renderModules(systemInfo, gitInfo)
    result = result.replace(/\{modules\}/g, modulesContent)

    result = result.replace(/\{symbol\}/g, this.renderSymbol(exitCode))
    result = result.replace(/\{exitcode\}/g, this.renderExitCode(exitCode))
    result = result.replace(/\{time\}/g, this.renderTime())

    return result
  }

  private renderUser(systemInfo: SystemInfo): string {
    if (!this.config.prompt?.showUser)
      return ''
    return this.colorize(systemInfo.user, this.config.theme?.colors?.info || '#74B9FF')
  }

  private renderHost(systemInfo: SystemInfo): string {
    if (!this.config.prompt?.showHost)
      return ''
    return this.colorize(systemInfo.hostname, this.config.theme?.colors?.secondary || '#FF6B9D')
  }

  private renderPath(cwd: string): string {
    if (!this.config.prompt?.showPath)
      return ''

    let displayPath = cwd
    const home = homedir()

    if (displayPath.startsWith(home)) {
      displayPath = displayPath.replace(home, '~')
    }

    // Truncate long paths
    const maxLength = 50
    if (displayPath.length > maxLength) {
      const parts = displayPath.split('/')
      if (parts.length > 3) {
        displayPath = `${parts[0]}/.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      }
    }

    return this.colorize(displayPath, this.config.theme?.colors?.primary || '#00D9FF')
  }

  private async renderGit(gitInfo: GitInfo, _cwd: string): Promise<string> {
    if (!this.config.prompt?.showGit || !gitInfo.isRepo)
      return ''

    const segments: string[] = []

    // Add branch name with custom symbol if available
    const branchSymbol = this.config.theme?.symbols?.git?.branch || '⎇'
    if (gitInfo.branch) {
      segments.push(this.colorize(`${branchSymbol} ${gitInfo.branch}`, '#a855f7'))
    }

    // Add status indicators in a compact format
    const statusParts: string[] = []

    // Staged changes in green
    if (gitInfo.staged && gitInfo.staged > 0) {
      statusParts.push(this.colorize(`●${gitInfo.staged}`, '#00FF88'))
    }

    // Unstaged changes in yellow
    if (gitInfo.unstaged && gitInfo.unstaged > 0) {
      statusParts.push(this.colorize(`○${gitInfo.unstaged}`, '#FFD700'))
    }

    // Untracked files in red
    if (gitInfo.untracked && gitInfo.untracked > 0) {
      statusParts.push(this.colorize(`?${gitInfo.untracked}`, '#FF4757'))
    }

    // Add status indicators if any
    if (statusParts.length > 0) {
      segments.push(`[${statusParts.join('')}]`)
    }

    // Add ahead/behind information if available
    if (gitInfo.ahead || gitInfo.behind) {
      const aheadBehind = []
      if (gitInfo.ahead)
        aheadBehind.push(this.colorize(`⇡${gitInfo.ahead}`, '#00FF88'))
      if (gitInfo.behind)
        aheadBehind.push(this.colorize(`⇣${gitInfo.behind}`, '#FFD700'))
      if (aheadBehind.length > 0) {
        segments.push(`(${aheadBehind.join(' ')})`)
      }
    }

    return segments.length > 0 ? ` ${segments.join(' ')}` : ''
  }

  private renderSymbol(exitCode: number): string {
    const symbol = this.config.theme?.symbols?.prompt || '❯'
    // Use different colors based on exit code
    const color = exitCode === 0
      ? this.config.theme?.colors?.primary || '#00D9FF' // Success: turquoise
      : this.config.theme?.colors?.error || '#FF4757' // Error: red

    return this.colorize(symbol, color)
  }

  private renderExitCode(exitCode: number): string {
    if (!this.config.prompt?.showExitCode || exitCode === 0)
      return ''
    return this.colorize(`${exitCode}`, this.config.theme?.colors?.error || '#FF4757')
  }

  private renderTime(): string {
    if (!this.config.prompt?.showTime)
      return ''
    const now = new Date()
    const timeString = now.toLocaleTimeString('en-US', { hour12: false })
    return this.colorize(timeString, this.config.theme?.colors?.info || '#74B9FF')
  }

  private renderModules(systemInfo: SystemInfo, _gitInfo: GitInfo): string {
    const modules = []

    // Add bun version if available
    if (systemInfo.bunVersion && systemInfo.bunVersion !== 'unknown') {
      modules.push(this.colorize(`🧅 ${systemInfo.bunVersion}`, this.config.theme?.colors?.primary || '#00D9FF'))
    }

    // Detect project type - prioritize Bun over Node.js
    if (this.hasFile('package.json')) {
      const packageJson = this.readPackageJson()

      // Check if it's a Bun project
      if (this.isBunProject(packageJson)) {
        // Don't show bun module again if we already showed the version above
        if (!systemInfo.bunVersion || systemInfo.bunVersion === 'unknown') {
          modules.push(this.colorize('🧅 bun', this.config.theme?.colors?.primary || '#00D9FF'))
        }
      }
      else {
        // It's a Node.js project
        modules.push(this.colorize('⬢ node', this.config.theme?.colors?.success || '#00FF88'))
      }
    }

    // Detect Python projects
    if (this.hasFile('requirements.txt') || this.hasFile('pyproject.toml') || this.hasFile('setup.py')) {
      modules.push(this.colorize('🐍 python', this.config.theme?.colors?.warning || '#FFD700'))
    }

    // Detect Go projects
    if (this.hasFile('go.mod') || this.hasFile('go.sum')) {
      modules.push(this.colorize('🐹 go', this.config.theme?.colors?.info || '#74B9FF'))
    }

    // Detect Rust projects
    if (this.hasFile('Cargo.toml')) {
      modules.push(this.colorize('🦀 rust', this.config.theme?.colors?.error || '#FF4757'))
    }

    // Detect Docker projects
    if (this.hasFile('Dockerfile') || this.hasFile('docker-compose.yml')) {
      modules.push(this.colorize('🐳 docker', this.config.theme?.colors?.info || '#74B9FF'))
    }

    return modules.length > 0 ? modules.join(' ') : ''
  }

  private hasFile(filename: string): boolean {
    try {
      return existsSync(join(process.cwd(), filename))
    }
    catch {
      return false
    }
  }

  private readPackageJson(): any {
    try {
      const packageJsonPath = join(process.cwd(), 'package.json')
      if (existsSync(packageJsonPath)) {
        // eslint-disable-next-line ts/no-require-imports
        const { readFileSync } = require('node:fs')
        return JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      }
    }
    catch {
      // Ignore errors
    }
    return null
  }

  private isBunProject(packageJson: any): boolean {
    if (!packageJson)
      return false

    // Check for Bun-specific indicators
    return !!(
      packageJson.type === 'module'
      || packageJson.scripts?.bun
      || packageJson.dependencies?.bun
      || packageJson.devDependencies?.bun
      || packageJson.peerDependencies?.bun
      || this.hasFile('bun.lockb')
      || this.hasFile('bunfig.toml')
    )
  }

  colorize(text: string, color: string): string {
    if (!color)
      return text

    // Convert hex color to ANSI
    const ansiColor = this.hexToAnsi(color)
    return `\x1B[${ansiColor}m${text}\x1B[0m`
  }

  formatSegment(segment: PromptSegment): string {
    let result = segment.content

    if (segment.style) {
      const codes: string[] = []

      if (segment.style.bold)
        codes.push('1')
      if (segment.style.italic)
        codes.push('3')
      if (segment.style.underline)
        codes.push('4')

      if (segment.style.color) {
        const colorCode = this.hexToAnsi(segment.style.color)
        codes.push(colorCode)
      }

      if (segment.style.background) {
        const bgCode = this.hexToAnsi(segment.style.background, true)
        codes.push(bgCode)
      }

      if (codes.length > 0) {
        result = `\x1B[${codes.join(';')}m${result}\x1B[0m`
      }
    }

    return result
  }

  private hexToAnsi(hex: string, background = false): string {
    // Remove # if present
    hex = hex.replace('#', '')

    // Convert to RGB
    const r = Number.parseInt(hex.substr(0, 2), 16)
    const g = Number.parseInt(hex.substr(2, 2), 16)
    const b = Number.parseInt(hex.substr(4, 2), 16)

    // Use 24-bit color (truecolor)
    const prefix = background ? '48;2' : '38;2'
    return `${prefix};${r};${g};${b}`
  }
}

export class SystemInfoProvider {
  private cachedInfo: SystemInfo | null = null

  async getSystemInfo(): Promise<SystemInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo
    }

    const user = userInfo().username
    const host = hostname()
    const platformName = platform()
    const architecture = arch()

    const nodeVersion = process.version
    let bunVersion = 'unknown'

    try {
      const { stdout } = await execAsync('bun --version')
      bunVersion = stdout.trim()
    }
    catch {
      // Fallback if bun command fails
    }

    this.cachedInfo = {
      user,
      hostname: host,
      platform: platformName,
      arch: architecture,
      nodeVersion,
      bunVersion,
    }

    return this.cachedInfo
  }
}

export class GitInfoProvider {
  private cache = new Map<string, { info: GitInfo, timestamp: number }>()
  private readonly cacheTimeout = 5000 // 5 seconds

  async getGitInfo(cwd: string): Promise<GitInfo> {
    const cached = this.cache.get(cwd)
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.info
    }

    const info = await this.fetchGitInfo(cwd)
    this.cache.set(cwd, { info, timestamp: Date.now() })
    return info
  }

  private async fetchGitInfo(cwd: string): Promise<GitInfo> {
    const defaultInfo: GitInfo = {
      isRepo: false,
      isDirty: false,
    }

    // Check if we're in a git repository
    if (!this.isGitRepo(cwd)) {
      return defaultInfo
    }

    try {
      const [branch, status, ahead, behind] = await Promise.all([
        this.getBranch(cwd),
        this.getStatus(cwd),
        this.getAheadCount(cwd),
        this.getBehindCount(cwd),
      ])

      return {
        isRepo: true,
        branch,
        ahead,
        behind,
        staged: status.staged,
        unstaged: status.unstaged,
        untracked: status.untracked,
        stashed: await this.getStashCount(cwd),
        isDirty: status.staged > 0 || status.unstaged > 0 || status.untracked > 0,
      }
    }
    catch {
      return { ...defaultInfo, isRepo: true }
    }
  }

  private isGitRepo(cwd: string): boolean {
    let currentDir = cwd
    while (currentDir !== '/') {
      if (existsSync(join(currentDir, '.git'))) {
        return true
      }
      const parent = join(currentDir, '..')
      if (parent === currentDir)
        break
      currentDir = parent
    }
    return false
  }

  private async getBranch(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd })
      return stdout.trim()
    }
    catch {
      return undefined
    }
  }

  private async getStatus(cwd: string): Promise<{ staged: number, unstaged: number, untracked: number }> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd })
      const lines = stdout.trim().split('\n').filter(line => line.length > 0)

      let staged = 0
      let unstaged = 0
      let untracked = 0

      for (const line of lines) {
        const status = line.substr(0, 2)
        if (status[0] !== ' ' && status[0] !== '?')
          staged++
        if (status[1] !== ' ')
          unstaged++
        if (status === '??')
          untracked++
      }

      return { staged, unstaged, untracked }
    }
    catch {
      return { staged: 0, unstaged: 0, untracked: 0 }
    }
  }

  private async getAheadCount(cwd: string): Promise<number> {
    try {
      const { stdout } = await execAsync('git rev-list --count @{u}..HEAD', { cwd })
      return Number.parseInt(stdout.trim(), 10) || 0
    }
    catch {
      return 0
    }
  }

  private async getBehindCount(cwd: string): Promise<number> {
    try {
      const { stdout } = await execAsync('git rev-list --count HEAD..@{u}', { cwd })
      return Number.parseInt(stdout.trim(), 10) || 0
    }
    catch {
      return 0
    }
  }

  private async getStashCount(cwd: string): Promise<number> {
    try {
      const { stdout } = await execAsync('git stash list', { cwd })
      return stdout.trim().split('\n').filter(line => line.length > 0).length
    }
    catch {
      return 0
    }
  }
}
