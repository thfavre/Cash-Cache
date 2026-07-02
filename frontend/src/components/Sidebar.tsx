import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ArrowLeftRight, BarChart2,
  PiggyBank, TrendingUp, RefreshCw, Tags, Workflow
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { api } from '../api'
import clsx from 'clsx'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/analytics', icon: BarChart2, label: 'Analytiques' },
  { to: '/cashflow', icon: Workflow, label: 'Flux & Cashflow' },
  { to: '/budgets', icon: PiggyBank, label: 'Budgets' },
  { to: '/predictions', icon: TrendingUp, label: 'Prévisions' },
  { to: '/categorize', icon: Tags, label: 'Catégoriser', badge: true },
]

export default function Sidebar() {
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')
  const [uncatCount, setUncatCount] = useState<number | null>(null)

  useEffect(() => {
    api.transactions({ per_page: 1, is_internal: false, is_credit: false, uncategorized_only: true })
      .then(r => setUncatCount(r.total))
  }, [])

  async function handleImport() {
    setImporting(true)
    setMsg('')
    try {
      const r = await api.reimport()
      setMsg(`✓ ${r.transactions} transactions importées`)
      setTimeout(() => { setMsg(''); window.location.reload() }, 2000)
    } catch (e: any) {
      setMsg('Erreur: ' + e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col py-6 shrink-0">
      <div className="px-5 mb-8">
        <h1 className="text-lg font-bold text-gray-900">💰 Finances</h1>
        <p className="text-xs text-gray-400 mt-0.5">Thomas Favre</p>
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
                  ? 'bg-blue-50 text-blue-700'
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
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={importing ? 'animate-spin' : ''} />
          Réimporter les données
        </button>
        {msg && <p className="text-xs text-green-600 px-3 mt-1">{msg}</p>}
      </div>
    </aside>
  )
}
