export type HookCallback<T = unknown> = (data: T) => Promise<void> | void
type HookHandlers = Record<string, HookCallback[]>

/**
 * HookManager handles registration and execution of hooks in the shell
 */
export class HookManager {
  private hooks: HookHandlers = {}

  /**
   * Register a callback for a specific hook
   * @param hookName - Name of the hook to register
   * @param callback - Function to call when hook is triggered
   * @returns A function to unregister the callback
   */
  public on<T = unknown>(hookName: string, callback: HookCallback<T>): () => void {
    if (!this.hooks[hookName]) {
      this.hooks[hookName] = []
    }

    this.hooks[hookName].push(callback as HookCallback)

    // Return cleanup function
    return () => {
      this.hooks[hookName] = this.hooks[hookName].filter(cb => cb !== callback)
    }
  }

  /**
   * Execute all callbacks for a specific hook
   * @param hookName - Name of the hook to execute
   * @param data - Data to pass to the hook callbacks
   */
  public async executeHooks<T = unknown>(hookName: string, data: T): Promise<void> {
    const hooks = this.hooks[hookName] || []

    // Execute hooks in parallel
    await Promise.all(
      hooks.map(async (hook) => {
        try {
          await hook(data)
        }
        catch (error) {
          console.error(`Error in hook '${hookName}':`, error)
        }
      }),
    )
  }

  /**
   * Clear all hooks or a specific hook
   * @param hookName - Optional name of the hook to clear
   */
  public clearHooks(hookName?: string): void {
    if (hookName) {
      delete this.hooks[hookName]
    }
    else {
      this.hooks = {}
    }
  }
}

// Create and export a singleton instance
const hookManager: HookManager = new HookManager()
export { hookManager }
export default hookManager
