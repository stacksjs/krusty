import type { BuiltinCommand } from '../types'
import { aliasCommand } from './alias'
import { bgCommand } from './bg'
import { builtinCommand } from './builtin'
import { cdCommand } from './cd'
import { clearCommand } from './clear'
import { commandCommand } from './command'
import { dirsCommand } from './dirs'
import { disownCommand } from './disown'
import { echoCommand } from './echo'
import { evalCommand } from './eval'
import { execCommand } from './exec'
import { exitCommand } from './exit'
import { exportCommand } from './export'
import { falseCommand } from './false'
import { fgCommand } from './fg'
import { getoptsCommand } from './getopts'
import { hashCommand } from './hash'
import { helpCommand } from './help'
import { historyCommand } from './history'
import { jobsCommand } from './jobs'
import { killCommand } from './kill'
import { popdCommand } from './popd'
import { printfCommand } from './printf'
import { pushdCommand } from './pushd'
import { pwdCommand } from './pwd'
import { readCommand } from './read'
import { reloadCommand } from './reload'
import { setCommand } from './set'
import { shrugCommand } from './shrug'
import { sourceCommand } from './source'
import { testCommand } from './test'
import { timeCommand } from './time'
import { timesCommand } from './times'
import { trapCommand } from './trap'
import { typeCommand } from './type'
import { umaskCommand } from './umask'
import { unaliasCommand } from './unalias'
import { unsetCommand } from './unset'
import { waitCommand } from './wait'
import { whichCommand } from './which'
import { wipCommand } from './wip'

export function createBuiltins(): Map<string, BuiltinCommand> {
  const builtins = new Map<string, BuiltinCommand>()

  // Add all builtin commands in alphabetical order
  builtins.set('alias', aliasCommand)
  builtins.set('bg', bgCommand)
  builtins.set('builtin', builtinCommand)
  builtins.set('c', clearCommand)
  builtins.set('cd', cdCommand)
  builtins.set('command', commandCommand)
  builtins.set('dirs', dirsCommand)
  builtins.set('disown', disownCommand)
  builtins.set('echo', echoCommand)
  builtins.set('eval', evalCommand)
  builtins.set('exec', execCommand)
  builtins.set('exit', exitCommand)
  builtins.set('export', exportCommand)
  builtins.set('false', falseCommand)
  builtins.set('fg', fgCommand)
  builtins.set('getopts', getoptsCommand)
  builtins.set('hash', hashCommand)
  builtins.set('help', helpCommand)
  builtins.set('history', historyCommand)
  builtins.set('jobs', jobsCommand)
  builtins.set('kill', killCommand)
  builtins.set('popd', popdCommand)
  builtins.set('printf', printfCommand)
  builtins.set('pushd', pushdCommand)
  builtins.set('pwd', pwdCommand)
  builtins.set('read', readCommand)
  builtins.set('reload', reloadCommand)
  builtins.set('set', setCommand)
  builtins.set('shrug', shrugCommand)
  builtins.set('source', sourceCommand)
  builtins.set('.', { ...sourceCommand, name: '.' }) // POSIX alias for source
  builtins.set('test', testCommand)
  builtins.set('[', { ...testCommand, name: '[' }) // POSIX alias for test
  builtins.set('time', timeCommand)
  builtins.set('times', timesCommand)
  builtins.set('trap', trapCommand)
  builtins.set('type', typeCommand)
  builtins.set('umask', umaskCommand)
  builtins.set('unalias', unaliasCommand)
  builtins.set('unset', unsetCommand)
  builtins.set('wait', waitCommand)
  builtins.set('which', whichCommand)
  builtins.set('wip', wipCommand)

  return builtins
}
