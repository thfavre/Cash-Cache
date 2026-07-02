import { useEffect, useState } from 'react'
import { api, MonthlyStats, CategoryStats, BalanceHistory, Merchant } from '../api'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  CartesianGrid, Area, AreaChart
} from 'recharts'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)
const fmtMonth = (s: string) => {
  if (!s) return ''
  const [y, m] = s.split('-')
  return new Date(+y, +m - 1).toLocaleDateString('fr-CH', { month: 'short', year: '2-digit' })
}

const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i)

export default function Analytics() {
  const [monthly, setMonthly] = useState<MonthlyStats[]>([])
  const [catStats, setCatStats] = useState<CategoryStats[]>([])
  const [balanceHistory, setBalanceHistory] = useState<BalanceHistory[]>([])
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)

  const [year, setYear] = useState<number | undefined>(undefined)
  const [month, setMonth] = useState<number | undefined>(undefined)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.monthly({ year }),
      api.categoryStats({ year, month }),
      api.balanceHistory(),
      api.topMerchants({ year, month, limit: 10 }),
    ]).then(([mon, cats, bal, merch]) => {
      setMonthly(mon)
      setCatStats(cats)
      setBalanceHistory(bal)
      setMerchants(merch)
    }).finally(() => setLoading(false))
  }, [year, month])

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Chargement...</div>

  const months = [
    ['', 'Tous'],
    ['1', 'Janvier'], ['2', 'Février'], ['3', 'Mars'], ['4', 'Avril'],
    ['5', 'Mai'], ['6', 'Juin'], ['7', 'Juillet'], ['8', 'Août'],
    ['9', 'Septembre'], ['10', 'Octobre'], ['11', 'Novembre'], ['12', 'Décembre'],
  ]

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Analytiques</h1>
        <div className="flex gap-3">
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
            value={year ?? ''}
            onChange={e => setYear(e.target.value ? +e.target.value : undefined)}
          >
            <option value="">Toutes années</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
            value={month ?? ''}
            onChange={e => setMonth(e.target.value ? +e.target.value : undefined)}
          >
            {months.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {/* Income vs Expenses */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenus vs Dépenses</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthly} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={fmtMonth} />
            <Legend iconType="circle" iconSize={8} />
            <Bar dataKey="income" name="Revenus" fill="#22C55E" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expenses" name="Dépenses" fill="#EF4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Balance history */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Évolution du solde</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={balanceHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={fmtMonth} />
            <Area type="monotone" dataKey="balance" name="Solde" stroke="#3B82F6" fill="#EFF6FF" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Dépenses par catégorie</h2>
          {catStats.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-12">Aucune donnée</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={catStats} dataKey="total" nameKey="name" cx="40%" cy="50%" outerRadius={100} innerRadius={55}>
                  {catStats.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => <span className="text-xs">{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top merchants */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Top 10 marchands</h2>
          <div className="space-y-2">
            {merchants.slice(0, 10).map((m, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs text-gray-700 truncate">{m.name}</p>
                    <p className="text-xs font-semibold text-gray-900 ml-2 shrink-0">{fmt(m.total)}</p>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full">
                    <div
                      className="h-1.5 bg-blue-400 rounded-full"
                      style={{ width: `${Math.min(100, (m.total / (merchants[0]?.total || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly net savings */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Épargne nette mensuelle</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={fmtMonth} />
            <Bar dataKey="net" name="Net" radius={[3, 3, 0, 0]}>
              {monthly.map((m, i) => (
                <Cell key={i} fill={m.net >= 0 ? '#22C55E' : '#EF4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
