import { useEffect, useState, useCallback, useRef } from 'react'
import { api, Transaction, Category, HistoryEntry } from '../api'
import { Plus, Pencil, Trash2, X, Check, Tag, Search, ArrowUpDown, Layers, ChevronDown, ChevronUp, History, Undo2, PiggyBank, Ban } from 'lucide-react'
import clsx from 'clsx'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

// ── Color + icon palettes ──────────────────────────────────────────────────
const COLORS = [
  '#22C55E', '#F97316', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899',
  '#14B8A6', '#6366F1', '#F59E0B', '#10B981', '#6B7280', '#1D4ED8',
  '#E11D48', '#0891B2', '#7C3AED', '#D97706',
]
const ICONS = [
  '💼','🛒','🚆','🍽️','🍺','🛍️','🏥','📱','🎮','📈',
  '🏛️','🛡️','🏠','🔄','❓','✈️','🎵','📚','🚗','☕',
  '💊','🎭','💳','🏋️','🍕','🎬','🌍','⚽',
  '🚫','🎁','🐾','🧾','🔧','👶','✨',
]

// ── Keyword suggestion from a transaction ──────────────────────────────────
function suggestRule(tx: Transaction): string {
  if (tx.counterparty && tx.counterparty.length > 2)
    return tx.counterparty.split(',')[0].split('/')[0].trim().slice(0, 40)
  if (!tx.description) return ''
  return tx.description
    .replace(/^Achat TWINT,\s*/i, '')
    .replace(/^Transfert TWINT [àa]\s*/i, '')
    .replace(/^Crédit TWINT de\s*/i, '')
    .replace(/^E-banking Ordre [àa]\s*/i, '')
    .replace(/^Crédit\s*/i, '')
    .replace(/^Paiement\s*/i, '')
    .split(',')[0]
    .split(/\s+\d{2}\.\d{2}\./).shift()
    ?.trim().slice(0, 40) ?? ''
}

// ── Types ──────────────────────────────────────────────────────────────────
interface RulePrompt { txId: number; catId: number; catName: string; catColor: string; suggestion: string; historyId: number | null }
interface CatForm { name: string; color: string; icon: string; rules: string[]; is_savings: boolean; is_ignored: boolean }

const EMPTY_FORM: CatForm = { name: '', color: '#3B82F6', icon: '❓', rules: [], is_savings: false, is_ignored: false }

type CatSort = 'name' | 'tags'
type TxSort = 'date' | 'amount' | 'frequency'

function txFreqKey(tx: Transaction): string {
  return (tx.counterparty || tx.description || '').trim().toLowerCase()
}

interface TxGroup {
  key: string
  label: string
  items: Transaction[]
  total: number
  mostRecent: string
}

// ═══════════════════════════════════════════════════════════════════════════
export default function Categorize() {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // interaction state
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null)
  const [hoveredCat, setHoveredCat] = useState<number | null>(null)
  const [rulePrompt, setRulePrompt] = useState<RulePrompt | null>(null)
  const [ruleInput, setRuleInput] = useState('')
  const [ruleStatus, setRuleStatus] = useState<string | null>(null)

  // category management
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState<CatForm>(EMPTY_FORM)
  const [ruleTag, setRuleTag] = useState('')
  const [catSearch, setCatSearch] = useState('')
  const [txSearch, setTxSearch] = useState('')
  const [catSort, setCatSort] = useState<CatSort>('tags')
  const [txSort, setTxSort] = useState<TxSort>('date')

  // ── Data loading ──────────────────────────────────────────────────────
  const loadTxs = useCallback(async () => {
    setLoading(true)
    const result = await api.transactions({
      per_page: 2000,
      is_internal: false,
      is_credit: showAll ? undefined : false,
      uncategorized_only: showAll ? undefined : true,
    })
    setTxs(result.items)
    setTotal(result.total)
    setLoading(false)
  }, [showAll])

  useEffect(() => { loadTxs(); api.categories().then(setCategories) }, [loadTxs])

  function loadHistory() {
    api.history().then(setHistory)
  }

  async function handleRevert(id: number) {
    await api.revertHistory(id)
    loadHistory()
    api.categories().then(setCategories)
    loadTxs()
  }

  // ── Assign one or more transactions to a category ─────────────────────
  async function assign(txIds: number[], catId: number) {
    if (txIds.length === 0) return
    const result = await api.updateTransactionsCategory(txIds, catId)
    const tx = txs.find(t => txIds.includes(t.id))
    const cat = categories.find(c => c.id === catId)
    if (tx && cat) {
      const suggestion = suggestRule(tx)
      setRulePrompt({ txId: tx.id, catId, catName: cat.name, catColor: cat.color, suggestion, historyId: result.history_id })
      setRuleInput(suggestion)
      setRuleStatus(null)
    }
    setSelectedId(null)
    setSelectedGroupKey(null)
    loadTxs()
  }

  // ── Undo the assignment that triggered the rule prompt ─────────────────
  async function handleCancelAssign() {
    if (rulePrompt?.historyId != null) {
      await api.revertHistory(rulePrompt.historyId)
      loadHistory()
      loadTxs()
    }
    setRulePrompt(null)
  }

  // ── Drop handler ──────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent, catId: number) {
    e.preventDefault()
    const raw = e.dataTransfer.getData('tx_ids')
    if (raw) {
      const ids: number[] = JSON.parse(raw)
      assign(ids, catId)
    }
    setHoveredCat(null)
    setDraggingId(null)
    setDraggingGroupKey(null)
  }

  // ── Click-to-assign: click tx/group → select, click category → assign ─
  function handleCatClick(catId: number) {
    if (selectedId !== null) {
      assign([selectedId], catId)
    } else if (selectedGroupKey !== null) {
      const group = txGroups.find(g => g.key === selectedGroupKey)
      if (group) assign(group.items.map(t => t.id), catId)
    }
  }

  // ── Rule prompt ───────────────────────────────────────────────────────
  async function handleAddRule() {
    if (!rulePrompt || !ruleInput.trim()) return
    const cat = categories.find(c => c.id === rulePrompt.catId)
    if (!cat) return
    const updatedRules = [...(cat.rules ?? []), ruleInput.trim()]
    await api.updateCategory(rulePrompt.catId, { rules: updatedRules })
    const result = await api.recategorize(rulePrompt.catId)
    setRuleStatus(
      result.updated === 0
        ? '✓ Règle ajoutée — aucune autre transaction concernée'
        : result.updated === 1
        ? `✓ Règle ajoutée — 1 autre transaction recatégorisée`
        : `✓ Règle ajoutée — ${result.updated} autres transactions recatégorisées`
    )
    api.categories().then(setCategories)
    loadTxs()
    setTimeout(() => { setRulePrompt(null); setRuleStatus(null) }, 2500)
  }

  // ── Category CRUD ─────────────────────────────────────────────────────
  function openNewForm() {
    setCatForm(EMPTY_FORM)
    setRuleTag('')
    setShowNewForm(true)
    setEditingCat(null)
  }

  function openEditForm(cat: Category) {
    setCatForm({ name: cat.name, color: cat.color, icon: cat.icon, rules: [...cat.rules], is_savings: cat.is_savings, is_ignored: cat.is_ignored })
    setRuleTag('')
    setEditingCat(cat)
    setShowNewForm(false)
  }

  async function saveCategory() {
    if (!catForm.name.trim()) return
    // Commit whatever keyword is still typed in the "add tag" box so
    // pressing Enregistrer directly doesn't silently drop it.
    const pending = ruleTag.trim()
    const rules = pending && !catForm.rules.includes(pending) ? [...catForm.rules, pending] : catForm.rules
    const formToSave = { ...catForm, rules }
    if (editingCat) {
      await api.updateCategory(editingCat.id, formToSave)
      await api.recategorize(editingCat.id)
      loadTxs()
    } else {
      await api.createCategory(formToSave as any)
    }
    setShowNewForm(false)
    setEditingCat(null)
    setRuleTag('')
    api.categories().then(setCategories)
  }

  async function deleteCategory(cat: Category) {
    if (!confirm(`Supprimer la catégorie "${cat.name}" ?`)) return
    await api.deleteCategory(cat.id)
    api.categories().then(setCategories)
    loadTxs()
  }

  function addRuleTag() {
    const t = ruleTag.trim()
    if (t && !catForm.rules.includes(t)) {
      setCatForm(f => ({ ...f, rules: [...f.rules, t] }))
    }
    setRuleTag('')
  }

  const uncatCount = txs.length

  const filteredTxs = (() => {
    const q = txSearch.trim().toLowerCase()
    const base = !q ? txs : txs.filter(tx =>
      (tx.description ?? '').toLowerCase().includes(q) ||
      (tx.counterparty ?? '').toLowerCase().includes(q)
    )
    const sorted = [...base]
    if (txSort === 'amount') {
      sorted.sort((a, b) => b.amount - a.amount)
    } else {
      sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    }
    return sorted
  })()

  const txGroups: TxGroup[] = (() => {
    const map = new Map<string, Transaction[]>()
    for (const tx of filteredTxs) {
      const key = txFreqKey(tx)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tx)
    }
    const groups = Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: suggestRule(items[0]) || items[0].description || items[0].counterparty || '—',
      items,
      total: items.reduce((s, t) => s + t.amount, 0),
      mostRecent: items.reduce((d, t) => (t.date > d ? t.date : d), items[0].date),
    }))
    groups.sort((a, b) => b.items.length - a.items.length || b.total - a.total)
    return groups
  })()

  const filteredCategories = (() => {
    const q = catSearch.trim().toLowerCase()
    const base = !q ? categories : categories.filter(cat =>
      cat.name.toLowerCase().includes(q) ||
      cat.rules.some(r => r.toLowerCase().includes(q))
    )
    const sorted = [...base]
    if (catSort === 'tags') {
      sorted.sort((a, b) => b.rules.length - a.rules.length)
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    }
    return sorted
  })()

  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Catégoriser</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {showAll
              ? `${total} transactions au total`
              : `${uncatCount} transactions non catégorisées`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowHistory(true); loadHistory() }}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <History size={15} /> Historique
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={e => setShowAll(e.target.checked)}
              className="rounded"
            />
            Tout afficher
          </label>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Transaction list */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-4 pb-2 shrink-0 flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={txSearch}
                onChange={e => setTxSearch(e.target.value)}
                placeholder="Rechercher une transaction (description, tiers)..."
                className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {txSearch && (
                <button
                  onClick={() => setTxSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="relative shrink-0">
              <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <select
                value={txSort}
                onChange={e => setTxSort(e.target.value as TxSort)}
                className="text-sm border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700 appearance-none"
              >
                <option value="date">Plus récent</option>
                <option value="amount">Plus cher</option>
                <option value="frequency">Plus fréquent</option>
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
            {loading ? (
              <div className="text-center py-20 text-gray-400">Chargement...</div>
            ) : txs.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-4xl mb-3">🎉</p>
                <p className="text-gray-600 font-medium">Toutes les transactions sont catégorisées !</p>
              </div>
            ) : filteredTxs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-20">Aucune transaction ne correspond à "{txSearch}"</p>
            ) : txSort === 'frequency' ? (
              txGroups.map(group => (
                <TxGroupCard
                  key={group.key}
                  group={group}
                  selected={selectedGroupKey === group.key}
                  dragging={draggingGroupKey === group.key}
                  onClick={() => setSelectedGroupKey(k => k === group.key ? null : group.key)}
                  onDragStart={() => setDraggingGroupKey(group.key)}
                  onDragEnd={() => setDraggingGroupKey(null)}
                />
              ))
            ) : (
              filteredTxs.map(tx => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  selected={selectedId === tx.id}
                  dragging={draggingId === tx.id}
                  onClick={() => setSelectedId(id => id === tx.id ? null : tx.id)}
                  onDragStart={() => setDraggingId(tx.id)}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Categories panel */}
        <div className="w-96 shrink-0 border-l border-gray-100 bg-gray-50 overflow-y-auto p-4 space-y-3">

          {/* Hint */}
          {selectedId !== null && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700 text-center">
              Transaction sélectionnée — cliquez une catégorie pour l'assigner
            </div>
          )}
          {selectedGroupKey !== null && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700 text-center">
              Groupe sélectionné ({txGroups.find(g => g.key === selectedGroupKey)?.items.length ?? 0} transactions) — cliquez une catégorie pour les assigner
            </div>
          )}
          {selectedId === null && selectedGroupKey === null && draggingId === null && draggingGroupKey === null && (
            <p className="text-xs text-gray-400 text-center pb-1">
              Glissez ou sélectionnez une transaction puis cliquez une catégorie
            </p>
          )}

          {/* Search + sort */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={catSearch}
                onChange={e => setCatSearch(e.target.value)}
                placeholder="Rechercher une catégorie ou un mot-clé..."
                className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {catSearch && (
                <button
                  onClick={() => setCatSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="relative shrink-0">
              <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <select
                value={catSort}
                onChange={e => setCatSort(e.target.value as CatSort)}
                className="text-sm border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700 appearance-none"
              >
                <option value="name">A-Z</option>
                <option value="tags">Nb de mots-clés</option>
              </select>
            </div>
          </div>

          {/* New category button */}
          <button
            onClick={openNewForm}
            className="flex items-center gap-2 w-full px-3 py-2 border-2 border-dashed border-gray-300 text-gray-500 text-sm rounded-xl hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            <Plus size={15} /> Nouvelle catégorie
          </button>

          {/* New / Edit form */}
          {(showNewForm || editingCat) && (
            <CategoryForm
              form={catForm}
              ruleTag={ruleTag}
              onChange={setCatForm}
              onRuleTagChange={setRuleTag}
              onAddRuleTag={addRuleTag}
              onRemoveRule={(r) => setCatForm(f => ({ ...f, rules: f.rules.filter(x => x !== r) }))}
              onSave={saveCategory}
              onCancel={() => { setShowNewForm(false); setEditingCat(null) }}
              title={editingCat ? `Modifier "${editingCat.name}"` : 'Nouvelle catégorie'}
            />
          )}

          {/* Category drop-zone cards */}
          {filteredCategories.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Aucune catégorie ne correspond à "{catSearch}"</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filteredCategories.map(cat => (
                <CategoryDropCard
                  key={cat.id}
                  cat={cat}
                  isHovered={hoveredCat === cat.id}
                  isSelectionMode={selectedId !== null || selectedGroupKey !== null}
                  onClick={() => handleCatClick(cat.id)}
                  onDragOver={(e) => { e.preventDefault(); setHoveredCat(cat.id) }}
                  onDragLeave={() => setHoveredCat(null)}
                  onDrop={(e) => onDrop(e, cat.id)}
                  onEdit={() => openEditForm(cat)}
                  onDelete={() => deleteCategory(cat)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Rule prompt (floating, hard to miss) ────────────────────────── */}
      {rulePrompt && (
        <RulePromptToast
          rulePrompt={rulePrompt}
          ruleInput={ruleInput}
          ruleStatus={ruleStatus}
          onInputChange={setRuleInput}
          onAdd={handleAddRule}
          onDismiss={() => setRulePrompt(null)}
          onCancel={handleCancelAssign}
        />
      )}

      {/* ── History panel ───────────────────────────────────────────────── */}
      {showHistory && (
        <HistoryPanel
          entries={history}
          onRevert={handleRevert}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}

function RulePromptToast({
  rulePrompt, ruleInput, ruleStatus, onInputChange, onAdd, onDismiss, onCancel,
}: {
  rulePrompt: RulePrompt
  ruleInput: string
  ruleStatus: string | null
  onInputChange: (v: string) => void
  onAdd: () => void
  onDismiss: () => void
  onCancel: () => void
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex justify-center px-4 bg-black/30 transition-opacity duration-300 ease-out',
        ruleStatus ? 'items-end pb-8' : 'items-center',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onClick={onDismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={clsx(
          'w-full max-w-xl bg-white rounded-2xl shadow-2xl border-2 p-4 transition-all duration-300 ease-out',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        )}
        style={{ borderColor: rulePrompt.catColor }}
      >
        {ruleStatus ? (
          <p className="text-sm text-green-600 font-semibold text-center py-1">{ruleStatus}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                style={{ background: rulePrompt.catColor + '22' }}
              >
                <Tag size={15} style={{ color: rulePrompt.catColor }} />
              </span>
              <p className="text-sm text-gray-700">
                Assignée à
                <span className="font-semibold" style={{ color: rulePrompt.catColor }}>
                  {' '}{rulePrompt.catName}
                </span>
                {' '}— ajouter une règle pour reconnaître ce genre de transaction automatiquement ?
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={ruleInput}
                onChange={e => onInputChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onAdd()}
                placeholder="Mot-clé à reconnaître..."
                autoFocus
              />
              <button
                onClick={onAdd}
                disabled={!ruleInput.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                Ajouter + recatégoriser
              </button>
              <button
                onClick={onDismiss}
                className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors"
              >
                Non, juste cette fois
              </button>
              <button
                onClick={onCancel}
                className="px-3 py-1.5 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 transition-colors"
              >
                Annuler l'assignation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


function HistoryPanel({
  entries, onRevert, onClose,
}: {
  entries: HistoryEntry[]
  onRevert: (id: number) => void
  onClose: () => void
}) {
  const fmtDate = (iso: string) =>
    new Date(iso + 'Z').toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/30" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[70vh] bg-white rounded-2xl shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <History size={16} className="text-gray-400" /> Historique des catégorisations
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">Aucune action enregistrée pour l'instant.</p>
          ) : (
            entries.map(entry => (
              <div
                key={entry.id}
                className={clsx(
                  'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
                  entry.reverted ? 'border-gray-100 bg-gray-50' : 'border-gray-200',
                )}
              >
                <div className="min-w-0">
                  <p className={clsx('text-sm', entry.reverted ? 'text-gray-400 line-through' : 'text-gray-700')}>
                    {entry.summary}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtDate(entry.created_at)}</p>
                </div>
                {entry.reverted ? (
                  <span className="text-xs text-gray-400 shrink-0">Annulé</span>
                ) : (
                  <button
                    onClick={() => onRevert(entry.id)}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-blue-600 hover:bg-blue-50 shrink-0 transition-colors"
                  >
                    <Undo2 size={12} /> Annuler
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function TxCard({
  tx, selected, dragging,
  onClick, onDragStart, onDragEnd,
}: {
  tx: Transaction
  selected: boolean
  dragging: boolean
  onClick: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('tx_ids', JSON.stringify([tx.id])); onDragStart() }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={clsx(
        'bg-white rounded-xl border-2 p-3 cursor-grab active:cursor-grabbing select-none transition-all',
        selected ? 'border-blue-400 shadow-md shadow-blue-100' : 'border-gray-100 hover:border-gray-300',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate leading-tight">
            {tx.description ?? tx.counterparty ?? '—'}
          </p>
          {tx.counterparty && tx.counterparty !== tx.description && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{tx.counterparty}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">{tx.date}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={clsx('text-sm font-bold', tx.is_credit ? 'text-green-600' : 'text-gray-800')}>
            {tx.is_credit ? '+' : '-'}{fmt(tx.amount)}
          </p>
          {tx.category_name && (
            <span
              className="inline-block text-xs px-1.5 py-0.5 rounded-full mt-1"
              style={{ background: `${tx.category_color}22`, color: tx.category_color ?? '#6B7280' }}
            >
              {tx.category_icon} {tx.category_name}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}


function TxGroupCard({
  group, selected, dragging,
  onClick, onDragStart, onDragEnd,
}: {
  group: TxGroup
  selected: boolean
  dragging: boolean
  onClick: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const ids = group.items.map(t => t.id)
  const allCredit = group.items.every(t => t.is_credit)
  const sortedItems = [...group.items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('tx_ids', JSON.stringify(ids)); onDragStart() }}
      onDragEnd={onDragEnd}
      className={clsx(
        'bg-white rounded-xl border-2 select-none transition-all',
        selected ? 'border-blue-400 shadow-md shadow-blue-100' : 'border-gray-100 hover:border-gray-300',
        dragging && 'opacity-40',
      )}
    >
      <div onClick={onClick} className="flex items-start gap-3 p-3 cursor-grab active:cursor-grabbing">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Layers size={13} className="text-gray-400 shrink-0" />
            <p className="text-sm font-medium text-gray-800 truncate leading-tight">
              {group.label}
            </p>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {group.items.length} transactions · dernière le {group.mostRecent}
          </p>
        </div>
        <div className="text-right shrink-0 flex items-start gap-2">
          <div>
            <p className={clsx('text-sm font-bold', allCredit ? 'text-green-600' : 'text-gray-800')}>
              {allCredit ? '+' : ''}{fmt(group.total)}
            </p>
            <span className="inline-block text-xs px-1.5 py-0.5 rounded-full mt-1 bg-blue-50 text-blue-600">
              ×{group.items.length}
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
            title="Voir le détail des transactions"
            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1.5 max-h-64 overflow-y-auto">
          {sortedItems.map(tx => (
            <div key={tx.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-500 truncate">{tx.date}</span>
              <span className="text-gray-700 truncate flex-1">{tx.description ?? tx.counterparty ?? '—'}</span>
              <span className={clsx('font-medium shrink-0', tx.is_credit ? 'text-green-600' : 'text-gray-700')}>
                {tx.is_credit ? '+' : '-'}{fmt(tx.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function CategoryDropCard({
  cat, isHovered, isSelectionMode,
  onClick, onDragOver, onDragLeave, onDrop, onEdit, onDelete,
}: {
  cat: Category
  isHovered: boolean
  isSelectionMode: boolean
  onClick: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      title={cat.rules.length > 0 ? cat.rules.join(', ') : undefined}
      className={clsx(
        'group relative rounded-xl border-2 px-2.5 py-2 transition-all',
        isHovered
          ? 'shadow-lg scale-[1.03] z-10'
          : isSelectionMode
          ? 'border-dashed cursor-pointer hover:scale-[1.02] hover:shadow-md'
          : 'border-transparent cursor-default hover:bg-gray-100',
      )}
      style={{
        borderColor: isHovered ? cat.color : isSelectionMode ? cat.color + '88' : 'transparent',
        background: isHovered ? cat.color + '18' : 'white',
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center text-base shrink-0"
          style={{ background: cat.color + '22' }}
        >
          {cat.icon}
        </span>
        <span className="flex-1 text-xs font-medium text-gray-800 truncate leading-tight">{cat.name}</span>
        {cat.is_savings && (
          <span title="Flux d'épargne / investissement" className="shrink-0 text-emerald-500">
            <PiggyBank size={12} />
          </span>
        )}
        {cat.is_ignored && (
          <span title="Ignoré des statistiques" className="shrink-0 text-gray-400">
            <Ban size={12} />
          </span>
        )}
        {cat.rules.length > 0 && (
          <span className="text-[10px] text-gray-400 shrink-0">{cat.rules.length}</span>
        )}
      </div>
      <div className="absolute -top-1.5 -right-1.5 hidden group-hover:flex gap-0.5 bg-white rounded-lg shadow border border-gray-200 p-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}


function CategoryForm({
  form, ruleTag, title,
  onChange, onRuleTagChange, onAddRuleTag, onRemoveRule, onSave, onCancel,
}: {
  form: CatForm
  ruleTag: string
  title: string
  onChange: (f: CatForm) => void
  onRuleTagChange: (v: string) => void
  onAddRuleTag: () => void
  onRemoveRule: (r: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{title}</p>

      {/* Name */}
      <input
        ref={inputRef}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Nom de la catégorie"
        value={form.name}
        onChange={e => onChange({ ...form, name: e.target.value })}
      />

      {/* Color picker */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Couleur</p>
        <div className="grid grid-cols-8 gap-1">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => onChange({ ...form, color: c })}
              className="w-6 h-6 rounded-md transition-transform hover:scale-110"
              style={{
                background: c,
                outline: form.color === c ? `3px solid ${c}` : 'none',
                outlineOffset: '2px',
              }}
            />
          ))}
        </div>
      </div>

      {/* Icon picker */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Icône</p>
        <div className="grid grid-cols-7 gap-1">
          {ICONS.map(ic => (
            <button
              key={ic}
              onClick={() => onChange({ ...form, icon: ic })}
              className={clsx(
                'w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-colors',
                form.icon === ic ? 'bg-blue-100' : 'hover:bg-gray-100',
              )}
            >
              {ic}
            </button>
          ))}
        </div>
      </div>

      {/* Épargne Toggle */}
      <div className="flex items-center justify-between py-2 border-t border-b border-gray-100 my-2">
        <div>
          <p className="text-xs font-semibold text-gray-700">Flux d'Épargne / Investissement</p>
          <p className="text-[10px] text-gray-400">Exclut ces dépenses pour les compter comme de l'épargne (ex: ETF)</p>
        </div>
        <button
          onClick={() => onChange({ ...form, is_savings: !form.is_savings })}
          className={clsx(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
            form.is_savings ? "bg-emerald-500" : "bg-gray-200"
          )}
        >
          <span
            className={clsx(
              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              form.is_savings ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {/* Ignorer Toggle */}
      <div className="flex items-center justify-between py-2 border-b border-gray-100 mb-2">
        <div>
          <p className="text-xs font-semibold text-gray-700">Ignorer des statistiques</p>
          <p className="text-[10px] text-gray-400">Exclut ces transactions des totaux (ex: virements entre vos propres comptes)</p>
        </div>
        <button
          onClick={() => onChange({ ...form, is_ignored: !form.is_ignored })}
          className={clsx(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
            form.is_ignored ? "bg-gray-500" : "bg-gray-200"
          )}
        >
          <span
            className={clsx(
              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              form.is_ignored ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {/* Rules */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Mots-clés de reconnaissance</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {form.rules.map(r => (
            <span key={r} className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
              {r}
              <button onClick={() => onRemoveRule(r)} className="text-gray-400 hover:text-red-500">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Ajouter un mot-clé..."
            value={ruleTag}
            onChange={e => onRuleTagChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), onAddRuleTag())}
          />
          <button onClick={onAddRuleTag} className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={!form.name.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          <Check size={14} /> Enregistrer
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}
