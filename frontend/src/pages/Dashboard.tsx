import { useEffect, useState } from 'react'
import { api, Overview, MonthlyStats, CategoryStats, Transaction, Account } from '../api'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import CategoryBadge from '../components/CategoryBadge'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)
const fmtMonth = (s: string) => {
  const [y, m] = s.split('-')
  return new Date(+y, +m - 1).toLocaleDateString('fr-CH', { month: 'short', year: '2-digit' })
}

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [monthly, setMonthly] = useState<MonthlyStats[]>([])
  const [catStats, setCatStats] = useState<CategoryStats[]>([])
  const [recentTxs, setRecentTxs] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  useEffect(() => {
    Promise.all([
      api.overview({ year, month }),
      api.monthly(),
      api.categoryStats({ year, month }),
      api.transactions({ per_page: 10, is_internal: false }),
      api.accounts(),
    ]).then(([ov, mon, cats, txs, accts]) => {
      setOverview(ov)
      setMonthly(mon.slice(-12))
      setCatStats(cats.slice(0, 8))
      setRecentTxs(txs.items)
      setAccounts(accts)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Chargement...</div>

  const cards = [
    { label: 'Solde total', value: fmt(overview?.total_balance ?? 0), color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Revenus ce mois', value: fmt(overview?.income ?? 0), color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Dépenses ce mois', value: fmt(overview?.expenses ?? 0), color: 'text-red-500', bg: 'bg-red-50' },
    { label: 'Taux d\'épargne', value: `${overview?.savings_rate ?? 0}%`, color: 'text-purple-600', bg: 'bg-purple-50' },
  ]

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        <p className="text-sm text-gray-500 mt-1">
          {now.toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl p-4 ${c.bg}`}>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Accounts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map(a => (
          <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 truncate">{a.name}</p>
            <p className="text-lg font-bold text-gray-800 mt-1">{fmt(a.closing_balance)}</p>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{a.iban.slice(0, 8)}...{a.iban.slice(-4)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly bar chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenus vs Dépenses (12 mois)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly} barGap={2}>
              <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} />
              <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={fmtMonth} />
              <Bar dataKey="income" name="Revenus" fill="#22C55E" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Dépenses" fill="#EF4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Category donut */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Dépenses par catégorie (ce mois)</h2>
          {catStats.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-12">Aucune donnée</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={catStats} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45}>
                  {catStats.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Transactions récentes</h2>
        <div className="space-y-2">
          {recentTxs.map(tx => (
            <div key={tx.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{tx.description ?? tx.counterparty ?? '—'}</p>
                <p className="text-xs text-gray-400">{tx.date}</p>
              </div>
              <CategoryBadge name={tx.category_name} color={tx.category_color} icon={tx.category_icon} />
              <p className={`text-sm font-semibold shrink-0 ${tx.is_credit ? 'text-green-600' : 'text-gray-800'}`}>
                {tx.is_credit ? '+' : '-'}{fmt(tx.amount)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
