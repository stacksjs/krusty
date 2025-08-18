import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

async function initGitRepo(cwd: string) {
  const shell = new KrustyShell({ ...defaultConfig, verbose: false })
  shell.changeDirectory(cwd)
  await shell.execute('git init')
  await shell.execute('git config user.email "test@example.com"')
  await shell.execute('git config user.name "Test User"')
  return shell
}

describe('wip builtin', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'krusty-wip-'))
  })

  afterEach(async () => {
    try { await rm(tempDir, { recursive: true, force: true }) }
    catch {}
  })

  it('prints banner and skips commit when no staged changes', async () => {
    const shell = await initGitRepo(tempDir)
    const res = await shell.execute('wip --no-push --force-color')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('─── WIP start ───')
    expect(res.stdout).toContain('no changes to commit; skipping push')
    expect(res.stdout).toContain('─── done ───')
    shell.stop()
  })

  it('commits staged changes and does not push with --no-push', async () => {
    const shell = await initGitRepo(tempDir)
    // create and stage a file
    await writeFile(join(tempDir, 'a.txt'), 'hello')
    shell.changeDirectory(tempDir)
    await shell.execute('git add a.txt')

    const res = await shell.execute('wip --no-push -m "wip: test" --force-color')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('─── WIP start ───')
    expect(res.stdout).toContain('─── done ───')
    shell.stop()
  })

  it('supports --amend', async () => {
    const shell = await initGitRepo(tempDir)
    // initial commit
    await writeFile(join(tempDir, 'init.txt'), 'init')
    shell.changeDirectory(tempDir)
    await shell.execute('git add init.txt')
    await shell.execute('git commit -m "init"')

    // new staged changes
    await writeFile(join(tempDir, 'b.txt'), 'b')
    await shell.execute('git add b.txt')

    const res = await shell.execute('wip --amend --no-push --force-color')
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('─── done ───')
    shell.stop()
  })
})
