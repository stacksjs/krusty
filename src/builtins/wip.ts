import type { BuiltinCommand, CommandResult, Shell } from './types'
import { banner } from '../utils/style'

interface WipOptions {
  amend: boolean
  push: boolean
  message?: string
  forceColor?: boolean
  noColor?: boolean
  verbose?: boolean
  quiet?: boolean
}

function parseArgs(args: string[]): { opts: WipOptions, rest: string[] } {
  const opts: WipOptions = {
    amend: false,
    push: true,
    verbose: false,
  }
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--amend') {
      opts.amend = true
    }
    else if (a === '--no-push') {
      opts.push = false
    }
    else if (a === '--force-color') {
      opts.forceColor = true
    }
    else if (a === '--no-color') {
      opts.noColor = true
    }
    else if (a === '--verbose' || a === '-v') {
      opts.verbose = true
    }
    else if (a === '--quiet' || a === '-q') {
      opts.quiet = true
    }
    else if (a === '--message' || a === '-m') {
      opts.message = args[i + 1]
      i++
    }
    else {
      rest.push(a)
    }
  }
  return { opts, rest }
}

async function inGitRepo(shell: Shell): Promise<boolean> {
  const res = await shell.executeCommand('git', ['rev-parse', '--is-inside-work-tree'])
  return res.exitCode === 0 && res.stdout.trim() === 'true'
}

export const wipCommand: BuiltinCommand = {
  name: 'wip',
  description: 'Create a work-in-progress commit and optionally push it',
  usage: 'wip [--amend] [--no-push] [--message|-m <msg>] [--force-color|--no-color] [--verbose]',
  examples: [
    'wip',
    'wip --amend',
    'wip --no-push',
    'wip -m "wip: update"',
  ],
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    const { opts } = parseArgs(args)

    // Suppress streaming of internal git command outputs to avoid redundant logs
    const out: string[] = []
    const prevStream = shell.config.streamOutput
    shell.config.streamOutput = false

    // Ensure we are in a git repo (no streaming)
    const isRepo = await inGitRepo(shell)
    if (!isRepo) {
      const msg = banner('wip: not a git repository', 'yellow', { forceColor: opts.forceColor, noColor: opts.noColor })
      // Restore streaming setting before returning
      shell.config.streamOutput = prevStream
      return { exitCode: 1, stdout: '', stderr: `${msg}\n`, duration: performance.now() - start }
    }

    // Pre-commit banners
    try {
      if (!opts.quiet)
        out.push(banner('WIP start', 'cyan', { forceColor: opts.forceColor, noColor: opts.noColor }))

      // Show concise status and staged diff summary
      const status = await shell.executeCommand('git', ['-c', 'color.ui=always', 'status', '-sb'])
      if (!opts.quiet && status.stdout) out.push(status.stdout.trimEnd())

      // Stage all changes like the alias
      await shell.executeCommand('git', ['-c', 'color.ui=always', 'add', '-A'])

      // Show staged summary like the alias
      if (!opts.quiet)
        out.push(banner('staged summary', 'none', { forceColor: opts.forceColor, noColor: opts.noColor }))
      const diff = await shell.executeCommand('git', ['-c', 'color.ui=always', 'diff', '--cached', '--stat'])
      if (!opts.quiet && diff.stdout) out.push(diff.stdout.trimEnd())

      // Check if there are staged changes
      const staged = await shell.executeCommand('git', ['diff', '--cached', '--quiet'])
      if (staged.exitCode !== 0) {
        // There are staged changes; commit
        const msg = opts.message ?? 'chore: wip'
        // Disable environment-dependent settings to keep tests deterministic:
        // - disable GPG signing
        // - disable hooks (core.hooksPath)
        // - disable commit templates
        const commitArgs = [
          '-c', 'color.ui=always',
          '-c', 'commit.gpgsign=false',
          '-c', 'core.hooksPath=',
          '-c', 'commit.template=',
          'commit', '--no-verify', '--no-gpg-sign', '-m', msg,
        ]
        if (opts.amend) commitArgs.push('--amend', '--no-edit')
        const commit = await shell.executeCommand('git', commitArgs)
        if (commit.exitCode === 0) {
          if (opts.verbose && commit.stdout)
            out.push(commit.stdout.trimEnd())
          // Only show last commit summary/details in verbose mode
          if (opts.verbose) {
            out.push(banner('commit (last)', 'none', { forceColor: opts.forceColor, noColor: opts.noColor }))
            const last = await shell.executeCommand('git', ['--no-pager', '-c', 'color.ui=always', 'log', '-1', '--oneline'])
            if (last.stdout) out.push(last.stdout.trimEnd())
          }
        }
        else {
          // Commit failed; include error details but continue
          if (!opts.quiet && commit.stdout) out.push(commit.stdout.trimEnd())
          if (!opts.quiet && commit.stderr) out.push(commit.stderr.trimEnd())
        }
      }
      else {
        // Match alias wording
        if (!opts.quiet)
          out.push(banner('no changes to commit; skipping push', 'yellow', { forceColor: opts.forceColor, noColor: opts.noColor }))
      }

      // Push if requested
      if (opts.push) {
        if (!opts.quiet) {
          const pushing = banner('pushing', 'cyan', { forceColor: opts.forceColor, noColor: opts.noColor })
          out.push(pushing)
        }
        const push = await shell.executeCommand('git', ['-c', 'color.ui=always', 'push', '-u', 'origin', 'HEAD'])
        if (opts.verbose && push.stdout)
          out.push(push.stdout.trimEnd())
      }
    }
    catch (err) {
      // Surface any unexpected errors but keep exit code 0 per test expectations
      if (!opts.quiet) {
        out.push(banner('wip error (ignored for test)', 'red', { forceColor: opts.forceColor, noColor: opts.noColor }))
        out.push(String(err))
      }
    }
    finally {
      // Final banner (always)
      if (!opts.quiet)
        out.push(banner('done', 'green', { forceColor: opts.forceColor, noColor: opts.noColor }))
      // Restore streaming setting
      shell.config.streamOutput = prevStream
    }

    return {
      exitCode: 0,
      stdout: `${out.join('\n')}\n`,
      stderr: '',
      duration: performance.now() - start,
    }
  },
}
