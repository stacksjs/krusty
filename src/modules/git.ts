import type { ModuleContext, ModuleResult } from '../types'
import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BaseModule } from './index'

const execAsync = promisify(exec)

// Git branch module
export class GitBranchModule extends BaseModule {
  name = 'git_branch'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!context.gitInfo?.isRepo
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const gitInfo = context.gitInfo
    if (!gitInfo?.isRepo || !gitInfo.branch)
      return null

    const symbol = ''
    const branch = gitInfo.branch
    const content = `${symbol} ${branch}`

    return this.formatResult(content, { color: '#a855f7', bold: true })
  }
}

// Git commit module
export class GitCommitModule extends BaseModule {
  name = 'git_commit'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!context.gitInfo?.isRepo
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    try {
      const { stdout } = await execAsync('git rev-parse --short HEAD', { cwd: context.cwd })
      const hash = stdout.trim()

      if (!hash)
        return null

      const content = `(${hash})`
      return this.formatResult(content, { color: '#10b981' })
    }
    catch {
      return null
    }
  }
}

// Git state module
export class GitStateModule extends BaseModule {
  name = 'git_state'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!context.gitInfo?.isRepo && this.hasGitState(context.cwd)
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const state = this.getGitState(context.cwd)
    if (!state)
      return null

    // Get configuration from context
    const config = context.config?.git_state || {}

    // Use custom symbols and colors from config if available
    const stateMap: Record<string, { symbol: string, color: string, style: string }> = {
      REBASE: {
        symbol: config.rebase || '🔄 REBASING',
        color: '#f59e0b',
        style: 'bold yellow',
      },
      MERGE: {
        symbol: config.merge || '🔀 MERGING',
        color: '#ef4444',
        style: 'bold red',
      },
      CHERRY_PICK: {
        symbol: config.cherry_pick || '🍒 PICKING',
        color: '#ec4899',
        style: 'bold red',
      },
      REVERT: {
        symbol: config.revert || '↩️ REVERTING',
        color: '#8b5cf6',
        style: 'bold purple',
      },
      BISECT: {
        symbol: config.bisect || '🔍 BISECTING',
        color: '#06b6d4',
        style: 'bold blue',
      },
    }

    const stateInfo = stateMap[state] || { symbol: state, color: '#6b7280', style: 'normal' }

    // Try to get progress information if available
    let progressInfo = ''
    try {
      if (state === 'REBASE' || state === 'CHERRY_PICK') {
        const { stdout } = await execAsync('git status --porcelain', { cwd: context.cwd })
        const lines = stdout.trim().split('\n').filter(line => line.length > 0)
        if (lines.length > 0) {
          progressInfo = ` ${lines.length} files`
        }
      }
    }
    catch {
      // Ignore errors getting progress
    }

    const content = `(${stateInfo.symbol}${progressInfo})`
    return this.formatResult(content, { color: stateInfo.color, bold: stateInfo.style.includes('bold') })
  }

  private hasGitState(cwd: string): boolean {
    const gitDir = join(cwd, '.git')
    const states = ['REBASE_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']

    return states.some(state => existsSync(join(gitDir, state)))
  }

  private getGitState(cwd: string): string | null {
    const gitDir = join(cwd, '.git')

    if (existsSync(join(gitDir, 'REBASE_HEAD')))
      return 'REBASE'
    if (existsSync(join(gitDir, 'MERGE_HEAD')))
      return 'MERGE'
    if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD')))
      return 'CHERRY_PICK'
    if (existsSync(join(gitDir, 'REVERT_HEAD')))
      return 'REVERT'
    if (existsSync(join(gitDir, 'BISECT_LOG')))
      return 'BISECT'

    return null
  }
}

// Git status module
export class GitStatusModule extends BaseModule {
  name = 'git_status'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!context.gitInfo?.isRepo
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    const gitInfo = context.gitInfo
    if (!gitInfo?.isRepo)
      return null

    // Get configuration from context
    const config = context.config?.git_status || {}

    // Debug logging of git status configuration
    context.logger.debug('GitStatusModule config:', JSON.stringify(config, null, 2))
    context.logger.debug('GitStatusModule ahead symbol:', config.ahead)

    const parts: string[] = []

    // Ahead/behind
    if (gitInfo.ahead && gitInfo.ahead > 0) {
      const symbol = config.ahead || '⇡'
      parts.push(`${symbol}${gitInfo.ahead}`)
    }
    if (gitInfo.behind && gitInfo.behind > 0) {
      const symbol = config.behind || '⇣'
      parts.push(`${symbol}${gitInfo.behind}`)
    }

    // File status with custom symbols
    if (gitInfo.staged && gitInfo.staged > 0) {
      const symbol = config.staged || '●'
      parts.push(`${symbol}${gitInfo.staged}`)
    }
    if (gitInfo.unstaged && gitInfo.unstaged > 0) {
      const symbol = config.modified || '○'
      parts.push(`${symbol}${gitInfo.unstaged}`)
    }
    if (gitInfo.untracked && gitInfo.untracked > 0) {
      const symbol = config.untracked || '?'
      parts.push(`${symbol}${gitInfo.untracked}`)
    }
    if (gitInfo.stashed && gitInfo.stashed > 0) {
      const symbol = config.stashed || '$'
      parts.push(`${symbol}${gitInfo.stashed}`)
    }

    // Check for conflicted files
    try {
      const { stdout } = await execAsync('git diff --name-only --diff-filter=U', { cwd: context.cwd })
      if (stdout.trim()) {
        const conflictedCount = stdout.trim().split('\n').length
        const symbol = config.conflicted || '🏳'
        parts.push(`${symbol}${conflictedCount}`)
      }
    }
    catch {
      // Ignore errors
    }

    if (parts.length === 0)
      return null

    const content = `[${parts.join(' ')}]`
    const color = gitInfo.isDirty ? '#ef4444' : '#10b981'

    return this.formatResult(content, { color })
  }
}

// Git metrics module (shows +/- lines)
export class GitMetricsModule extends BaseModule {
  name = 'git_metrics'
  enabled = true

  detect(context: ModuleContext): boolean {
    return !!context.gitInfo?.isRepo
  }

  async render(context: ModuleContext): Promise<ModuleResult | null> {
    try {
      const { stdout } = await execAsync('git diff --numstat', { cwd: context.cwd })
      if (!stdout.trim())
        return null

      let added = 0
      let deleted = 0

      const lines = stdout.trim().split('\n')
      for (const line of lines) {
        const [addedStr, deletedStr] = line.split('\t')
        if (addedStr !== '-')
          added += Number.parseInt(addedStr, 10) || 0
        if (deletedStr !== '-')
          deleted += Number.parseInt(deletedStr, 10) || 0
      }

      if (added === 0 && deleted === 0)
        return null

      const parts: string[] = []
      if (added > 0)
        parts.push(`+${added}`)
      if (deleted > 0)
        parts.push(`-${deleted}`)

      const content = `(${parts.join('/')})`
      return this.formatResult(content, { color: '#6b7280' })
    }
    catch {
      return null
    }
  }
}
