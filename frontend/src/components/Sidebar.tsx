import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ArrowLeftRight, BarChart2,
  Target, Download, Tags, Wallet, PanelLeftClose, PanelLeftOpen, Palette, TrendingUp
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { api } from '../api'
import clsx from 'clsx'
import ThemeModal from './ThemeModal'
import MatrixRain from './MatrixRain'
import AuroraEffect from './AuroraEffect'
import NebulaEffect from './NebulaEffect'
import VaporwaveEffect from './VaporwaveEffect'
import { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, applyTheme } from '../theme/themes'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/analytics', icon: BarChart2, label: 'Analytiques' },
  { to: '/planification', icon: Target, label: 'Planification' },
  { to: '/futur', icon: TrendingUp, label: 'Futur' },
  { to: '/categorize', icon: Tags, label: 'Catégoriser', badge: true },
]

export default function Sidebar() {
  const [uncatCount, setUncatCount] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME)
  const [themeModalOpen, setThemeModalOpen] = useState(false)

  useEffect(() => {
    api.transactions({ per_page: 1, is_internal: false, is_credit: false, uncategorized_only: true })
      .then(r => setUncatCount(r.total))
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // The theme applies instantly from localStorage above (avoids a flash of
  // the default theme), then the server value — synced across devices —
  // takes over once it arrives. A theme picked before ever loading the
  // server value gets migrated up so it isn't lost.
  useEffect(() => {
    api.getTheme().then(serverTheme => {
      if (serverTheme) {
        setTheme(serverTheme)
        localStorage.setItem(THEME_STORAGE_KEY, serverTheme)
      } else {
        const local = localStorage.getItem(THEME_STORAGE_KEY)
        if (local) api.setTheme(local).catch(() => {})
      }
    })
  }, [])

  function handleSelectTheme(id: string) {
    setTheme(id)
    localStorage.setItem(THEME_STORAGE_KEY, id)
    api.setTheme(id).catch(() => {})
  }

  const activeThemeName = THEMES.find(t => t.id === theme)?.name ?? theme
  const isMatrix = theme === 'matrix'
  const isAurora = theme === 'aurora'
  const isNebula = theme === 'nebula'
  const isVaporwave = theme === 'vaporwave'

  if (collapsed) {
    return (
      <aside className="relative w-12 bg-white border-r border-gray-200 flex flex-col items-center py-6 shrink-0 overflow-hidden">
        {isMatrix && <MatrixRain />}
        {isAurora && <AuroraEffect />}
        {isNebula && <NebulaEffect />}
        {isVaporwave && <VaporwaveEffect />}
        <button
          onClick={() => setCollapsed(false)}
          title="Ouvrir le menu"
          className="relative z-10 p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <PanelLeftOpen size={18} />
        </button>
        <button
          onClick={() => setThemeModalOpen(true)}
          title="Changer de thème"
          className="relative z-10 mt-auto p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Palette size={18} />
        </button>
        {themeModalOpen && (
          <ThemeModal
            current={theme}
            onSelect={handleSelectTheme}
            onClose={() => setThemeModalOpen(false)}
          />
        )}
      </aside>
    )
  }

  return (
    <aside className="relative w-56 bg-white border-r border-gray-200 flex flex-col py-6 shrink-0 overflow-hidden">
      {isMatrix && <MatrixRain />}
      {isAurora && <AuroraEffect />}
      {isNebula && <NebulaEffect />}
      {isVaporwave && <VaporwaveEffect />}
      <div className="relative z-10 flex flex-col flex-1 min-h-0">
        <div className="px-5 mb-8 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2 theme-fx-logo">
              <Wallet className="w-5 h-5 text-blue-600" />
              <span>Finances</span>
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Thomas Favre</p>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            title="Fermer le menu"
            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700 theme-fx-nav-active'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {badge && uncatCount !== null && uncatCount > 0 && (
                <span className="bg-orange-100 text-orange-600 text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {uncatCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 mt-4">
          <NavLink
            to="/import"
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2 w-full px-3 py-2 text-xs rounded-lg transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              )
            }
          >
            <Download size={14} />
            Import de données
          </NavLink>
        </div>

        <div className="px-3 mt-1">
          <button
            onClick={() => setThemeModalOpen(true)}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Palette size={14} />
            {activeThemeName}
          </button>
        </div>
      </div>

      {themeModalOpen && (
        <ThemeModal
          current={theme}
          onSelect={handleSelectTheme}
          onClose={() => setThemeModalOpen(false)}
        />
      )}
    </aside>
  )
}
