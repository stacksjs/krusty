import type { BunshConfig, GitInfo, SystemInfo } from '../src/types'
import { beforeEach, describe, expect, it } from 'bun:test'
import { defaultConfig } from '../src/config'
import { PromptRenderer } from '../src/prompt'

describe('PromptRenderer', () => {
  let renderer: PromptRenderer
  let testConfig: BunshConfig
  let mockSystemInfo: SystemInfo
  let mockGitInfo: GitInfo

  beforeEach(() => {
    testConfig = { ...defaultConfig }
    mockSystemInfo = {
      user: 'testuser',
      hostname: 'testhost',
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: '20.0.0',
      bunVersion: '1.0.0',
    }
    mockGitInfo = {
      branch: 'main',
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      stashed: 0,
      isRepo: true,
      isDirty: false,
    }
    renderer = new PromptRenderer(testConfig)
  })

  describe('basic prompt rendering', () => {
    it('should render simple prompt', async () => {
      testConfig.prompt!.format = '{user}@{host} {symbol} '
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      // Remove ANSI color codes for testing
      // eslint-disable-next-line no-control-regex
      const cleanPrompt = prompt.replace(/\x1B\[[0-9;]*m/g, '')
      expect(cleanPrompt).toContain('testuser@testhost')
      expect(cleanPrompt).toContain('❯')
    })

    it('should render path in prompt', async () => {
      testConfig.prompt!.format = '{path} {symbol} '
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('/home/user')
    })

    it('should abbreviate home directory', async () => {
      testConfig.prompt!.format = '{path} {symbol} '
      const homePath = process.env.HOME || '/home/testuser'
      const prompt = await renderer.render(homePath, mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('~')
    })

    it('should show git branch when in repo', async () => {
      testConfig.prompt!.format = '{path}{git} {symbol} '
      testConfig.prompt!.showGit = true
      const prompt = await renderer.render('/repo', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('main')
    })

    it('should not show git info when not in repo', async () => {
      testConfig.prompt!.format = '{path}{git} {symbol} '
      testConfig.prompt!.showGit = true
      mockGitInfo.isRepo = false
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).not.toContain('main')
    })
  })

  describe('git status indicators', () => {
    beforeEach(() => {
      testConfig.prompt!.format = '{git} {symbol} '
      testConfig.prompt!.showGit = true
    })

    it('should show ahead indicator', async () => {
      mockGitInfo.ahead = 2
      const prompt = await renderer.render('/repo', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('⇡2')
    })

    it('should show behind indicator', async () => {
      mockGitInfo.behind = 3
      const prompt = await renderer.render('/repo', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('⇣3')
    })

    it('should show staged files indicator', async () => {
      mockGitInfo.staged = 1
      mockGitInfo.isDirty = true
      const prompt = await renderer.render('/repo', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('●1')
    })

    it('should show unstaged files indicator', async () => {
      mockGitInfo.unstaged = 2
      mockGitInfo.isDirty = true
      const prompt = await renderer.render('/repo', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('○2')
    })

    it('should show untracked files indicator', async () => {
      mockGitInfo.untracked = 3
      mockGitInfo.isDirty = true
      const prompt = await renderer.render('/repo', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('?3')
    })
  })

  describe('exit code handling', () => {
    it('should show exit code when non-zero', async () => {
      testConfig.prompt!.format = '{exitcode}{symbol} '
      testConfig.prompt!.showExitCode = true
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 1)
      expect(prompt).toContain('1')
    })

    it('should not show exit code when zero', async () => {
      testConfig.prompt!.format = '{exitcode}{symbol} '
      testConfig.prompt!.showExitCode = true
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      // eslint-disable-next-line no-control-regex
      const cleanPrompt = prompt.replace(/\x1B\[[0-9;]*m/g, '')
      expect(cleanPrompt).not.toContain('0')
    })

    it('should change prompt color based on exit code', async () => {
      testConfig.prompt!.format = '{symbol} '
      const successPrompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      const errorPrompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 1)

      // Should contain different color codes
      expect(successPrompt).not.toBe(errorPrompt)
    })
  })

  describe('time display', () => {
    it('should show time when enabled', async () => {
      testConfig.prompt!.format = '{time} {symbol} '
      testConfig.prompt!.showTime = true
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toMatch(/\d{2}:\d{2}:\d{2}/)
    })

    it('should not show time when disabled', async () => {
      testConfig.prompt!.format = '{time} {symbol} '
      testConfig.prompt!.showTime = false
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).not.toMatch(/\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('custom symbols', () => {
    it('should use custom prompt symbol', async () => {
      testConfig.theme!.symbols!.prompt = '>'
      testConfig.prompt!.format = '{symbol} '
      const prompt = await renderer.render('/home/user', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('>')
    })

    it('should use custom git symbols', async () => {
      testConfig.theme!.symbols!.git!.branch = '🌿'
      testConfig.prompt!.format = '{git} {symbol} '
      testConfig.prompt!.showGit = true
      const prompt = await renderer.render('/repo', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toContain('🌿')
    })
  })

  describe('right prompt', () => {
    it('should render right prompt when configured', async () => {
      testConfig.prompt!.rightPrompt = '{time}'
      testConfig.prompt!.showTime = true
      const prompt = await renderer.renderRight('/home/user', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toMatch(/\d{2}:\d{2}:\d{2}/)
    })

    it('should return empty string when no right prompt configured', async () => {
      testConfig.prompt!.rightPrompt = undefined
      const prompt = await renderer.renderRight('/home/user', mockSystemInfo, mockGitInfo, 0)
      expect(prompt).toBe('')
    })
  })

  describe('color formatting', () => {
    it('should apply colors to segments', () => {
      const segment = renderer.colorize('test', testConfig.theme!.colors!.primary!)
      expect(segment).toContain('\x1B[')
      expect(segment).toContain('test')
      expect(segment).toContain('\x1B[0m')
    })

    it('should handle bold formatting', () => {
      const segment = renderer.formatSegment({
        content: 'test',
        style: { bold: true },
      })
      expect(segment).toContain('\x1B[1m')
    })

    it('should handle multiple style properties', () => {
      const segment = renderer.formatSegment({
        content: 'test',
        style: {
          bold: true,
          italic: true,
          color: '#FF0000',
        },
      })
      expect(segment).toContain('1') // Bold
      expect(segment).toContain('3') // Italic
    })
  })
})
