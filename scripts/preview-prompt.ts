import process from 'node:process'
import { loadKrustyConfig } from '../src/config'
import { GitInfoProvider, PromptRenderer, SystemInfoProvider } from '../src/prompt'

async function main() {
  const cfg = await loadKrustyConfig()
  const renderer = new PromptRenderer(cfg)
  const sys = new SystemInfoProvider()
  const git = new GitInfoProvider()

  const systemInfo = await sys.getSystemInfo()
  const gitInfo = await git.getGitInfo(process.cwd())
  const prompt = await renderer.render(process.cwd(), systemInfo, gitInfo, 0)
  const right = await renderer.renderRight(process.cwd(), systemInfo, gitInfo, 0)

  const sanitize = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '')
  console.error(`[debug] left.length=${prompt.length} right.length=${right.length}`)
  console.error(`[debug] left(sanitized)='${sanitize(prompt)}'`)
  console.error(`[debug] right(sanitized)='${sanitize(right)}'`)

  // Simulate how shell composes left + padding + right (very simplified)
  const cols = (process.stdout.columns as number | undefined) ?? 80
  const left = prompt
  let combined = left
  if (right && right.length > 0) {
    const spaceCount = Math.max(1, cols - left.length - right.length)
    combined = left + ' '.repeat(spaceCount) + right
  }

  console.error(`[debug] raw prompt: ${combined}`)
  console.error(`[debug] sanitized prompt: ${sanitize(combined)}`)
  console.error(`[debug] prompt length: ${combined.length}`)

  console.log('---START---')
  console.log(combined)
  console.log('---END---')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
