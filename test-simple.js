#!/usr/bin/env node

// Simple test to verify shell functionality without hanging
process.env.NODE_ENV = 'test'
process.env.BUN_ENV = 'test'

console.log('Starting simple shell test...')

try {
  // Test basic shell instantiation
  const { KrustyShell } = require('./src/shell.ts')
  console.log('✓ Shell module loaded successfully')
  
  const shell = new KrustyShell({ verbose: false })
  console.log('✓ Shell instance created successfully')
  
  // Test basic command execution without starting interactive mode
  shell.execute('echo "test"').then(result => {
    console.log('✓ Command execution result:', result.stdout?.trim())
    console.log('✓ All tests passed - shell is working correctly')
    process.exit(0)
  }).catch(error => {
    console.error('✗ Command execution failed:', error.message)
    process.exit(1)
  })
  
} catch (error) {
  console.error('✗ Test failed:', error.message)
  process.exit(1)
}
