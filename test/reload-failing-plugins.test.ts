import type { KrustyConfig, PluginConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KrustyShell } from '../src'
import { PluginManager } from '../src/plugins/plugin-manager'

/**
 * These tests ensure plugin errors during lifecycle hooks don't crash the shell
 * and are cleanly isolated by PluginManager.
 */
describe('Plugin lifecycle error isolation', () => {
  let shell: KrustyShell
  let pluginManager: PluginManager
  let tempDir: string
  let badInitPath: string
  let badActivatePath: string
  let badDeactivatePath: string

  beforeEach(() => {
    const cfg: KrustyConfig = { verbose: false, plugins: [], hooks: {} }
    shell = new KrustyShell(cfg)
    pluginManager = new PluginManager(shell, cfg)

    tempDir = mkdtempSync(join(tmpdir(), 'krusty-plugin-fail-'))
    badInitPath = join(tempDir, 'bad-init.js')
    badActivatePath = join(tempDir, 'bad-activate.js')
    badDeactivatePath = join(tempDir, 'bad-deactivate.js')

    // Plugin that throws during initialize
    writeFileSync(badInitPath, `
      module.exports = {
        name: 'bad-init',
        version: '1.0.0',
        async initialize() { throw new Error('init failed') },
        async activate() {},
        async deactivate() {}
      }
    `)

    // Plugin that throws during activate
    writeFileSync(badActivatePath, `
      module.exports = {
        name: 'bad-activate',
        version: '1.0.0',
        async activate() { throw new Error('activate failed') },
        async deactivate() {}
      }
    `)

    // Plugin that throws during deactivate
    writeFileSync(badDeactivatePath, `
      module.exports = {
        name: 'bad-deactivate',
        version: '1.0.0',
        async activate() {},
        async deactivate() { throw new Error('deactivate failed') }
      }
    `)
  })

  afterEach(() => {
    if (tempDir)
      rmSync(tempDir, { recursive: true, force: true })
  })

  it('should isolate initialize/activate errors during load', async () => {
    const config: PluginConfig = {
      enabled: true,
      list: [
        { name: 'bad-init', path: badInitPath, enabled: true },
        { name: 'bad-activate', path: badActivatePath, enabled: true },
      ],
    }

    await pluginManager.loadPlugin(config)

    // Manager should not throw and continue operating
    expect(pluginManager.getAllPlugins()).toBeDefined()
    // Plugins are registered, but lifecycle failures are logged and do not crash
    expect(pluginManager.getPlugin('bad-init')).toBeDefined()
    expect(pluginManager.getPlugin('bad-activate')).toBeDefined()
  })

  it('should isolate deactivate errors during unload', async () => {
    const config: PluginConfig = {
      enabled: true,
      list: [{ name: 'bad-deactivate', path: badDeactivatePath, enabled: true }],
    }

    await pluginManager.loadPlugin(config)
    expect(pluginManager.getPlugin('bad-deactivate')).toBeDefined()

    // Unload should not throw even if deactivate fails
    await pluginManager.unloadPlugin('bad-deactivate')
    expect(pluginManager.getPlugin('bad-deactivate')).toBeUndefined()
  })

  it('shutdown should not throw even if plugins fail to deactivate', async () => {
    const config: PluginConfig = {
      enabled: true,
      list: [{ name: 'bad-deactivate', path: badDeactivatePath, enabled: true }],
    }

    await pluginManager.loadPlugin(config)
    await expect(pluginManager.shutdown()).resolves.toBeUndefined()
  })
})
