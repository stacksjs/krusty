import type { BunshConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginManager } from '../src/plugins'
import { BunshShell } from '../src/shell'

describe('Plugin System', () => {
  let shell: BunshShell
  let pluginManager: PluginManager
  let tempDir: string
  let pluginPath: string

  beforeEach(() => {
    const config: BunshConfig = {
      verbose: false,
      plugins: [],
      hooks: {},
    }

    shell = new BunshShell(config)
    pluginManager = new PluginManager(shell, config)

    // Create temporary directory for test plugin
    tempDir = mkdtempSync(join(tmpdir(), 'bunsh-plugin-test-'))
    pluginPath = join(tempDir, 'test-plugin.js')

    // Write test plugin to file
    const pluginCode = `
      class TestPlugin {
        name = 'test-plugin'
        version = '1.0.0'
        description = 'A test plugin'

        commands = {
          hello: {
            description: 'Say hello',
            execute: async (args, context) => {
              const name = args[0] || 'World'
              return {
                exitCode: 0,
                stdout: \`Hello, \${name}!\\n\`,
                stderr: '',
                duration: 0
              }
            }
          }
        }

        async initialize(context) {
          context.logger.info('Test plugin initialized')
        }

        async activate(context) {
          context.logger.info('Test plugin activated')
        }

        async deactivate(context) {
          context.logger.info('Test plugin deactivated')
        }
      }

      module.exports = new TestPlugin()
    `

    writeFileSync(pluginPath, pluginCode)
  })

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should load plugin from path', async () => {
    const config = {
      name: 'test-plugin',
      path: pluginPath,
      enabled: true,
    }

    await pluginManager.loadPlugin(config)

    const plugin = pluginManager.getPlugin('test-plugin')
    expect(plugin).toBeDefined()
    expect(plugin?.name).toBe('test-plugin')
    expect(plugin?.version).toBe('1.0.0')
  })

  it('should register plugin commands', async () => {
    const config = {
      name: 'test-plugin',
      path: pluginPath,
      enabled: true,
    }

    await pluginManager.loadPlugin(config)

    const command = shell.builtins.get('test-plugin:hello')
    expect(command).toBeDefined()
    expect(command?.description).toBe('Say hello')
  })

  it('should execute plugin commands', async () => {
    const config = {
      name: 'test-plugin',
      path: pluginPath,
      enabled: true,
    }

    await pluginManager.loadPlugin(config)

    const result = await shell.execute('test-plugin:hello Bunsh')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Hello, Bunsh!\n')
  })

  it('should unload plugins', async () => {
    const config = {
      name: 'test-plugin',
      path: pluginPath,
      enabled: true,
    }

    await pluginManager.loadPlugin(config)
    expect(pluginManager.getPlugin('test-plugin')).toBeDefined()

    await pluginManager.unloadPlugin('test-plugin')
    expect(pluginManager.getPlugin('test-plugin')).toBeUndefined()

    const command = shell.builtins.get('test-plugin:hello')
    expect(command).toBeUndefined()
  })

  it('should handle plugin loading errors', async () => {
    const config = {
      name: 'invalid-plugin',
      path: '/nonexistent/path/plugin.js',
      enabled: true,
    }

    await expect(pluginManager.loadPlugin(config)).rejects.toThrow()
  })

  it('should skip disabled plugins', async () => {
    const config = {
      name: 'test-plugin',
      path: pluginPath,
      enabled: false,
    }

    const shellConfig: BunshConfig = {
      verbose: false,
      plugins: [config],
      hooks: {},
    }

    const testPluginManager = new PluginManager(shell, shellConfig)
    await testPluginManager.loadPlugins()

    expect(testPluginManager.getPlugin('test-plugin')).toBeUndefined()
  })

  it('should provide plugin utilities', async () => {
    const config = {
      name: 'test-plugin',
      path: pluginPath,
      enabled: true,
    }

    await pluginManager.loadPlugin(config)

    const context = pluginManager.getPluginContext('test-plugin')
    expect(context).toBeDefined()
    expect(context?.utils).toBeDefined()
    expect(typeof context?.utils.exec).toBe('function')
    expect(typeof context?.utils.readFile).toBe('function')
    expect(typeof context?.utils.writeFile).toBe('function')
    expect(typeof context?.utils.exists).toBe('function')
    expect(typeof context?.utils.expandPath).toBe('function')
    expect(typeof context?.utils.formatTemplate).toBe('function')
  })

  it('should provide plugin logger', async () => {
    const config = {
      name: 'test-plugin',
      path: pluginPath,
      enabled: true,
    }

    await pluginManager.loadPlugin(config)

    const context = pluginManager.getPluginContext('test-plugin')
    expect(context).toBeDefined()
    expect(context?.logger).toBeDefined()
    expect(typeof context?.logger.debug).toBe('function')
    expect(typeof context?.logger.info).toBe('function')
    expect(typeof context?.logger.warn).toBe('function')
    expect(typeof context?.logger.error).toBe('function')
  })
})
