import type { BuiltinCommand, CommandResult, Shell } from './types'

/**
 * Signal name to number mapping
 * Common signals that can be sent to processes
 */
const SIGNALS: Record<string, number> = {
  'HUP': 1,    // Hangup
  'INT': 2,    // Interrupt (Ctrl+C)
  'QUIT': 3,   // Quit
  'KILL': 9,   // Non-catchable, non-ignorable kill
  'TERM': 15,  // Software termination signal (default)
  'CONT': 18,  // Continue if stopped
  'STOP': 19,  // Stop process
  'TSTP': 20,  // Stop typed at terminal
}

/**
 * Kill command - send a signal to a process or job
 * Can be used to terminate, stop, or continue processes
 */
export const killCommand: BuiltinCommand = {
  name: 'kill',
  description: 'Send a signal to a process or job',
  usage: 'kill [-s SIGNAL | -SIGNAL] pid|job_spec...',
  async execute(args: string[], shell: Shell): Promise<CommandResult> {
    const start = performance.now()
    
    if (args.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n',
        duration: performance.now() - start,
      }
    }

    // Handle -l flag to list signals
    if (args[0] === '-l' || args[0] === '--list') {
      const signals = Object.entries(SIGNALS)
        .map(([name, num]) => `${num}) ${name}`)
        .join('\n')
      
      return {
        exitCode: 0,
        stdout: signals + '\n',
        stderr: '',
        duration: performance.now() - start,
      }
    }

    let signal = 'TERM' // Default signal
    const pids: number[] = []
    let parseSignals = true

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      
      if (parseSignals && arg.startsWith('-')) {
        if (arg === '--') {
          parseSignals = false
          continue
        }
        
        // Handle -s SIGNAL or -SIGNAL format
        if (arg.startsWith('-s') || arg.startsWith('--signal=')) {
          let sig: string
          
          if (arg.startsWith('--signal=')) {
            sig = arg.slice(9)
          } else if (arg === '-s' || arg === '--signal') {
            sig = args[++i]
            if (!sig) {
              return {
                exitCode: 1,
                stdout: '',
                stderr: 'kill: option requires an argument -- s\n',
                duration: performance.now() - start,
              }
            }
          } else {
            sig = arg.slice(1) // Handle -SIGNAL format
          }
          
          // Convert signal name to uppercase and check if it's valid
          const sigUpper = sig.toUpperCase()
          if (SIGNALS[sigUpper] !== undefined || !isNaN(Number(sig))) {
            signal = sigUpper
          } else {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `kill: ${sig}: invalid signal specification\n`,
              duration: performance.now() - start,
            }
          }
          continue
        }
        
        // Handle -SIGNAL format
        if (/^-\d+$/.test(arg)) {
          signal = arg.slice(1)
          continue
        }
        
        // Unknown option
        return {
          exitCode: 1,
          stdout: '',
          stderr: `kill: ${arg}: invalid signal specification\n`,
          duration: performance.now() - start,
        }
      }
      
      // Parse PID or job spec
      const pid = parseInt(arg, 10)
      if (isNaN(pid)) {
        // Handle job spec (e.g., %1)
        if (arg.startsWith('%')) {
          const jobId = parseInt(arg.slice(1), 10)
          if (isNaN(jobId)) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `kill: ${arg}: invalid job specifier\n`,
              duration: performance.now() - start,
            }
          }
          
          const job = shell.getJob(jobId)
          if (!job || !job.pid) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: `kill: ${arg}: no such job\n`,
              duration: performance.now() - start,
            }
          }
          pids.push(job.pid)
        } else {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `kill: ${arg}: arguments must be process or job IDs\n`,
            duration: performance.now() - start,
          }
        }
      } else {
        pids.push(pid)
      }
    }

    if (pids.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n',
        duration: performance.now() - start,
      }
    }

    // In a real implementation, we would send the signal to each process
    // For now, we'll just simulate it and update job status if needed
    const signalNum = SIGNALS[signal] || parseInt(signal, 10) || 15 // Default to TERM
    const results: string[] = []
    let hasError = false

    for (const pid of pids) {
      try {
        // In a real implementation, we would use process.kill(pid, signalNum)
        // For now, we'll just update the job status if this PID matches a job
        const jobs = shell.getJobs()
        const job = jobs.find(j => j.pid === pid)
        
        if (job) {
          if (signalNum === 18) { // CONT
            shell.setJobStatus(job.id, 'running')
            results.push(`[${job.id}] ${job.command} continued`)
          } else if (signalNum === 19 || signalNum === 20) { // STOP/TSTP
            shell.setJobStatus(job.id, 'stopped')
            results.push(`[${job.id}] ${job.command} stopped`)
          } else if (signalNum === 9 || signalNum === 15) { // KILL/TERM
            shell.setJobStatus(job.id, 'done')
            shell.removeJob(job.id)
            results.push(`[${job.id}] ${job.command} terminated`)
          } else {
            results.push(`Sent signal ${signal} to process ${pid}`)
          }
        } else {
          results.push(`Sent signal ${signal} to process ${pid}`)
        }
      } catch (err) {
        hasError = true
        results.push(`kill: (${pid}) - No such process`)
      }
    }

    return {
      exitCode: hasError ? 1 : 0,
      stdout: results.join('\n') + '\n',
      stderr: hasError ? results.filter(r => r.includes('No such process')).join('\n') + '\n' : '',
      duration: performance.now() - start,
    }
  },
}
