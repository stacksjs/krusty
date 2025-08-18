import type { BuiltinCommand } from '../types'
import { aliasCommand } from './alias'
import { bgCommand } from './bg'
import { cdCommand } from './cd'
import { echoCommand } from './echo'
import { exitCommand } from './exit'
import { exportCommand } from './export'
import { fgCommand } from './fg'
import { hashCommand } from './hash'
import { helpCommand } from './help'
import { historyCommand } from './history'
import { jobsCommand } from './jobs'
import { killCommand } from './kill'
import { pwdCommand } from './pwd'
import { readCommand } from './read'
import { setCommand } from './set'
import { sourceCommand } from './source'
import { testCommand } from './test'
import { timeCommand } from './time'
import { trapCommand } from './trap'
import { typeCommand } from './type'
import { umaskCommand } from './umask'
import { unaliasCommand } from './unalias'
import { unsetCommand } from './unset'
import { whichCommand } from './which'

export function createBuiltins(): Map<string, BuiltinCommand> {
  const builtins = new Map<string, BuiltinCommand>()

  // Add all builtin commands in alphabetical order
  builtins.set('alias', aliasCommand)
  builtins.set('bg', bgCommand)
  builtins.set('cd', cdCommand)
  builtins.set('echo', echoCommand)
  builtins.set('exit', exitCommand)
  builtins.set('export', exportCommand)
  builtins.set('fg', fgCommand)
  builtins.set('hash', hashCommand)
  builtins.set('help', helpCommand)
  builtins.set('history', historyCommand)
  builtins.set('jobs', jobsCommand)
  builtins.set('kill', killCommand)
  builtins.set('pwd', pwdCommand)
  builtins.set('read', readCommand)
  builtins.set('set', setCommand)
  builtins.set('source', sourceCommand)
  builtins.set('.', { ...sourceCommand, name: '.' }) // POSIX alias for source
  builtins.set('test', testCommand)
  builtins.set('[', { ...testCommand, name: '[' }) // POSIX alias for test
  builtins.set('time', timeCommand)
  builtins.set('trap', trapCommand)
  builtins.set('type', typeCommand)
  builtins.set('umask', umaskCommand)
  builtins.set('unalias', unaliasCommand)
  builtins.set('unset', unsetCommand)
  builtins.set('which', whichCommand)

  return builtins
}
