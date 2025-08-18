import type { KrustyConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { defaultConfig } from '../src/config'
import { KrustyShell } from '../src/shell'

describe('disown builtin', () => {
  let shell: KrustyShell
  let testConfig: KrustyConfig

  beforeEach(() => {
    testConfig = {
      ...defaultConfig,
      verbose: false,
      history: {
        ...defaultConfig.history,
        file: `/tmp/test_history_disown_${Math.random().toString(36).slice(2)}`,
      },
    }
    shell = new KrustyShell(testConfig)
  })

  afterEach(() => {
    shell.stop()
  })

  it('returns success when no jobs exist', async () => {
    const res = await shell.execute('disown')
    expect(res.exitCode).toBe(0)
    expect(res.stderr).toBe('')
  })

  it('disowns the most recent job when no args are given', async () => {
    const j1 = shell.addJob('sleep 1', 12345)
    const j2 = shell.addJob('sleep 2', 23456)
    expect(j1).toBe(1)
    expect(j2).toBe(2)

    const res = await shell.execute('disown')
    expect(res.exitCode).toBe(0)

    // Job 2 should be removed; job 1 should still exist
    const jobs = shell.getJobs()
    const ids = jobs.map(j => j.id)
    expect(ids).toContain(1)
    expect(ids).not.toContain(2)
  })

  it('supports %N format for job IDs', async () => {
    const j1 = shell.addJob('sleep 1', 34567)
    expect(j1).toBe(1)

    const res = await shell.execute('disown %1')
    expect(res.exitCode).toBe(0)
    const jobs = shell.getJobs()
    expect(jobs.find(j => j.id === 1)).toBeUndefined()
  })

  it('reports error for invalid job IDs when jobs exist', async () => {
    shell.addJob('sleep 1', 45678)

    const res = await shell.execute('disown %999')
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('disown: 999: no such job')
    expect(res.stderr.endsWith('\n')).toBe(true)
  })

  it('handles multiple job IDs', async () => {
    shell.addJob('sleep 1', 11111) // id 1
    shell.addJob('sleep 2', 22222) // id 2

    const res = await shell.execute('disown 1 2')
    expect(res.exitCode).toBe(0)

    const jobs = shell.getJobs()
    expect(jobs.find(j => j.id === 1)).toBeUndefined()
    expect(jobs.find(j => j.id === 2)).toBeUndefined()
  })

  it('reports pid-less jobs as errors', async () => {
    const id = shell.addJob('sleep 1', 33333)
    // Force pid-less condition to exercise error path
    ;(shell as any).jobs = (shell as any).jobs.map((j: any) => j.id === id ? { ...j, pid: undefined } : j)

    const res = await shell.execute(`disown ${id}`)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain(`disown: ${id}: job has no pid`)
    expect(res.stderr.endsWith('\n')).toBe(true)

    // Ensure the job remains since it couldn't be removed
    const jobs = shell.getJobs()
    expect(jobs.find(j => j.id === id)).toBeDefined()
  })
})
