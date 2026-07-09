export interface Theme {
  id: string
  name: string
  /** Background color of the pill behind the dots in the theme picker (--gray-50, page bg) */
  bg: string
  /**
   * Dot 1 = primary accent (--blue-600: buttons, active nav, selected option)
   * Dot 2 = main text color (--gray-900)
   * Dot 3 = hover / selection background (--gray-100)
   */
  colors: [string, string, string]
}

export const THEMES: Theme[] = [
  { id: 'light', name: 'clair', bg: '#f9fafb', colors: ['#2563eb', '#111827', '#f3f4f6'] },
  { id: 'cyberspace', name: 'cyberspace', bg: '#12151a', colors: ['#7c3aed', '#f1f5fb', '#1c2128'] },
]

export const DEFAULT_THEME = 'light'
export const THEME_STORAGE_KEY = 'theme'

export function applyTheme(id: string) {
  document.documentElement.setAttribute('data-theme', id)
}
