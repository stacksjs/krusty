/**
 * Theme configuration for the krusty shell
 */

import { isBrowser, isNode } from './utils/environment'
import { applyFontSettings, loadGoogleFont } from './utils/font-utils'
import { detectPreferredColorScheme, resolveAutoTheme } from './utils/theme-utils'

export { isBrowser, isNode } from './utils/environment'

/**
 * Represents a color in the theme
 */
type Color = `#${string}` | `rgb(${number}, ${number}, ${number})` | `rgba(${number}, ${number}, ${number}, ${number})`

/**
 * Theme colors for different UI elements
 */
export interface ThemeColors {
  // Text colors
  primaryText: Color
  secondaryText: Color
  successText: Color
  warningText: Color
  errorText: Color
  infoText: Color

  // Background colors
  background: Color
  surface: Color
  surfaceHighlight: Color

  // UI element colors
  border: Color
  divider: Color

  // Status colors
  success: Color
  warning: Color
  error: Color
  info: Color

  // Code syntax highlighting (optional)
  syntax?: {
    keyword: Color
    string: Color
    number: Color
    comment: Color
    variable: Color
    function: Color
    operator: Color
  }
}

/**
 * Theme configuration
 */
export interface Theme {
  /** Theme name */
  name: string

  /** Theme description */
  description?: string

  /** Theme colors */
  colors: ThemeColors

  /** Optional font configuration */
  font?: {
    family?: string
    size?: number
    weight?: string | number
    lineHeight?: number
    ligatures?: boolean
  }

  /** Optional symbols configuration */
  symbols?: {
    prompt?: string
    continuation?: string
    git?: {
      branch?: string
      ahead?: string
      behind?: string
      staged?: string
      unstaged?: string
      untracked?: string
    }
  }

  /** Optional CSS to be injected when this theme is active */
  css?: string
}

/**
 * Built-in themes
 */
export const defaultThemes: Record<string, Theme> = {
  dark: {
    name: 'dark',
    description: 'Default dark theme',
    colors: {
      primaryText: '#ffffff',
      secondaryText: '#a0aec0',
      successText: '#9ae6b4',
      warningText: '#faf089',
      errorText: '#feb2b2',
      infoText: '#90cdf4',
      background: '#1a202c',
      surface: '#2d3748',
      surfaceHighlight: '#4a5568',
      border: '#4a5568',
      divider: '#4a5568',
      success: '#48bb78',
      warning: '#ecc94b',
      error: '#f56565',
      info: '#4299e1',
      syntax: {
        keyword: '#f6ad55',
        string: '#68d391',
        number: '#f6e05e',
        comment: '#a0aec0',
        variable: '#f6ad55',
        function: '#63b3ed',
        operator: '#f6ad55',
      },
    },
  },
  light: {
    name: 'light',
    description: 'Default light theme',
    colors: {
      primaryText: '#1a202c',
      secondaryText: '#4a5568',
      successText: '#276749',
      warningText: '#975a16',
      errorText: '#9b2c2c',
      infoText: '#2c5282',
      background: '#f7fafc',
      surface: '#ffffff',
      surfaceHighlight: '#edf2f7',
      border: '#e2e8f0',
      divider: '#cbd5e0',
      success: '#48bb78',
      warning: '#ed8936',
      error: '#f56565',
      info: '#4299e1',
      syntax: {
        keyword: '#dd6b20',
        string: '#38a169',
        number: '#b7791f',
        comment: '#a0aec0',
        variable: '#dd6b20',
        function: '#3182ce',
        operator: '#dd6b20',
      },
    },
  },
  solarizedDark: {
    name: 'solarized-dark',
    description: 'Solarized dark theme',
    colors: {
      primaryText: '#839496',
      secondaryText: '#586e75',
      successText: '#859900',
      warningText: '#b58900',
      errorText: '#dc322f',
      infoText: '#268bd2',
      background: '#002b36',
      surface: '#073642',
      surfaceHighlight: '#0d4b5a',
      border: '#586e75',
      divider: '#586e75',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f',
      info: '#268bd2',
      syntax: {
        keyword: '#cb4b16',
        string: '#859900',
        number: '#d33682',
        comment: '#586e75',
        variable: '#268bd2',
        function: '#2aa198',
        operator: '#6c71c4',
      },
    },
  },
  solarizedLight: {
    name: 'solarized-light',
    description: 'Solarized light theme',
    colors: {
      primaryText: '#657b83',
      secondaryText: '#93a1a1',
      successText: '#859900',
      warningText: '#b58900',
      errorText: '#dc322f',
      infoText: '#268bd2',
      background: '#fdf6e3',
      surface: '#eee8d5',
      surfaceHighlight: '#e6dfc2',
      border: '#93a1a1',
      divider: '#93a1a1',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f',
      info: '#268bd2',
      syntax: {
        keyword: '#cb4b16',
        string: '#859900',
        number: '#d33682',
        comment: '#93a1a1',
        variable: '#268bd2',
        function: '#2aa198',
        operator: '#6c71c4',
      },
    },
  },
  terminal: {
    name: 'terminal',
    description: 'Classic terminal theme with green on black',
    colors: {
      primaryText: '#33ff33', // Bright green text
      secondaryText: '#00cc00', // Slightly dimmer green
      successText: '#33ff33', // Green for success
      warningText: '#ffff00', // Yellow for warnings
      errorText: '#ff3333', // Red for errors
      infoText: '#00ffff', // Cyan for info
      background: '#000000', // Black background
      surface: '#0a0a0a', // Slightly lighter black for surfaces
      surfaceHighlight: '#1a1a1a', // Even lighter for highlights
      border: '#00aa00', // Green borders
      divider: '#005500', // Dark green dividers
      success: '#33ff33', // Green for success elements
      warning: '#ffff00', // Yellow for warnings
      error: '#ff3333', // Red for errors
      info: '#00ffff', // Cyan for info
      syntax: {
        keyword: '#33ff33', // Green for keywords
        string: '#00cc00', // Darker green for strings
        number: '#33ff33', // Green for numbers
        comment: '#007700', // Dark green for comments
        variable: '#33ff33', // Green for variables
        function: '#33ff33', // Green for functions
        operator: '#33ff33', // Green for operators
      },
    },
    // Add some terminal-like styling
    css: `
      --font-family: 'Courier New', monospace;
      --font-size: 14px;
      --line-height: 1.4;
      --border-radius: 0;
      --box-shadow: none;
    `,
  },
  dracula: {
    name: 'dracula',
    description: 'Dracula theme with vibrant colors',
    colors: {
      primaryText: '#f8f8f2',
      secondaryText: '#bd93f9',
      successText: '#50fa7b',
      warningText: '#f1fa8c',
      errorText: '#ff5555',
      infoText: '#8be9fd',
      background: '#282a36',
      surface: '#44475a',
      surfaceHighlight: '#6272a4',
      border: '#bd93f9',
      divider: '#6272a4',
      success: '#50fa7b',
      warning: '#f1fa8c',
      error: '#ff5555',
      info: '#8be9fd',
      syntax: {
        keyword: '#ff79c6',
        string: '#f1fa8c',
        number: '#bd93f9',
        comment: '#6272a4',
        variable: '#f8f8f2',
        function: '#50fa7b',
        operator: '#ff79c6',
      },
    },
  },
  nord: {
    name: 'nord',
    description: 'Arctic, north-bluish color palette',
    colors: {
      primaryText: '#eceff4',
      secondaryText: '#e5e9f0',
      successText: '#a3be8c',
      warningText: '#ebcb8b',
      errorText: '#bf616a',
      infoText: '#88c0d0',
      background: '#2e3440',
      surface: '#3b4252',
      surfaceHighlight: '#4c566a',
      border: '#4c566a',
      divider: '#4c566a',
      success: '#a3be8c',
      warning: '#ebcb8b',
      error: '#bf616a',
      info: '#81a1c1',
      syntax: {
        keyword: '#81a1c1',
        string: '#a3be8c',
        number: '#b48ead',
        comment: '#4c566a',
        variable: '#d8dee9',
        function: '#88c0d0',
        operator: '#81a1c1',
      },
    },
  },
  oneDark: {
    name: 'one-dark',
    description: 'Dark theme based on Atom One Dark',
    colors: {
      primaryText: '#abb2bf',
      secondaryText: '#7f848e',
      successText: '#98c379',
      warningText: '#e5c07b',
      errorText: '#e06c75',
      infoText: '#61afef',
      background: '#282c34',
      surface: '#353b45',
      surfaceHighlight: '#3e4451',
      border: '#5c6370',
      divider: '#5c6370',
      success: '#98c379',
      warning: '#e5c07b',
      error: '#e06c75',
      info: '#61afef',
      syntax: {
        keyword: '#c678dd',
        string: '#98c379',
        number: '#d19a66',
        comment: '#5c6370',
        variable: '#e06c75',
        function: '#61afef',
        operator: '#56b6c2',
      },
    },
  },
  gruvboxDark: {
    name: 'gruvbox-dark',
    description: 'Gruvbox dark theme with warm colors',
    colors: {
      primaryText: '#ebdbb2',
      secondaryText: '#d5c4a1',
      successText: '#b8bb26',
      warningText: '#fabd2f',
      errorText: '#fb4934',
      infoText: '#83a598',
      background: '#282828',
      surface: '#3c3836',
      surfaceHighlight: '#504945',
      border: '#665c54',
      divider: '#665c54',
      success: '#b8bb26',
      warning: '#fabd2f',
      error: '#fb4934',
      info: '#83a598',
      syntax: {
        keyword: '#fe8019',
        string: '#b8bb26',
        number: '#d3869b',
        comment: '#928374',
        variable: '#ebdbb2',
        function: '#8ec07c',
        operator: '#fe8019',
      },
    },
  },
  gruvboxLight: {
    name: 'gruvbox-light',
    description: 'Gruvbox light theme with warm colors',
    colors: {
      primaryText: '#3c3836',
      secondaryText: '#504945',
      successText: '#79740e',
      warningText: '#b57614',
      errorText: '#9d0006',
      infoText: '#076678',
      background: '#fbf1c7',
      surface: '#ebdbb2',
      surfaceHighlight: '#d5c4a1',
      border: '#bdae93',
      divider: '#bdae93',
      success: '#79740e',
      warning: '#b57614',
      error: '#9d0006',
      info: '#076678',
      syntax: {
        keyword: '#9d0006',
        string: '#79740e',
        number: '#8f3f71',
        comment: '#928374',
        variable: '#3c3836',
        function: '#427b58',
        operator: '#9d0006',
      },
    },
  },
}

/**
 * Gets a theme by name
 * @param name Theme name
 * @returns Theme or undefined if not found
 */
export function getTheme(name: string): Theme | undefined {
  return defaultThemes[name]
}

/**
 * Gets all available themes
 * @returns Array of available themes
 */
export function getThemes(): Theme[] {
  return Object.values(defaultThemes)
}

/**
 * Gets the names of all available themes
 * @returns Array of theme names
 */
export function getThemeNames(): string[] {
  return Object.keys(defaultThemes)
}

/**
 * Applies a theme to the environment
 * In browser: Updates CSS custom properties and loads fonts
 * In shell: No-op (handled by the shell's rendering)
 * @param theme Theme to apply
 * @param targetElement Optional target element to apply the theme to (defaults to document.documentElement)
 */
export async function applyTheme(theme: Theme, targetElement?: HTMLElement): Promise<void> {
  if (!isBrowser) {
    console.warn(`Theme applied in non-browser environment: ${theme.name}`)
    return
  }

  try {
    const root = targetElement || document.documentElement

    // Apply font settings if specified
    if (theme.font) {
      applyFontSettings(root, {
        family: theme.font.family,
        size: theme.font.size,
        weight: theme.font.weight,
        lineHeight: theme.font.lineHeight,
        ligatures: theme.font.ligatures,
      })

      // Load Google Fonts if the font looks like a Google Font
      if (theme.font.family && !theme.font.family.includes(',')) {
        const fontName = theme.font.family.replace(/['"]/g, '').trim()
        if (!document.querySelector(`link[href*="${fontName.replace(/\s+/g, '+')}"]`)) {
          try {
            await loadGoogleFont(fontName, {
              weights: typeof theme.font.weight === 'number' ? [theme.font.weight as any] : [400, 700],
              display: 'swap',
            })
          }
          catch (error) {
            console.warn(`Failed to load Google Font ${fontName}:`, error)
          }
        }
      }
    }

    // Set CSS custom properties for colors
    if (theme.colors) {
      Object.entries(theme.colors).forEach(([key, value]) => {
        if (value) {
          root.style.setProperty(`--color-${key}`, value)
        }
      })
    }

    // Set CSS custom properties for symbols
    if (theme.symbols) {
      Object.entries(theme.symbols).forEach(([key, value]) => {
        if (typeof value === 'string') {
          root.style.setProperty(`--symbol-${key}`, `'${value}'`)
        }
        else if (value && typeof value === 'object') {
          Object.entries(value).forEach(([subKey, subValue]) => {
            if (typeof subValue === 'string') {
              root.style.setProperty(`--symbol-${key}-${subKey}`, `'${subValue}'`)
            }
          })
        }
      })
    }

    // Apply any custom CSS
    if (theme.css) {
      const style = document.createElement('style')
      style.id = `krusty-theme-${theme.name}`
      style.textContent = `:root { ${theme.css} }`

      // Remove any existing theme style
      const existingStyle = document.getElementById(style.id)
      if (existingStyle) {
        existingStyle.remove()
      }

      document.head.appendChild(style)
    }

    // Save theme preference
    try {
      localStorage.setItem('krusty-theme', theme.name)
    }
    catch (error) {
      // Ignore localStorage errors (e.g., in private browsing)
      if (error instanceof Error) {
        console.warn(`Failed to save theme: ${error.message}`)
      }
    }
  }
  catch (error) {
    console.error('Error applying theme:', error)
  }
}

/**
 * Initializes the theme system
 * @param defaultThemeName Optional default theme name (defaults to 'terminal' for shell, 'auto' for browser)
 * @returns The applied theme
 */
export function initThemes(defaultThemeName?: string): Theme {
  // Default to 'terminal' in Node.js, 'auto' in browser if not specified
  const defaultTheme = isNode ? 'terminal' : 'auto'
  const themeToUse = defaultThemeName || defaultTheme

  let savedTheme: string | null = null

  // Try to load saved theme from localStorage if in browser
  if (isBrowser && typeof window !== 'undefined' && window.localStorage) {
    try {
      savedTheme = window.localStorage.getItem('krusty-theme')
    }
    catch (error: unknown) {
      // Ignore localStorage errors
      if (error instanceof Error) {
        console.warn(`Failed to load saved theme: ${error.message}`)
      }
    }
  }

  // Resolve auto-theme if needed
  const themeName = savedTheme || themeToUse
  const resolvedThemeName = themeName.startsWith('auto') ? resolveAutoTheme(themeName) : themeName

  // Get the theme or fall back to the default
  const theme = getTheme(resolvedThemeName)
    || (isNode ? defaultThemes.terminal : defaultThemes[detectPreferredColorScheme()])
    || Object.values(defaultThemes)[0]

  // Apply the theme
  applyTheme(theme)

  // Set up listener for system theme changes if using auto theme
  if (isBrowser && themeName.startsWith('auto')) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const newThemeName = resolveAutoTheme(themeName)
      const newTheme = getTheme(newThemeName)
      if (newTheme) {
        applyTheme(newTheme)
      }
    }

    mediaQuery.addEventListener('change', handleChange)
  }

  return theme
}
