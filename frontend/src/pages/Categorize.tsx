import { useEffect, useState, useCallback, useRef } from 'react'
import { api, Transaction, Category } from '../api'
import { Plus, Pencil, Trash2, X, Check, Tag } from 'lucide-react'
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
interface RulePrompt { txId: number; catId: number; catName: string; catColor: string; suggestion: string }
interface CatForm { name: string; color: string; icon: string; rules: string[] }

const EMPTY_FORM: CatForm = { name: '', color: '#3B82F6', icon: '❓', rules: [] }

// ═══════════════════════════════════════════════════════════════════════════
export default function Categorize() {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  // interaction state
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [hoveredCat, setHoveredCat] = useState<number | null>(null)
  const [rulePrompt, setRulePrompt] = useState<RulePrompt | null>(null)
  const [ruleInput, setRuleInput] = useState('')
  const [ruleStatus, setRuleStatus] = useState<string | null>(null)

  // category management
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState<CatForm>(EMPTY_FORM)
  const [ruleTag, setRuleTag] = useState('')

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

  // ── Assign a transaction to a category ───────────────────────────────
  async function assign(txId: number, catId: number) {
    await api.updateTransactionCategory(txId, catId)
    const tx = txs.find(t => t.id === txId)
    const cat = categories.find(c => c.id === catId)
    if (tx && cat) {
      const suggestion = suggestRule(tx)
      setRulePrompt({ txId, catId, catName: cat.name, catColor: cat.color, suggestion })
      setRuleInput(suggestion)
      setRuleStatus(null)
    }
    setSelectedId(null)
    loadTxs()
  }

  // ── Drop handler ──────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent, catId: number) {
    e.preventDefault()
    const txId = +e.dataTransfer.getData('tx_id')
    if (txId) assign(txId, catId)
    setHoveredCat(null)
    setDraggingId(null)
  }

  // ── Click-to-assign: click tx → select, click category → assign ───────
  function handleCatClick(catId: number) {
    if (selectedId !== null) {
      assign(selectedId, catId)
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
    setRuleStatus(`✓ Règle ajoutée — ${result.updated} transaction(s) recatégorisée(s)`)
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
    setCatForm({ name: cat.name, color: cat.color, icon: cat.icon, rules: [...cat.rules] })
    setRuleTag('')
    setEditingCat(cat)
    setShowNewForm(false)
  }

  async function saveCategory() {
    if (!catForm.name.trim()) return
    if (editingCat) {
      await api.updateCategory(editingCat.id, catForm)
    } else {
      await api.createCategory(catForm as any)
    }
    setShowNewForm(false)
    setEditingCat(null)
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
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center py-20 text-gray-400">Chargement...</div>
          ) : txs.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-4xl mb-3">🎉</p>
              <p className="text-gray-600 font-medium">Toutes les transactions sont catégorisées !</p>
            </div>
          ) : (
            txs.map(tx => (
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

        {/* Right: Categories panel */}
        <div className="w-72 shrink-0 border-l border-gray-100 bg-gray-50 overflow-y-auto p-4 space-y-3">

          {/* Hint */}
          {selectedId !== null && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700 text-center">
              Transaction sélectionnée — cliquez une catégorie pour l'assigner
            </div>
          )}
          {selectedId === null && draggingId === null && (
            <p className="text-xs text-gray-400 text-center pb-1">
              Glissez ou sélectionnez une transaction puis cliquez une catégorie
            </p>
          )}

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
          {categories.map(cat => (
            <CategoryDropCard
              key={cat.id}
              cat={cat}
              isHovered={hoveredCat === cat.id}
              isSelectionMode={selectedId !== null}
              onClick={() => handleCatClick(cat.id)}
              onDragOver={(e) => { e.preventDefault(); setHoveredCat(cat.id) }}
              onDragLeave={() => setHoveredCat(null)}
              onDrop={(e) => onDrop(e, cat.id)}
              onEdit={() => openEditForm(cat)}
              onDelete={() => deleteCategory(cat)}
            />
          ))}
        </div>
      </div>

      {/* ── Rule prompt toast ────────────────────────────────────────── */}
      {rulePrompt && (
        <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4">
          {ruleStatus ? (
            <p className="text-sm text-green-600 font-medium text-center">{ruleStatus}</p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <Tag size={16} className="text-gray-400 shrink-0" />
              <p className="text-sm text-gray-700 shrink-0">
                Ajouter une règle pour
                <span className="font-semibold" style={{ color: rulePrompt.catColor }}>
                  {' '}{rulePrompt.catName}
                </span>
                {' '}?
              </p>
              <input
                className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={ruleInput}
                onChange={e => setRuleInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddRule()}
                placeholder="Mot-clé à reconnaître..."
                autoFocus
              />
              <button
                onClick={handleAddRule}
                disabled={!ruleInput.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                Ajouter + recatégoriser
              </button>
              <button
                onClick={() => setRulePrompt(null)}
                className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors"
              >
                Ignorer
              </button>
            </div>
          )}
        </div>
      )}
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
      onDragStart={(e) => { e.dataTransfer.setData('tx_id', String(tx.id)); onDragStart() }}
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
      className={clsx(
        'rounded-xl border-2 p-3 transition-all',
        isHovered
          ? 'border-opacity-100 shadow-lg scale-[1.02]'
          : isSelectionMode
          ? 'border-dashed cursor-pointer hover:scale-[1.01]'
          : 'border-transparent cursor-default',
      )}
      style={{
        borderColor: isHovered ? cat.color : isSelectionMode ? cat.color + '88' : 'transparent',
        background: isHovered ? cat.color + '18' : 'white',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
          style={{ background: cat.color + '22' }}
        >
          {cat.icon}
        </span>
        <span className="flex-1 text-sm font-medium text-gray-800 truncate">{cat.name}</span>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {cat.rules.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 ml-10">
          {cat.rules.slice(0, 3).map(r => (
            <span key={r} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
              {r}
            </span>
          ))}
          {cat.rules.length > 3 && (
            <span className="text-xs text-gray-400">+{cat.rules.length - 3}</span>
          )}
        </div>
      )}
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
