import type { BuiltinCommand as BaseBuiltinCommand, Shell as BaseShell } from '../types'

export * from '../types'

// Job status type
export type JobStatus = 'running' | 'stopped' | 'done'

// Extended Shell interface with job management methods
export interface Shell extends BaseShell {
  getJobByPid?: (pid: number) => {
    id: number
    pid: number
    command: string
    status: 'running' | 'stopped' | 'done'
  } | undefined
}

export interface BuiltinCommand extends Omit<BaseBuiltinCommand, 'execute'> {
  execute: (args: string[], shell: Shell) => Promise<{
    exitCode: number
    stdout: string
    stderr: string
    duration: number
  }>
}

export interface BuiltinExecuteArgs {
  args: string[]
  shell: Shell
}

export type BuiltinExecute = (args: string[], shell: Shell) => Promise<{
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}>

// Helper types for command definitions
export interface CommandDefinition {
  name: string
  description: string
  usage: string
  execute: BuiltinExecute
}
