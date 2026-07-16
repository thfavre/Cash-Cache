import { useEffect, useState, useCallback, useRef } from 'react'
import { api, Transaction, Category, Account } from '../api'
import CategoryBadge from '../components/CategoryBadge'
import { Search } from 'lucide-react'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

const PER_PAGE = 50
const NO_CATEGORY = '__none__'

export default function Transactions() {
  const [items, setItems] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [search, setSearch] = useState('')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isCredit, setIsCredit] = useState('')
  const [showInternal, setShowInternal] = useState(false)
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')

  // For inline category editing
  const [editingId, setEditingId] = useState<number | null>(null)

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)  // synchronous guard against duplicate fetches from a single observer burst

  const filterParams = {
    search: search || undefined,
    account_id: accountId ? +accountId : undefined,
    category_id: categoryId && categoryId !== NO_CATEGORY ? +categoryId : undefined,
    uncategorized_only: categoryId === NO_CATEGORY ? true : undefined,
    is_credit: isCredit === '' ? undefined : isCredit === 'true',
    is_internal: showInternal ? undefined : false,
    year: year ? +year : undefined,
    month: month ? +month : undefined,
    min_amount: minAmount !== '' ? +minAmount : undefined,
    max_amount: maxAmount !== '' ? +maxAmount : undefined,
  }
  const filterKey = JSON.stringify(filterParams)

  // Filters changed: reset to page 1 and replace the list.
  useEffect(() => {
    let cancelled = false
    setInitialLoading(true)
    api.transactions({ ...filterParams, page: 1, per_page: PER_PAGE }).then(result => {
      if (cancelled) return
      setItems(result.items)
      setTotal(result.total)
      setPage(1)
      setInitialLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])

  useEffect(() => {
    api.categories().then(setCategories)
    api.accounts().then(setAccounts)
  }, [])

  const hasMore = items.length < total

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || initialLoading) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const result = await api.transactions({ ...filterParams, page: nextPage, per_page: PER_PAGE })
      setItems(prev => [...prev, ...result.items])
      setTotal(result.total)
      setPage(nextPage)
    } finally {
      setLoadingMore(false)
      loadingMoreRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, hasMore, initialLoading, filterKey])

  // Prefetch the next page well before the sentinel actually reaches the
  // viewport (rootMargin) so new rows are already appended by the time the
  // user scrolls there — no visible loading pause mid-scroll.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '800px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  async function handleCategoryChange(txId: number, catId: string) {
    await api.updateTransactionCategory(txId, catId ? +catId : null)
    setEditingId(null)
    setItems(prev => prev.map(tx => tx.id !== txId ? tx : {
      ...tx,
      category_id: catId ? +catId : null,
      category_name: catId ? categories.find(c => c.id === +catId)?.name ?? null : null,
      category_color: catId ? categories.find(c => c.id === +catId)?.color ?? null : null,
      category_icon: catId ? categories.find(c => c.id === +catId)?.icon ?? null : null,
    }))
  }

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
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" value={accountId} onChange={e => setAccountId(e.target.value)}>
          <option value="">Tous les comptes</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="">Toutes catégories</option>
          <option value={NO_CATEGORY}>Aucune catégorie</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={isCredit} onChange={e => setIsCredit(e.target.value)}>
          <option value="">Tous</option>
          <option value="true">Crédits</option>
          <option value="false">Débits</option>
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={year} onChange={e => setYear(e.target.value)}>
          <option value="">Toutes années</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <select className="text-sm border border-gray-200 rounded-lg px-3 py-2" value={month} onChange={e => setMonth(e.target.value)}>
          <option value="">Tous mois</option>
          {months.map(([v, l]) => <option key={v} value={+v}>{l}</option>)}
        </select>

        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="decimal"
            placeholder="Min CHF"
            value={minAmount}
            onChange={e => setMinAmount(e.target.value)}
            className="w-24 text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-300">–</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Max CHF"
            value={maxAmount}
            onChange={e => setMaxAmount(e.target.value)}
            className="w-24 text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showInternal} onChange={e => setShowInternal(e.target.checked)} className="rounded" />
          Virements internes
        </label>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {initialLoading ? (
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
                {items.map(tx => (
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

            {items.length === 0 && (
              <div className="text-center py-16 text-gray-400">Aucune transaction ne correspond à ces filtres.</div>
            )}

            {/* Infinite scroll sentinel — invisible, triggers the next page
                well before it's reached so rows appear without a visible pause. */}
            {hasMore && <div ref={sentinelRef} className="h-px" />}

            <div className="flex items-center justify-center px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
              {items.length} / {total} transactions{loadingMore ? ' · chargement…' : ''}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
