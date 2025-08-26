#!/usr/bin/env node

// Simple test to check if shell hangs
console.log('Testing shell execution...')

const { spawn } = require('child_process')

const child = spawn('echo', ['hello world'], {
  stdio: 'inherit'
})

child.on('close', (code) => {
  console.log(`Command completed with code: ${code}`)
  process.exit(0)
})

child.on('error', (err) => {
  console.error('Command failed:', err)
  process.exit(1)
})

// Timeout to prevent hanging
setTimeout(() => {
  console.log('Test timed out - shell is hanging')
  child.kill()
  process.exit(1)
}, 3000)
