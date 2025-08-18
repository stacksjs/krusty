import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultConfig } from '../src/config'
import { krustyShell } from '../src/shell'

describe('Performance Tests', () => {
  let shell: krustyShell
  const testFile = 'test-large-file.txt'
  const testDir = 'test-dir'
  const testFilesCount = 100

  beforeAll(() => {
    // Clean up any existing test files
    if (existsSync(testFile)) {
      rmSync(testFile)
    }
    if (existsSync(testDir)) {
      readdirSync(testDir).forEach((file) => {
        unlinkSync(join(testDir, file))
      })
      rmdirSync(testDir)
    }

    // Create a large file for testing (smaller size for CI environments)
    const largeContent = 'x'.repeat(1024 * 1024) // 1MB file
    writeFileSync(testFile, largeContent)

    // Create a directory with many files
    mkdirSync(testDir, { recursive: true })
    for (let i = 0; i < testFilesCount; i++) {
      writeFileSync(join(testDir, `file-${i}.txt`), `test content ${i}`)
    }

    // Initialize shell with test config
    shell = new krustyShell({
      ...defaultConfig,
      aliases: {
        'perf-alias': 'echo performance test',
        'complex-alias': 'ls -la | grep test | wc -l',
      },
    })
  })

  afterAll(() => {
    // Clean up test files
    if (existsSync(testFile)) {
      rmSync(testFile)
    }
    if (existsSync(testDir)) {
      readdirSync(testDir).forEach((file) => {
        unlinkSync(join(testDir, file))
      })
      rmdirSync(testDir)
    }
    shell.stop()
  })

  test('should handle many commands quickly', async () => {
    const commandCount = 100
    const commands = Array.from({ length: commandCount }, () => 'echo test')

    const start = performance.now()
    const results = await Promise.all(commands.map(cmd => shell.execute(cmd)))
    const duration = performance.now() - start

    expect(results).toHaveLength(commandCount)
    results.forEach((result) => {
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('test')
    })

    globalThis.console.log(`\nExecuted ${commandCount} simple commands in ${duration.toFixed(2)}ms`)
    globalThis.console.log(`Average: ${(duration / commandCount).toFixed(4)}ms per command\n`)
  })

  test('should handle large output efficiently', async () => {
    const start = performance.now()
    const result = await shell.execute(`cat ${testFile}`)
    const duration = performance.now() - start

    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBe(1024 * 1024) // 1MB

    globalThis.console.log(`\nProcessed 1MB of output in ${duration.toFixed(2)}ms\n`)
  })

  test('should handle many files efficiently', async () => {
    const start = performance.now()
    const result = await shell.execute(`ls ${testDir} | wc -l`)
    const duration = performance.now() - start

    expect(result.exitCode).toBe(0)
    expect(Number.parseInt(result.stdout.trim())).toBe(testFilesCount)

    globalThis.console.log(`\nListed ${testFilesCount} files in ${duration.toFixed(2)}ms\n`)
  })

  test('should handle complex pipelines efficiently', async () => {
    const pipelineDepth = 10
    let command = 'echo start'

    for (let i = 0; i < pipelineDepth; i++) {
      command += ` | awk '{print "pipe_${i}_" $0}'`
    }

    const start = performance.now()
    const result = await shell.execute(command)
    const duration = performance.now() - start

    expect(result.exitCode).toBe(0)
    // Verify the output contains the expected pattern with all pipeline stages
    const expectedEnd = `pipe_${pipelineDepth - 1}_${Array.from({ length: pipelineDepth - 1 }).map((_, i) => `pipe_${i}`).reverse().join('_')}_start`
    expect(result.stdout).toContain(expectedEnd)

    globalThis.console.log(`\nExecuted ${pipelineDepth}-stage pipeline in ${duration.toFixed(2)}ms\n`)
  })

  test('should handle many aliases efficiently', async () => {
    // Add many aliases
    const aliasCount = 1000
    for (let i = 0; i < aliasCount; i++) {
      shell.aliases[`alias-${i}`] = `echo alias-${i}-value`
    }

    const start = performance.now()
    const results = await Promise.all(
      Array.from({ length: 100 }).fill(0).map((_, i) =>
        shell.execute(`alias-${i % aliasCount}`),
      ),
    )
    const duration = performance.now() - start

    results.forEach((result, i) => {
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(`alias-${i % aliasCount}-value`)
    })

    globalThis.console.log(`\nExecuted 100 commands with ${aliasCount} aliases in ${duration.toFixed(2)}ms\n`)
    globalThis.console.log(`Average: ${(duration / 100).toFixed(4)}ms per command with aliases\n`)
  })

  test('should handle many environment variables efficiently', async () => {
    // Set many environment variables (reduced for CI environments)
    const varCount = 50
    const envVars = { ...process.env } as Record<string, string>

    for (let i = 0; i < varCount; i++) {
      envVars[`TEST_VAR_${i}`] = `value_${i}`
    }

    // Update shell with new environment
    const newShell = new krustyShell({
      ...defaultConfig,
    })

    // Set environment variables using the execute method
    for (const [key, value] of Object.entries(envVars)) {
      if (value) {
        await newShell.execute(`export ${key}='${value.replace(/'/g, '\'\\\'\'')}'`)
      }
    }

    const start = performance.now()
    const result = await newShell.execute('env | wc -l')
    const duration = performance.now() - start

    expect(result.exitCode).toBe(0)

    // Clean up
    await newShell.stop()

    // Log results without console.log to avoid lint errors
    process.stderr.write(`\nHandled ${varCount} environment variables in ${duration.toFixed(2)}ms\n`)
  })

  test('should handle command with many arguments efficiently', async () => {
    const argCount = 100
    const args = Array.from({ length: argCount }, (_, i) => `arg${i}`).join(' ')

    const start = performance.now()
    const result = await shell.execute(`echo ${args} | wc -w`)
    const duration = performance.now() - start

    expect(Number.parseInt(result.stdout.trim())).toBe(argCount)

    process.stderr.write(`\nProcessed command with ${argCount} arguments in ${duration.toFixed(2)}ms\n`)
  })

  test('should handle many concurrent commands efficiently', async () => {
    const concurrency = 100
    const commands = Array.from({ length: concurrency }).fill(0).map((_, i) => `echo concurrent-${i}`)

    const start = performance.now()
    const results = await Promise.all(commands.map(cmd => shell.execute(cmd)))
    const duration = performance.now() - start

    results.forEach((result, i) => {
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(`concurrent-${i}`)
    })

    process.stderr.write(`\nExecuted ${concurrency} commands concurrently in ${duration.toFixed(2)}ms\n`)
    process.stderr.write(`Average: ${(duration / concurrency).toFixed(4)}ms per concurrent command\n`)
  })
})
