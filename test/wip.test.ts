import type { CommandResult } from '../src/builtins/types'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KrustyShell } from '../src'
import { defaultConfig } from '../src/config'

function createMockShell(tempDir: string) {
  const shell = new KrustyShell({ ...defaultConfig, verbose: false })
  shell.changeDirectory(tempDir)

  // Mock executeCommand to avoid real git operations
  const originalExecuteCommand = shell.executeCommand.bind(shell)
  shell.executeCommand = mock(async (command: string, args: string[]): Promise<CommandResult> => {
    if (command === 'git') {
      // Mock git commands to return appropriate responses
      if (args.includes('rev-parse') && args.includes('--is-inside-work-tree')) {
        return { exitCode: 0, stdout: 'true\n', stderr: '', duration: 0 }
      }
      if (args.includes('add')) {
        return { exitCode: 0, stdout: '', stderr: '', duration: 0 }
      }
      if (args.includes('diff') && args.includes('--cached') && args.includes('--quiet')) {
        // Return non-zero to indicate there are staged changes
        return { exitCode: 1, stdout: '', stderr: '', duration: 0 }
      }
      if (args.includes('diff') && args.includes('--cached') && args.includes('--stat')) {
        return { exitCode: 0, stdout: ' 1 file changed, 1 insertion(+)\n', stderr: '', duration: 0 }
      }
      if (args.includes('commit')) {
        return { exitCode: 0, stdout: '', stderr: '', duration: 0 }
      }
      if (args.includes('log')) {
        return { exitCode: 0, stdout: 'abc1234 wip: test\n', stderr: '', duration: 0 }
      }
      if (args.includes('push')) {
        return { exitCode: 0, stdout: 'Everything up-to-date\n', stderr: '', duration: 0 }
      }
      // Default git command response
      return { exitCode: 0, stdout: '', stderr: '', duration: 0 }
    }
    // For non-git commands, use original implementation
    return originalExecuteCommand(command, args)
  })

  return shell
}

describe('wip builtin', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'krusty-wip-'))
  })

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  it('prints banner and skips commit when no staged changes', async () => {
    const shell = createMockShell(tempDir)
    
    // Mock no staged changes scenario
    shell.executeCommand = mock(async (command: string, args: string[]): Promise<CommandResult> => {
      if (command === 'git') {
        if (args.includes('rev-parse') && args.includes('--is-inside-work-tree')) {
          return { exitCode: 0, stdout: 'true\n', stderr: '', duration: 0 }
        }
        if (args.includes('add')) {
          return { exitCode: 0, stdout: '', stderr: '', duration: 0 }
        }
        if (args.includes('diff') && args.includes('--cached') && args.includes('--quiet')) {
          // Return 0 to indicate no staged changes
          return { exitCode: 0, stdout: '', stderr: '', duration: 0 }
        }
        return { exitCode: 0, stdout: '', stderr: '', duration: 0 }
      }
      return { exitCode: 0, stdout: '', stderr: '', duration: 0 }
    })
    
    const res = await shell.execute('wip --no-push --force-color')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('no changes to commit; skipping push')
    shell.stop()
  })

  it('commits staged changes and does not push with --no-push', async () => {
    const shell = createMockShell(tempDir)
    // create a file (but don't actually use git)
    await writeFile(join(tempDir, 'a.txt'), 'hello')

    const res = await shell.execute('wip --no-push -m "wip: test" --force-color')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('1 file changed')
    expect(res.stdout).toContain('wip: test')
    shell.stop()
  })

  it('supports --amend', async () => {
    const shell = createMockShell(tempDir)
    // create files (but don't actually use git)
    await writeFile(join(tempDir, 'init.txt'), 'init')
    await writeFile(join(tempDir, 'b.txt'), 'b')

    const res = await shell.execute('wip --amend --no-push --force-color')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('1 file changed')
    shell.stop()
  })
})
