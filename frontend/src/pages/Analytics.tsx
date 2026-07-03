import { useEffect, useState } from 'react'
import { api, CashflowData, Account, Transaction, BalanceHistory, Merchant } from '../api'
import CashflowSankey from '../components/CashflowSankey'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid, Area, AreaChart
} from 'recharts'
import { BarChart2, Activity, TrendingUp, Store, AlertTriangle, RefreshCw } from 'lucide-react'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)
const fmtMonth = (s: string) => {
  if (!s) return ''
  const [y, m] = s.split('-')
  return new Date(+y, +m - 1).toLocaleDateString('fr-CH', { month: 'short', year: '2-digit' })
}

const PERIODS = [
  { id: 'current_month', label: 'Ce mois' },
  { id: 'last_month', label: 'Mois dernier' },
  { id: 'last_3_months', label: '3 derniers mois' },
  { id: 'last_6_months', label: '6 derniers mois' },
  { id: 'current_year', label: 'Année en cours' },
  { id: 'all', label: 'Tout l’historique' },
]

const TABS = [
  { id: 'overview', label: "Vue d'ensemble", icon: BarChart2 },
  { id: 'sankey', label: 'Flux (Sankey)', icon: Activity },
  { id: 'trends', label: 'Tendances', icon: TrendingUp },
  { id: 'merchants', label: 'Marchands', icon: Store },
] as const

type TabId = typeof TABS[number]['id']

const MEMORY_CACHE: Record<string, CashflowData> = {}

export default function Analytics() {
  const [data, setData] = useState<CashflowData | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [period, setPeriod] = useState<string>('last_6_months')
  const [accountId, setAccountId] = useState<number | undefined>(undefined)
  const [tab, setTab] = useState<TabId>('overview')

  const [balanceHistory, setBalanceHistory] = useState<BalanceHistory[]>([])
  const [merchants, setMerchants] = useState<Merchant[]>([])

  // Drill down modal state
  const [selectedCategory, setSelectedCategory] = useState<{ name: string; id?: number } | null>(null)
  const [categoryTxs, setCategoryTxs] = useState<Transaction[]>([])
  const [txLoading, setTxLoading] = useState(false)

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => {})
  }, [])

  useEffect(() => {
    api.balanceHistory(accountId).then(setBalanceHistory).catch(() => {})
    api.topMerchants({ account_id: accountId, limit: 10 }).then(setMerchants).catch(() => {})
  }, [accountId])

  useEffect(() => {
    const cacheKey = `${period}_${accountId ?? 'all'}`
    if (MEMORY_CACHE[cacheKey]) {
      setData(MEMORY_CACHE[cacheKey])
      setLoading(false)
      setError(null)
      return
    }

    try {
      const saved = sessionStorage.getItem(`cashflow_${cacheKey}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        MEMORY_CACHE[cacheKey] = parsed
        setData(parsed)
        setLoading(false)
        setError(null)
        return
      }
    } catch (e) {}

    setLoading(true)
    setError(null)
    api.cashflow({ account_id: accountId, period })
      .then(res => {
        MEMORY_CACHE[cacheKey] = res
        try { sessionStorage.setItem(`cashflow_${cacheKey}`, JSON.stringify(res)) } catch (e) {}
        setData(res)
        setError(null)
      })
      .catch(err => {
        setError(err.message || 'Erreur inconnue')
      })
      .finally(() => setLoading(false))
  }, [period, accountId])

  async function handleOpenCategory(catName: string, catId?: number, filter?: { merchant?: string; merchants?: string[]; label?: string; isCredit?: boolean }) {
    const label = filter?.label || filter?.merchant
    setSelectedCategory({ name: label ? `${catName} · ${label}` : catName, id: catId })
    setTxLoading(true)
    try {
      const res = await api.transactions({
        account_id: accountId,
        category_id: catId,
        merchant: filter?.merchant,
        merchants: filter?.merchants,
        is_credit: filter?.isCredit ?? false,
        is_internal: false,
        per_page: 50
      })
      setCategoryTxs(res.items)
    } catch (e) {
      console.error(e)
    } finally {
      setTxLoading(false)
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-6 space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center shadow-sm">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-gray-900">Impossible de charger les données</h3>
        <p className="text-xs text-gray-600 max-w-md leading-relaxed">
          Le serveur backend a renvoyé une erreur (<span className="font-semibold text-red-600">{error}</span>).
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl shadow-sm hover:bg-blue-700 transition-colors mt-2 flex items-center gap-1.5 justify-center"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Réessayer</span>
        </button>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] space-y-3 text-gray-400 font-medium">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm">Analyse des flux financiers en cours...</p>
      </div>
    )
  }

  const { summary, outflows, monthly_trend } = data
  const topCategory = outflows[0]

  return (
    <div className="p-6 space-y-6 w-full">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytiques</h1>
          <p className="text-sm text-gray-500 mt-1">
            Comprenez en un coup d'œil d'où vient votre argent et où il part
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="text-xs font-medium border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={accountId ?? ''}
            onChange={e => setAccountId(e.target.value ? +e.target.value : undefined)}
          >
            <option value="">Tous les comptes</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>

          <div className="bg-gray-100 p-1 rounded-xl flex items-center text-xs font-medium overflow-x-auto">
            {PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                  period === p.id
                    ? 'bg-white text-gray-900 shadow-sm font-semibold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200 pb-2">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-2 text-sm font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-medium mb-2">
                <span>Revenus</span>
                <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">+</span>
              </div>
              <p className="text-2xl font-extrabold text-gray-900">{fmt(summary.income)}</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-medium mb-2">
                <span>Dépenses</span>
                <span className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center font-bold">-</span>
              </div>
              <p className="text-2xl font-extrabold text-gray-900">{fmt(summary.expenses)}</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-medium mb-2">
                <span>Solde Net / Épargne</span>
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold ${
                  summary.net_savings >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                }`}>
                  {summary.net_savings >= 0 ? '✓' : '⚠'}
                </span>
              </div>
              <p className={`text-2xl font-extrabold ${summary.net_savings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {summary.net_savings > 0 ? '+' : ''}{fmt(summary.net_savings)}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-medium mb-2">
                <span>Taux d'Épargne</span>
              </div>
              <p className={`text-2xl font-extrabold ${summary.savings_rate >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {summary.savings_rate}%
              </p>
              <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${summary.savings_rate >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(100, Math.max(0, summary.savings_rate))}%` }}
                />
              </div>
            </div>
          </div>



          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category pie */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Dépenses par catégorie</h2>
              {outflows.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-12">Aucune donnée</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={outflows} dataKey="amount" nameKey="name" cx="40%" cy="50%" outerRadius={100} innerRadius={55}>
                      {outflows.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" iconSize={8}
                      formatter={(v) => <span className="text-xs">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Proportional category blocks */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Postes de dépense</h2>
              <div className="grid grid-cols-2 gap-3 max-h-[260px] overflow-y-auto pr-1">
                {outflows.map(out => (
                  <div
                    key={out.id}
                    onClick={() => handleOpenCategory(out.name, out.id)}
                    className="group relative rounded-xl p-3 border transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5 overflow-hidden"
                    style={{ borderColor: out.color || '#E2E8F0', backgroundColor: `${out.color || '#3B82F6'}08` }}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-lg">{out.icon}</span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${out.color || '#3B82F6'}20`, color: out.color || '#3B82F6' }}>
                        {out.percentage_of_expenses}%
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-gray-900 truncate">{out.name}</h4>
                    <p className="text-sm font-extrabold text-gray-900 mt-0.5">{fmt(out.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'sankey' && (
        <CashflowSankey data={data} onSelectCategory={(name, id, filter) => handleOpenCategory(name, id, filter)} />
      )}

      {tab === 'trends' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Évolution comparative Entrées vs Sorties</h3>
            <p className="text-xs text-gray-500 mb-6">Comparez la dynamique de vos revenus, dépenses et capacité d'épargne mois par mois</p>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={monthly_trend} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 12, fill: '#64748B' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748B' }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={fmtMonth} />
                <Legend iconType="circle" iconSize={8} />
                <Bar dataKey="income" name="Revenus" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Dépenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="net" name="Épargne Nette" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Évolution du solde</h2>
              <span className="text-[11px] text-gray-400">Historique complet</span>
            </div>
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
        </div>
      )}

      {tab === 'merchants' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Top 10 marchands</h2>
              <span className="text-[11px] text-gray-400">Historique complet</span>
            </div>
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
              {merchants.length === 0 && <p className="text-gray-400 text-sm text-center py-8">Aucune donnée</p>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Détail par catégorie</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Période sélectionnée ci-dessus</p>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Catégorie</th>
                  <th className="px-5 py-3.5 text-right">Montant</th>
                  <th className="px-5 py-3.5">Part des dépenses</th>
                  <th className="px-5 py-3.5 text-right">Transactions</th>
                  <th className="px-5 py-3.5 text-right">Panier moyen</th>
                  <th className="px-5 py-3.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {outflows.map(out => (
                  <tr key={out.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{out.icon}</span>
                        <span className="font-semibold text-gray-900">{out.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-extrabold text-gray-900">{fmt(out.amount)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ backgroundColor: out.color || '#3B82F6', width: `${Math.min(100, out.percentage_of_expenses)}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 w-10 text-right">{out.percentage_of_expenses}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right text-gray-600 font-medium">{out.tx_count}</td>
                    <td className="px-5 py-3.5 text-right text-gray-600 font-medium">{fmt(out.avg_ticket)}</td>
                    <td className="px-5 py-3.5 text-center">
                      <button
                        onClick={() => handleOpenCategory(out.name, out.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-lg transition-colors"
                      >
                        Détails ➔
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drill-down slide over modal */}
      {selectedCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Transactions : {selectedCategory.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">Aperçu des mouvements associés</p>
              </div>
              <button
                onClick={() => setSelectedCategory(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {txLoading ? (
                <div className="text-center py-12 text-gray-400 text-sm font-medium">Chargement des transactions...</div>
              ) : categoryTxs.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">Aucune transaction trouvée sur cette période.</div>
              ) : (
                categoryTxs.map(tx => (
                  <div key={tx.id} className="p-3.5 rounded-xl border border-gray-100 bg-gray-50/50 flex items-center justify-between gap-4 hover:bg-gray-100/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {tx.counterparty || tx.description || 'Transaction anonyme'}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                        <span>{new Date(tx.date).toLocaleDateString('fr-CH')}</span>
                        {tx.description && tx.description !== tx.counterparty && (
                          <span className="truncate max-w-[200px]">({tx.description})</span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-extrabold text-gray-900 shrink-0">{fmt(tx.amount)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
