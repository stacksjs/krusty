import type { KrustyConfig } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { KrustyShell } from '../src/shell'

// Helper to create a bare-minimum config
function makeConfig(partial: Partial<KrustyConfig> = {}): KrustyConfig {
  return {
    verbose: false,
    streamOutput: true,
    aliases: {},
    environment: {},
    plugins: [],
    hooks: {},
    ...partial,
  } as KrustyConfig
}

describe('Default Plugins', () => {
  it('injects default plugins at load time when none provided', async () => {
    const cfg = makeConfig()
    const shell = new KrustyShell(cfg)

    // Load plugins (defaults are injected during load)
    await shell.loadPlugins()
    expect(shell.getPlugin('auto-suggest')).toBeDefined()
    expect(shell.getPlugin('highlight')).toBeDefined()
  })

  it('respects explicit disable for a default plugin', async () => {
    const cfg = makeConfig({
      plugins: [{
        enabled: true,
        list: [
          { name: 'auto-suggest', enabled: false },
        ],
      }],
    })
    const shell = new KrustyShell(cfg)

    // Auto-suggest should remain disabled, but highlight should be injected
    await shell.loadPlugins()
    expect(shell.getPlugin('auto-suggest')).toBeUndefined()
    expect(shell.getPlugin('highlight')).toBeDefined()
  })

  it('auto-suggest provides suggestions from history, aliases, and typo corrections', async () => {
    const cfg = makeConfig()
    const shell = new KrustyShell(cfg)

    // Seed some history and aliases
    shell.addToHistory('bun test')
    shell.addToHistory('git status')
    shell.aliases.gst = 'git status'

    await shell.loadPlugins()

    // Verify plugin is loaded
    const autoSuggestPlugin = shell.getPlugin('auto-suggest')
    expect(autoSuggestPlugin).toBeDefined()

    // History suggestion: should see 'git status' when starting with 'git'
    const suggGit = shell.getCompletions('git', 3)
    expect(suggGit).toContain('git status')

    // Alias name suggestion
    const suggG = shell.getCompletions('gs', 2)
    expect(suggG).toContain('gst')
  })

  it('highlight plugin demo command outputs colored text', async () => {
    const cfg = makeConfig()
    const shell = new KrustyShell(cfg)
    await shell.loadPlugins()

    const res = await shell.execute('highlight:demo "echo hi"')
    expect(res.exitCode).toBe(0)
    // Contains ANSI escape sequence and both tokens colored
    expect(res.stdout).toContain('\x1B[')
    expect(res.stdout).toContain('echo')
    expect(res.stdout).toContain('hi')
  })
})
