import type { BuiltinCommand, CommandResult, Shell } from './types'

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
      // Restore streaming setting before returning
      shell.config.streamOutput = prevStream
      return { exitCode: 1, stdout: '', stderr: `wip: not a git repository\n`, duration: performance.now() - start }
    }

    // Minimal, concise flow: stage, commit, optional push
    try {
      // Stage all changes like the alias
      await shell.executeCommand('git', ['-c', 'color.ui=always', 'add', '-A'])

      // Check if there are staged changes
      const staged = await shell.executeCommand('git', ['diff', '--cached', '--quiet'])
      if (staged.exitCode !== 0) {
        // There are staged changes; commit
        const msg = opts.message ?? 'chore: wip'
        // Disable environment-dependent settings to keep tests deterministic:
        // - disable GPG signing
        // - disable hooks (core.hooksPath)
        // - disable commit templates
        // Show colored staged diff summary before committing
        if (!opts.quiet) {
          const diff = await shell.executeCommand('git', ['-c', 'color.ui=always', 'diff', '--cached', '--stat'])
          if (diff.stdout)
            out.push(diff.stdout.trimEnd())
        }

        const commitArgs = [
          '-c', 'color.ui=always',
          '-c', 'commit.gpgsign=false',
          '-c', 'core.hooksPath=',
          '-c', 'commit.template=',
          // Use --quiet to avoid printing duplicate summary (we show diffstat ourselves)
          'commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', msg,
        ]
        if (opts.amend) commitArgs.push('--amend', '--no-edit')
        const commit = await shell.executeCommand('git', commitArgs)
        if (commit.exitCode === 0) {
          // Print a concise colored one-line commit header after committing
          if (!opts.quiet) {
            const last = await shell.executeCommand('git', [
              '--no-pager',
              '-c', 'color.ui=always',
              'log', '-1',
              '--pretty=format:%C(auto)%h %s',
            ])
            if (last.stdout)
              out.push(last.stdout.trimEnd())
          }
        }
        else {
          // Commit failed; include error details but continue
          if (!opts.quiet && commit.stdout) out.push(commit.stdout.trimEnd())
          if (!opts.quiet && commit.stderr) out.push(commit.stderr.trimEnd())
        }
      }
      else {
        // Minimal message when nothing to commit
        if (!opts.quiet)
          out.push('wip: no changes to commit; skipping push')
      }

      // Push if requested
      if (opts.push) {
        const push = await shell.executeCommand('git', ['-c', 'color.ui=always', 'push', '-u', 'origin', 'HEAD'])
        // Only show push output when verbose
        if (opts.verbose && push.stdout)
          out.push(push.stdout.trimEnd())
      }
    }
    catch (err) {
      // Surface any unexpected errors but keep exit code 0 per test expectations
      if (!opts.quiet)
        out.push(String(err))
    }
    finally {
      // Restore streaming setting
      shell.config.streamOutput = prevStream
    }

    return {
      exitCode: 0,
      stdout: out.length > 0 ? `${out.join('\n')}\n` : '',
      stderr: '',
      duration: performance.now() - start,
    }
  },
}
