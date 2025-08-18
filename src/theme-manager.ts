import type { Theme } from './theme'
import { getTheme, getThemeNames, getThemes, initThemes, isBrowser } from './theme'
import { onColorSchemeChange, resolveAutoTheme } from './utils/theme-utils'

/**
 * Manages themes for the krusty shell
 */
export class ThemeManager {
  private currentTheme: Theme
  private availableThemes: Map<string, Theme>
  private themeChangeListeners: Array<(theme: Theme) => void> = []
  private colorSchemeCleanup: (() => void) | null = null
  private currentThemeName: string

  constructor() {
    // Initialize with default theme
    this.currentThemeName = isBrowser ? 'auto' : 'terminal'
    this.currentTheme = initThemes(this.currentThemeName)
    this.availableThemes = new Map([
      ...getThemes().map(theme => [theme.name, theme] as const),
      // Add auto theme options
      [
        'auto',
        {
          name: 'auto',
          description: 'Automatically switch between light and dark themes based on system preference',
          colors: getTheme('dark')!.colors, // Default colors for UI
        },
      ],
      [
        'auto-dark',
        {
          name: 'auto-dark',
          description: 'Dark theme that switches to light in light mode',
          colors: getTheme('dark')!.colors,
        },
      ],
      [
        'auto-light',
        {
          name: 'auto-light',
          description: 'Light theme that switches to dark in dark mode',
          colors: getTheme('light')!.colors,
        },
      ],
    ])
  }

  /**
   * Gets the current theme
   */
  public getCurrentTheme(): Theme {
    return this.currentTheme
  }

  /**
   * Gets the name of the current theme
   */
  public getCurrentThemeName(): string {
    return this.currentThemeName
  }

  /**
   * Gets all available themes
   */
  public getAvailableThemes(): Theme[] {
    return Array.from(this.availableThemes.values())
  }

  /**
   * Gets the names of all available themes
   */
  public getAvailableThemeNames(): string[] {
    return Array.from(this.availableThemes.keys())
  }

  /**
   * Sets the current theme by name
   * @param name Name of the theme to set
   * @returns The new theme, or undefined if not found
   */
  public setTheme(name: string): Theme | undefined {
    const theme = this.availableThemes.get(name)
    if (theme) {
      // Clean up previous color scheme listener if it exists
      if (this.colorSchemeCleanup) {
        this.colorSchemeCleanup()
        this.colorSchemeCleanup = null
      }

      this.currentThemeName = name
      this.currentTheme = theme

      // Set up auto-theme listener if needed
      if (isBrowser && name.startsWith('auto')) {
        this.colorSchemeCleanup = onColorSchemeChange((_isDark) => {
          const newThemeName = resolveAutoTheme(name)
          const newTheme = getTheme(newThemeName)
          if (newTheme) {
            this.currentTheme = newTheme
            this.notifyThemeChange(newTheme)
          }
        })
      }

      // Apply theme in browser environment
      if (isBrowser) {
        void import('./theme').then(({ applyTheme }) => {
          applyTheme(this.currentTheme)
        })
      }

      // Save theme preference
      if (isBrowser && window.localStorage) {
        try {
          window.localStorage.setItem('krusty-theme', name)
        }
        catch {
          // Ignore errors
        }
      }

      this.notifyThemeChange(this.currentTheme)
      return this.currentTheme
    }
    return undefined
  }

  /**
   * Adds a theme to the available themes
   * @param theme Theme to add
   */
  public addTheme(theme: Theme): void {
    this.availableThemes.set(theme.name, theme)
  }

  /**
   * Removes a theme from the available themes
   * @param name Name of the theme to remove
   * @returns true if the theme was removed, false if not found
   */
  public removeTheme(name: string): boolean {
    // Don't remove the current theme
    if (this.currentTheme.name === name) {
      return false
    }
    return this.availableThemes.delete(name)
  }

  /**
   * Adds a listener for theme changes
   * @param listener Function to call when the theme changes
   * @returns A function to remove the listener
   */
  public onThemeChange(listener: (theme: Theme) => void): () => void {
    this.themeChangeListeners.push(listener)

    // Call the listener immediately with the current theme
    listener(this.currentTheme)

    // Return a function to remove the listener
    return () => {
      const index = this.themeChangeListeners.indexOf(listener)
      if (index !== -1) {
        this.themeChangeListeners.splice(index, 1)
      }
    }
  }

  /**
   * Notifies all listeners of a theme change
   * @param theme The new theme
   */
  private notifyThemeChange(theme: Theme): void {
    for (const listener of this.themeChangeListeners) {
      try {
        listener(theme)
      }
      catch (error) {
        // Use console.warn instead of console.error to be less noisy
        console.warn('Theme change listener error:', error)
      }
    }
  }
}

// Export a singleton instance
export const themeManager: ThemeManager = new ThemeManager()

// Re-export types and functions from theme.ts
export type { Theme, ThemeColors } from './theme'
export { getThemeNames, getThemes, initThemes }
