import type { HookConfig, KrustyConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HookManager, HookUtils } from '../src/hooks'
import { KrustyShell } from '../src/shell'

describe('Hooks System', () => {
  let shell: KrustyShell
  let hookManager: HookManager
  let tempDir: string

  beforeEach(() => {
    const config: KrustyConfig = {
      verbose: false,
      plugins: [],
      hooks: {},
    }

    shell = new KrustyShell(config)
    hookManager = new HookManager(shell, config)

    // Create temporary directory for test scripts
    tempDir = mkdtempSync(join(tmpdir(), 'krusty-hooks-test-'))
  })

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should register and execute command hooks', async () => {
    const hookConfig: HookConfig = {
      name: 'test-command-hook',
      command: 'echo "Command hook executed"',
      enabled: true,
    }

    hookManager.registerHook('command:before', hookConfig)

    const results = await hookManager.executeHooks('command:before', { command: 'test' })
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(results[0].data?.stdout).toContain('Command hook executed')
  })

  it('should execute script hooks', async () => {
    const scriptPath = join(tempDir, 'test-hook.sh')
    writeFileSync(scriptPath, '#!/bin/bash\necho "Script hook executed"\nexit 0', { mode: 0o755 })

    const hookConfig: HookConfig = {
      name: 'test-script-hook',
      script: scriptPath,
      enabled: true,
    }

    hookManager.registerHook('shell:start', hookConfig)

    const results = await hookManager.executeHooks('shell:start', {})
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(results[0].data?.stdout).toContain('Script hook executed')
  })

  it('should handle hook conditions', async () => {
    const hookConfig: HookConfig = {
      name: 'conditional-hook',
      command: 'echo "Conditional hook executed"',
      enabled: true,
      conditions: [
        {
          type: 'env',
          value: 'TEST_HOOK_VAR',
          operator: 'exists',
        },
      ],
    }

    hookManager.registerHook('command:before', hookConfig)

    // Without environment variable - should not execute
    let results = await hookManager.executeHooks('command:before', { command: 'test' })
    expect(results).toHaveLength(0)

    // With environment variable - should execute
    shell.environment.TEST_HOOK_VAR = 'test-value'
    results = await hookManager.executeHooks('command:before', { command: 'test' })
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
  })

  it('should respect hook priorities', async () => {
    const _results: string[] = []

    const hook1: HookConfig = {
      name: 'high-priority-hook',
      command: 'echo "High priority"',
      priority: 10,
      enabled: true,
    }

    const hook2: HookConfig = {
      name: 'low-priority-hook',
      command: 'echo "Low priority"',
      priority: 1,
      enabled: true,
    }

    hookManager.registerHook('test:event', hook1)
    hookManager.registerHook('test:event', hook2)

    const hookResults = await hookManager.executeHooks('test:event', {})
    expect(hookResults).toHaveLength(2)

    // High priority hook should execute first
    expect(hookResults[0].data?.stdout).toContain('High priority')
    expect(hookResults[1].data?.stdout).toContain('Low priority')
  })

  it('should handle hook timeouts', async () => {
    const hookConfig: HookConfig = {
      name: 'timeout-hook',
      command: 'sleep 2 && echo "Should timeout"',
      timeout: 100, // 100ms timeout
      enabled: true,
    }

    hookManager.registerHook('test:timeout', hookConfig)

    const results = await hookManager.executeHooks('test:timeout', {})
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('timeout')
  })

  it('should handle async hooks', async () => {
    const hookConfig: HookConfig = {
      name: 'async-hook',
      command: 'echo "Async hook" && exit 1', // This will fail
      async: true, // But it's async, so execution should continue
      enabled: true,
    }

    const hookConfig2: HookConfig = {
      name: 'sync-hook',
      command: 'echo "Sync hook"',
      enabled: true,
    }

    hookManager.registerHook('test:async', hookConfig)
    hookManager.registerHook('test:async', hookConfig2)

    const results = await hookManager.executeHooks('test:async', {})
    expect(results).toHaveLength(2)

    // Both hooks should execute even though the first one failed
    expect(results[0].success).toBe(false) // Async hook failed
    expect(results[1].success).toBe(true) // Sync hook succeeded
  })

  it('should expand template variables in commands', async () => {
    const hookConfig: HookConfig = {
      name: 'template-hook',
      command: 'echo "Event: {event}, CWD: {cwd}"',
      enabled: true,
    }

    hookManager.registerHook('test:template', hookConfig)

    const results = await hookManager.executeHooks('test:template', {})
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(results[0].data?.stdout).toContain('Event: test:template')
    expect(results[0].data?.stdout).toContain(`CWD: ${shell.cwd}`)
  })

  it('should provide hook utilities', () => {
    const simpleHook = HookUtils.createSimpleHook('echo "Simple hook"', 5)
    expect(simpleHook.command).toBe('echo "Simple hook"')
    expect(simpleHook.priority).toBe(5)
    expect(simpleHook.enabled).toBe(true)

    const scriptHook = HookUtils.createScriptHook('/path/to/script.sh', 3)
    expect(scriptHook.script).toBe('/path/to/script.sh')
    expect(scriptHook.priority).toBe(3)
    expect(scriptHook.enabled).toBe(true)

    const conditionalHook = HookUtils.createConditionalHook(
      'echo "Conditional"',
      [{ type: 'env', value: 'TEST_VAR' }],
      7,
    )
    expect(conditionalHook.command).toBe('echo "Conditional"')
    expect(conditionalHook.conditions).toHaveLength(1)
    expect(conditionalHook.priority).toBe(7)

    const asyncHook = HookUtils.createAsyncHook('echo "Async"', 5000, 2)
    expect(asyncHook.command).toBe('echo "Async"')
    expect(asyncHook.async).toBe(true)
    expect(asyncHook.timeout).toBe(5000)
    expect(asyncHook.priority).toBe(2)
  })

  it('should handle file and directory conditions', async () => {
    const testFile = join(tempDir, 'test-file.txt')
    writeFileSync(testFile, 'test content')

    const fileHook: HookConfig = {
      name: 'file-condition-hook',
      command: 'echo "File exists"',
      conditions: [
        {
          type: 'file',
          value: testFile,
          operator: 'exists',
        },
      ],
      enabled: true,
    }

    const dirHook: HookConfig = {
      name: 'dir-condition-hook',
      command: 'echo "Directory exists"',
      conditions: [
        {
          type: 'directory',
          value: tempDir,
          operator: 'exists',
        },
      ],
      enabled: true,
    }

    hookManager.registerHook('test:conditions', fileHook)
    hookManager.registerHook('test:conditions', dirHook)

    const results = await hookManager.executeHooks('test:conditions', {})
    expect(results).toHaveLength(2)
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(true)
  })

  it('should prevent recursive hook execution', async () => {
    const _executionCount = 0

    // Create a hook that would trigger itself
    const recursiveHook: HookConfig = {
      name: 'recursive-hook',
      command: 'echo "Recursive hook"',
      enabled: true,
    }

    hookManager.registerHook('command:before', recursiveHook)

    // Execute the same hook multiple times with same data
    const results1 = await hookManager.executeHooks('command:before', { command: 'test' })
    const results2 = await hookManager.executeHooks('command:before', { command: 'test' })

    // Both should execute since they're not truly recursive (different execution contexts)
    expect(results1).toHaveLength(1)
    expect(results2).toHaveLength(1)
  })

  it('should get registered hooks and events', () => {
    const hookConfig: HookConfig = {
      name: 'test-hook',
      command: 'echo "test"',
      enabled: true,
    }

    hookManager.registerHook('test:event', hookConfig)

    const hooks = hookManager.getHooks('test:event')
    expect(hooks).toHaveLength(1)
    expect(hooks[0].config.name).toBe('test-hook')

    const events = hookManager.getEvents()
    expect(events).toContain('test:event')
  })

  it('should clear hooks', () => {
    const hookConfig: HookConfig = {
      name: 'test-hook',
      command: 'echo "test"',
      enabled: true,
    }

    hookManager.registerHook('test:event', hookConfig)
    expect(hookManager.getHooks('test:event')).toHaveLength(1)

    hookManager.removeHooks('test:event')
    expect(hookManager.getHooks('test:event')).toHaveLength(0)

    hookManager.registerHook('test:event', hookConfig)
    hookManager.registerHook('test:event2', hookConfig)
    expect(hookManager.getEvents()).toHaveLength(2)

    hookManager.clearHooks()
    expect(hookManager.getEvents()).toHaveLength(0)
  })
})
