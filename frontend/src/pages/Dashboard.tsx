import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { api, Overview, Transaction, Account } from '../api'
import CategoryBadge from '../components/CategoryBadge'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [recentTxs, setRecentTxs] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  useEffect(() => {
    Promise.all([
      api.overview({ year, month }),
      api.transactions({ per_page: 10, is_internal: false }),
      api.accounts(),
    ]).then(([ov, txs, accts]) => {
      setOverview(ov)
      setRecentTxs(txs.items)
      setAccounts(accts)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Chargement...</div>

  const cards = [
    { label: 'Solde total', value: fmt(overview?.total_balance ?? 0), color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Revenus ce mois', value: fmt(overview?.income ?? 0), color: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'Dépenses ce mois', value: fmt(overview?.expenses ?? 0), color: 'text-red-500', bg: 'bg-red-500/10' },
    { label: 'Taux d\'épargne', value: `${overview?.savings_rate ?? 0}%`, color: 'text-purple-600', bg: 'bg-purple-500/10' },
  ]

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 theme-fx-logo">Tableau de bord</h1>
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
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Wallet size={16} /> Comptes
          </h2>
          <Link to="/import" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
            Gérer ➔
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {accounts.map(a => (
            <div key={a.id} className="border border-gray-100 rounded-lg p-3 min-w-0">
              <p className="text-sm text-gray-800 truncate">{a.name}</p>
              <p className="text-base font-semibold text-gray-900 mt-1">
                {new Intl.NumberFormat('fr-CH', { style: 'currency', currency: a.currency }).format(a.closing_balance)}
              </p>
              <p className="text-xs text-gray-400 mt-1 truncate">
                {a.transaction_count} transaction{a.transaction_count !== 1 ? 's' : ''}
                {a.last_updated && ` · mis à jour le ${new Date(a.last_updated).toLocaleDateString('fr-CH', { day: '2-digit', month: 'short' })}`}
              </p>
            </div>
          ))}
          {accounts.length === 0 && (
            <p className="col-span-full text-center py-6 text-gray-400 text-sm">Aucun compte pour le moment.</p>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Transactions récentes</h2>
          <Link to="/transactions" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
            Voir tout ➔
          </Link>
        </div>
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

      {/* Link to deeper analytics */}
      <Link
        to="/analytics"
        className="flex items-center justify-between bg-white rounded-xl border border-gray-100 p-5 hover:border-blue-200 hover:shadow-sm transition-all group"
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Voir les analytiques détaillées</h2>
          <p className="text-xs text-gray-500 mt-0.5">Tendances, flux, marchands et répartition par catégorie</p>
        </div>
        <span className="text-blue-600 font-semibold text-sm group-hover:translate-x-0.5 transition-transform">➔</span>
      </Link>
    </div>
  )
}
