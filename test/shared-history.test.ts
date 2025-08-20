/* eslint-disable dot-notation */
import { describe, expect, it, mock } from 'bun:test'
import { sharedHistory } from '../src/history'
import { AutoSuggestInput } from '../src/input/auto-suggest'

// Ensure sharedHistory is used when shell.history is absent

describe('shared history fallback', () => {
  it('expandHistory uses sharedHistory when shell.history is missing', () => {
    // Spy on sharedHistory.getHistory
    const original = (sharedHistory as any).getHistory
    const histMock = mock(() => ['echo one', 'git status', 'build all'])
    ;(sharedHistory as any).getHistory = histMock

    try {
      const shellWithoutHistory = {
        getCompletions: mock(() => []),
        config: { completion: { enabled: true } },
        // no history field
      } as any

      const inp = new AutoSuggestInput(shellWithoutHistory)
      const out = (inp as any)['expandHistory']('!!') as string
      expect(out).toBe('build all')
      expect(histMock).toHaveBeenCalled()
    }
    finally {
      // restore
      ;(sharedHistory as any).getHistory = original
    }
  })
})
