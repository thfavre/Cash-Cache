import { useEffect, useState, useCallback } from 'react'
import { api, Transaction, Category, Account, PaginatedTransactions } from '../api'
import CategoryBadge from '../components/CategoryBadge'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

export default function Transactions() {
  const [data, setData] = useState<PaginatedTransactions | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isCredit, setIsCredit] = useState('')
  const [showInternal, setShowInternal] = useState(false)
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [page, setPage] = useState(1)

  // For inline category editing
  const [editingId, setEditingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number | boolean | undefined> = {
        page,
        per_page: 50,
        search: search || undefined,
        account_id: accountId ? +accountId : undefined,
        category_id: categoryId ? +categoryId : undefined,
        is_credit: isCredit === '' ? undefined : isCredit === 'true',
        is_internal: showInternal ? undefined : false,
        year: year ? +year : undefined,
        month: month ? +month : undefined,
      }
      const result = await api.transactions(params)
      setData(result)
    } finally {
      setLoading(false)
    }
  }, [search, accountId, categoryId, isCredit, showInternal, year, month, page])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.categories().then(setCategories)
    api.accounts().then(setAccounts)
  }, [])

  async function handleCategoryChange(txId: number, catId: string) {
    await api.updateTransactionCategory(txId, catId ? +catId : null)
    setEditingId(null)
    load()
  }

  const totalPages = data ? Math.ceil(data.total / 50) : 1

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)
  const months = [
    ['01', 'Janvier'], ['02', 'Février'], ['03', 'Mars'], ['04', 'Avril'],
    ['05', 'Mai'], ['06', 'Juin'], ['07', 'Juillet'], ['08', 'Août'],
    ['09', 'Septembre'], ['10', 'Octobre'], ['11', 'Novembre'], ['12', 'Décembre'],
  ]

  return (
    <div className="p-6 space-y-4 w-full">
      <h1 className="text-2xl font-bold text-gray-900 theme-fx-logo">Transactions</h1>

      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Rechercher..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" value={accountId} onChange={e => { setAccountId(e.target.value); setPage(1) }}>
          <option value="">Tous les comptes</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" value={categoryId} onChange={e => { setCategoryId(e.target.value); setPage(1) }}>
          <option value="">Toutes catégories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={isCredit} onChange={e => { setIsCredit(e.target.value); setPage(1) }}>
          <option value="">Tous</option>
          <option value="true">Crédits</option>
          <option value="false">Débits</option>
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={year} onChange={e => { setYear(e.target.value); setPage(1) }}>
          <option value="">Toutes années</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={month} onChange={e => { setMonth(e.target.value); setPage(1) }}>
          <option value="">Tous mois</option>
          {months.map(([v, l]) => <option key={v} value={+v}>{l}</option>)}
        </select>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showInternal} onChange={e => { setShowInternal(e.target.checked); setPage(1) }} className="rounded" />
          Virements internes
        </label>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-gray-400">Chargement...</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contrepartie</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Catégorie</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data?.items.map(tx => (
                  <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{tx.date}</td>
                    <td className="px-4 py-3 text-gray-800 max-w-xs">
                      <p className="truncate">{tx.description ?? '—'}</p>
                      {tx.is_internal && <span className="text-xs text-blue-400">virement interne</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[160px]">
                      <p className="truncate">{tx.counterparty ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === tx.id ? (
                        <select
                          autoFocus
                          className="text-xs border border-gray-200 rounded px-2 py-1"
                          defaultValue={tx.category_id ?? ''}
                          onBlur={e => handleCategoryChange(tx.id, e.target.value)}
                          onChange={e => handleCategoryChange(tx.id, e.target.value)}
                        >
                          <option value="">—</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                        </select>
                      ) : (
                        <button onClick={() => setEditingId(tx.id)} className="hover:opacity-80 transition-opacity">
                          <CategoryBadge name={tx.category_name} color={tx.category_color} icon={tx.category_icon} />
                        </button>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${tx.is_credit ? 'text-green-600' : 'text-gray-800'}`}>
                      {tx.is_credit ? '+' : '-'}{fmt(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
              <span>{data?.total ?? 0} transactions</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-40">
                  <ChevronLeft size={16} />
                </button>
                <span>Page {page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 rounded hover:bg-gray-100 disabled:opacity-40">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
