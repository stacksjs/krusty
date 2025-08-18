import type { BuiltinCommand as BaseBuiltinCommand, Shell as BaseShell } from '../types'

export * from '../types'

// Job status type
export type JobStatus = 'running' | 'stopped' | 'done'

// Job interface
export interface Job {
  id: number
  command: string
  pid?: number
  status: JobStatus
  fg?: boolean
}

// Extend the base Shell interface with job-related methods
export interface Shell extends Omit<BaseShell, 'addJob' | 'removeJob' | 'getJob' | 'getJobs' | 'setJobStatus'> {
  jobs: Job[]
  addJob: (command: string, pid?: number) => number
  removeJob: (id: number) => void
  getJob: (id: number) => Job | undefined
  getJobs: () => Job[]
  setJobStatus: (id: number, status: JobStatus) => void
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
