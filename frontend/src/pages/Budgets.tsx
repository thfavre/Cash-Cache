import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, Budget, BudgetDetail, BudgetInput, BudgetPeriodType, BudgetTargetType, Category } from '../api'
import { Plus, Pencil, Trash2, AlertTriangle, TriangleAlert, Repeat, CalendarClock, ChevronRight, ChevronLeft, RotateCcw } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import clsx from 'clsx'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

const PERIOD_LABELS: Record<BudgetPeriodType, string> = {
  daily: 'Jour',
  weekly: 'Semaine',
  monthly: 'Mois',
  annual: 'Année',
  custom: 'Personnalisé',
}

function dateLabel(d: string) {
  const date = new Date(d)
  const includeYear = date.getFullYear() !== new Date().getFullYear()
  return date.toLocaleDateString('fr-CH', { day: '2-digit', month: 'short', ...(includeYear ? { year: 'numeric' } : {}) })
}

function periodLabel(b: Budget) {
  if (b.period_type === 'monthly') {
    const date = new Date(b.period_start)
    const includeYear = date.getFullYear() !== new Date().getFullYear()
    return date.toLocaleDateString('fr-CH', { month: 'long', ...(includeYear ? { year: 'numeric' } : {}) })
  }
  return `${dateLabel(b.period_start)} – ${dateLabel(b.period_end)}`
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function firstOfLastMonthIso() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function firstOfThisMonthIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function firstOfThisYearIso() {
  return `${new Date().getFullYear()}-01-01`
}

function startOfThisWeekIso() {
  const d = new Date()
  const day = d.getDay() // 0=Sunday..6=Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diffToMonday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The alternate anchor date offered by the toggle button, and its label,
// depend on the selected period type — there's no "1st of the period" concept
// for daily/custom periods, so the toggle collapses to "today" only there.
function periodAnchor(periodType: BudgetPeriodType): { value: string; label: string } | null {
  if (periodType === 'monthly') return { value: firstOfThisMonthIso(), label: '1er du mois' }
  if (periodType === 'annual') return { value: firstOfThisYearIso(), label: "1er de l'année" }
  if (periodType === 'weekly') return { value: startOfThisWeekIso(), label: 'Début de semaine' }
  return null
}

interface Toast { id: number; message: string; type: 'error' | 'success' }

const emptyForm = (): BudgetInput => ({
  name: '',
  amount_limit: 0,
  period_type: 'monthly',
  period_days: null,
  start_date: firstOfLastMonthIso(),
  recurring: true,
  target_type: 'category',
  category_ids: [],
  merchant_patterns: [],
})

export default function Budgets() {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<BudgetInput>(emptyForm())
  const [deleteTarget, setDeleteTarget] = useState<Budget | null>(null)
  const [detailTarget, setDetailTarget] = useState<Budget | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  function pushToast(message: string, type: Toast['type'] = 'error') {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  useEffect(() => {
    if (!showForm && editId === null && !deleteTarget && !detailTarget) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setShowForm(false)
      setEditId(null)
      setDeleteTarget(null)
      setDetailTarget(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showForm, editId, deleteTarget, detailTarget])

  async function load() {
    setLoading(true)
    try {
      const [b, c] = await Promise.all([api.budgets(), api.categories()])
      setBudgets(b)
      setCategories(c)
    } catch {
      pushToast('Impossible de charger les budgets.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setForm(emptyForm())
    setEditId(null)
    setShowForm(true)
  }

  function openEdit(b: Budget) {
    setForm({
      name: b.name ?? '',
      amount_limit: b.amount_limit,
      period_type: b.period_type,
      period_days: b.period_days,
      start_date: b.start_date,
      recurring: b.recurring,
      target_type: b.target_type,
      category_ids: b.category_ids,
      merchant_patterns: b.merchant_patterns,
    })
    setShowForm(false)
    setEditId(b.id)
  }

  function validateForm(): string | null {
    if (!form.amount_limit || form.amount_limit <= 0) return 'Le montant limite doit être positif.'
    if (form.period_type === 'custom' && !form.period_days) return 'Indiquez un nombre de jours.'
    if (form.target_type === 'category' && form.category_ids.length === 0) return 'Choisissez au moins une catégorie.'
    if (form.target_type === 'merchant' && form.merchant_patterns.filter(p => p.trim()).length === 0)
      return 'Indiquez au moins un événement personnalisé.'
    return null
  }

  async function handleSave() {
    const error = validateForm()
    if (error) { pushToast(error); return }
    const body: BudgetInput = {
      ...form,
      merchant_patterns: form.merchant_patterns.map(p => p.trim()).filter(Boolean),
      name: form.name?.trim() || null,
    }
    try {
      if (editId) await api.updateBudget(editId, body)
      else await api.createBudget(body)
      setShowForm(false)
      setEditId(null)
      load()
    } catch {
      pushToast(editId !== null ? "Impossible de modifier ce budget." : 'Impossible de créer ce budget.')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await api.deleteBudget(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch {
      pushToast('Impossible de supprimer ce budget.')
    }
  }

  const availableCategories = categories.filter(c => c.name !== 'Non catégorisé')

  const sortedBudgets = useMemo(() => {
    const rank = (b: Budget) => (b.percent >= 100 ? 0 : b.projected_over ? 1 : 2)
    return [...budgets].sort((a, b) => rank(a) - rank(b) || b.percent - a.percent)
  }, [budgets])

  const overBudget = budgets.filter(b => b.percent >= 100)
  const total_limit = budgets.reduce((s, b) => s + b.amount_limit, 0)
  const total_spent = budgets.reduce((s, b) => s + b.spent, 0)

  return (
    <div className="p-6 pt-4 space-y-6">
      <p className="text-sm text-gray-500">Limites de dépenses par catégorie ou événement</p>

      {/* Summary */}
      {budgets.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Budget total</p>
            <p className="text-xl font-bold text-blue-600 mt-1">{fmt(total_limit)}</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Dépensé</p>
            <p className="text-xl font-bold text-red-500 mt-1">{fmt(total_spent)}</p>
          </div>
          <div className={clsx('rounded-xl p-4', total_limit - total_spent >= 0 ? 'bg-green-50' : 'bg-red-50')}>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Restant</p>
            <p className={clsx('text-xl font-bold mt-1', total_limit - total_spent >= 0 ? 'text-green-600' : 'text-red-500')}>
              {fmt(total_limit - total_spent)}
            </p>
          </div>
        </div>
      )}

      {overBudget.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
          <p className="text-sm font-medium text-red-700">
            Dépassements : {overBudget.map(b => b.name || b.category_labels[0] || b.merchant_patterns[0]).join(', ')}
          </p>
        </div>
      )}

      {/* Budget cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : sortedBudgets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Aucun budget pour le moment.</div>
      ) : (
        <div className="space-y-3">
          {sortedBudgets.map(b => {
            if (b.id === editId) {
              return (
                <BudgetForm
                  key={b.id}
                  form={form}
                  setForm={setForm}
                  categories={availableCategories}
                  isEdit
                  onSave={handleSave}
                  onCancel={() => setEditId(null)}
                />
              )
            }
            const pct = Math.min(b.percent, 100)
            const color = b.percent < 75 ? 'bg-green-500' : b.percent < 100 ? 'bg-orange-400' : 'bg-red-500'
            const label = b.name || (b.target_type === 'category' ? b.category_labels.join(' + ') : b.merchant_patterns.join(' + '))
            return (
              <div
                key={b.id}
                onClick={() => setDetailTarget(b)}
                title="Voir les détails"
                className="group bg-white border border-gray-100 rounded-xl p-4 cursor-pointer hover:border-blue-200 hover:shadow-sm hover:bg-blue-50/20 transition-all"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{label}</span>
                    <span
                      className="flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full whitespace-nowrap"
                      title={b.recurring ? 'Se renouvelle automatiquement' : 'Événement ponctuel'}
                    >
                      {b.recurring ? <Repeat size={11} /> : <CalendarClock size={11} />}
                      {PERIOD_LABELS[b.period_type]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm text-gray-500">{fmt(b.spent)} / {fmt(b.amount_limit)}</span>
                    <button onClick={e => { e.stopPropagation(); openEdit(b) }} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><Pencil size={14} /></button>
                    <button onClick={e => { e.stopPropagation(); setDeleteTarget(b) }} className="p-1 text-red-400 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                    <ChevronRight size={16} className="text-gray-300 opacity-0 group-hover:opacity-100 -ml-1 transition-opacity" />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <p className="text-xs text-gray-400">{periodLabel(b)}</p>
                  {b.percent >= 100 && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full whitespace-nowrap">Dépassé</span>}
                  {b.percent < 100 && b.projected_over && (
                    <span
                      className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full whitespace-nowrap"
                      title={`Au rythme actuel, vous devriez dépenser environ ${fmt(b.projected_total)} d'ici la fin de la période, soit ${fmt(b.projected_total - b.amount_limit)} de plus que la limite.`}
                    >
                      <TriangleAlert size={11} className="shrink-0" /> +{fmt(b.projected_total - b.amount_limit)} prévus
                    </span>
                  )}
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{b.percent.toFixed(0)}% utilisé</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Add budget */}
      {showForm ? (
        <BudgetForm
          form={form}
          setForm={setForm}
          categories={availableCategories}
          isEdit={false}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-200 text-gray-500 text-sm rounded-xl w-full justify-center hover:border-blue-300 hover:text-blue-500 transition-colors"
        >
          <Plus size={16} /> Ajouter un budget
        </button>
      )}

      {deleteTarget && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/30"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-4"
          >
            <p className="text-sm font-medium text-gray-800">
              Supprimer le budget « {deleteTarget.name || deleteTarget.category_labels.join(' + ') || deleteTarget.merchant_patterns.join(' + ')} » ?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors">
                Annuler
              </button>
              <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors">
                Supprimer
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {detailTarget && (
        <BudgetDetailPanel
          key={detailTarget.id}
          budget={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => { setDetailTarget(null); openEdit(detailTarget) }}
        />
      )}

      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={clsx(
              'px-4 py-2 rounded-lg shadow-lg text-sm text-white',
              t.type === 'error' ? 'bg-red-600' : 'bg-green-600'
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}

function BudgetForm({
  form, setForm, categories, isEdit, onSave, onCancel,
}: {
  form: BudgetInput
  setForm: (f: BudgetInput | ((prev: BudgetInput) => BudgetInput)) => void
  categories: Category[]
  isEdit: boolean
  onSave: () => void
  onCancel: () => void
}) {
  // Always show one trailing empty slot after the filled ones — filling it
  // grows the list, clearing a slot shrinks it back.
  const catSlots: string[] = [...form.category_ids.map(String), '']
  const merchantSlots: string[] = [...form.merchant_patterns, '']

  function setCatSlot(i: number, value: string) {
    setForm(f => {
      const ids = [...f.category_ids]
      if (value === '') ids.splice(i, 1)
      else if (i < ids.length) ids[i] = +value
      else ids.push(+value)
      return { ...f, category_ids: ids }
    })
  }

  function setMerchantSlot(i: number, value: string) {
    setForm(f => {
      const patterns = [...f.merchant_patterns]
      if (value === '' && i < patterns.length) patterns.splice(i, 1)
      else if (i < patterns.length) patterns[i] = value
      else if (value !== '') patterns.push(value)
      return { ...f, merchant_patterns: patterns }
    })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-gray-700">{isEdit ? 'Modifier le budget' : 'Nouveau budget'}</p>

      <input
        type="text"
        placeholder="Nom (optionnel)"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
        value={form.name ?? ''}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
      />

      <div>
        <p className="text-xs text-gray-500 mb-1">Période</p>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(PERIOD_LABELS) as BudgetPeriodType[]).map(pt => (
            <button
              key={pt}
              type="button"
              onClick={() => setForm(f => ({ ...f, period_type: pt, start_date: periodAnchor(pt)?.value ?? todayIso() }))}
              className={clsx(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                form.period_type === pt ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-blue-300'
              )}
            >
              {PERIOD_LABELS[pt]}
            </button>
          ))}
        </div>
        {form.period_type === 'custom' && (
          <input
            type="number"
            min={1}
            placeholder="Nombre de jours"
            className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            value={form.period_days ?? ''}
            onChange={e => setForm(f => ({ ...f, period_days: e.target.value ? +e.target.value : null }))}
          />
        )}
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <span className="text-xs text-gray-500">Débute le</span>
          <div className="flex items-stretch">
            <input
              type="date"
              className="text-sm border border-gray-200 rounded-l-lg px-2 py-1.5"
              value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
            />
            {(() => {
              const anchor = periodAnchor(form.period_type)
              const isToday = form.start_date === todayIso()
              return (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, start_date: isToday && anchor ? anchor.value : todayIso() }))}
                  className="px-2.5 py-1.5 text-xs border border-l-0 border-gray-200 text-gray-500 rounded-r-lg hover:border-blue-300 hover:text-blue-500 transition-colors"
                >
                  {isToday && anchor ? anchor.label : "Aujourd'hui"}
                </button>
              )
            })()}
          </div>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={form.recurring}
            onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))}
          />
          Se renouvelle automatiquement
        </label>
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-1">Cible</p>
        <div className="flex gap-1 mb-2">
          {(['category', 'merchant'] as BudgetTargetType[]).map(tt => (
            <button
              key={tt}
              type="button"
              onClick={() => setForm(f => ({ ...f, target_type: tt }))}
              className={clsx(
                'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                form.target_type === tt ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-blue-300'
              )}
            >
              {tt === 'category' ? 'Catégorie(s)' : 'Événement personnalisé'}
            </button>
          ))}
        </div>

        {form.target_type === 'category' ? (
          <div className="space-y-2">
            {catSlots.map((slot, i) => (
              <select
                key={i}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                value={slot}
                onChange={e => setCatSlot(i, e.target.value)}
              >
                <option value="">{i === 0 ? 'Sélectionner une catégorie' : 'Catégorie supplémentaire (optionnel)'}</option>
                {categories
                  .filter(c => String(c.id) === slot || !catSlots.includes(String(c.id)))
                  .map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {merchantSlots.map((slot, i) => (
              <input
                key={i}
                type="text"
                placeholder={i === 0 ? 'Ex : Migros' : 'Événement supplémentaire (optionnel), ex : Coop'}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                value={slot}
                onChange={e => setMerchantSlot(i, e.target.value)}
              />
            ))}
          </div>
        )}
      </div>

      <input
        type="number"
        placeholder="Montant limite (CHF)"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
        value={form.amount_limit || ''}
        onChange={e => setForm(f => ({ ...f, amount_limit: e.target.value ? +e.target.value : 0 }))}
      />

      <div className="flex gap-2">
        <button onClick={onSave} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
          {isEdit ? 'Enregistrer' : 'Ajouter'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors">
          Annuler
        </button>
      </div>
    </div>
  )
}

function historyLabel(h: { period_start: string; period_end: string }, periodType: BudgetPeriodType) {
  if (periodType === 'monthly') {
    const date = new Date(h.period_start)
    const includeYear = date.getFullYear() !== new Date().getFullYear()
    return date.toLocaleDateString('fr-CH', { month: 'short', ...(includeYear ? { year: '2-digit' } : {}) })
  }
  if (periodType === 'annual') {
    return String(new Date(h.period_start).getFullYear())
  }
  const date = new Date(h.period_start)
  const includeYear = date.getFullYear() !== new Date().getFullYear()
  return date.toLocaleDateString('fr-CH', { day: '2-digit', month: 'short', ...(includeYear ? { year: '2-digit' } : {}) })
}

function statusColor(spent: number, limit: number) {
  const pct = limit > 0 ? (spent / limit) * 100 : 0
  if (pct >= 100) return '#ef4444' // red-500
  if (pct >= 75) return '#fb923c' // orange-400
  return '#22c55e' // green-500
}

function HistoryTooltip({ active, payload }: { active?: boolean; payload?: { payload: { label: string; spent: number; percent: number } }[] }) {
  if (!active || !payload?.length) return null
  const { label, spent, percent } = payload[0].payload
  return (
    <div className="bg-white rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-900 capitalize">{label}</p>
      <p className="text-gray-600 mt-0.5">Dépensé : {fmt(spent)}</p>
      <p className="text-gray-600">{percent}% de la limite</p>
    </div>
  )
}

function PaceTooltip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; actual: number; pace: number } }[] }) {
  if (!active || !payload?.length) return null
  const { date, actual, pace } = payload[0].payload
  return (
    <div className="bg-white rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-900">{date}</p>
      <p className="mt-0.5" style={{ color: '#2563eb' }}>Dépensé : {fmt(actual)}</p>
      <p style={{ color: '#94a3b8' }}>Rythme cible : {fmt(pace)}</p>
    </div>
  )
}

function shiftDateIso(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DEFAULT_HISTORY_COUNT = 6
const EXPANDED_HISTORY_COUNT = 60
const HISTORY_BAR_WIDTH = 38
const HISTORY_CHART_MIN_WIDTH = 320

function BudgetDetailPanel({ budget, onClose, onEdit }: { budget: Budget; onClose: () => void; onEdit: () => void }) {
  const [detail, setDetail] = useState<BudgetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [onDate, setOnDate] = useState<string | undefined>(undefined)
  const [historyCount, setHistoryCount] = useState(DEFAULT_HISTORY_COUNT)
  const historyScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Only show the full loading state for the initial fetch — subsequent
    // refetches (period nav, history toggle) update in place so charts don't
    // unmount and replay their entry animation on every click.
    if (!detail) setLoading(true)
    api.budgetDetail(budget.id, { onDate, historyCount })
      .then(setDetail)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget.id, onDate, historyCount])

  function goPrev() {
    if (!detail?.can_go_prev) return
    setOnDate(shiftDateIso(detail.budget.period_start, -1))
  }

  function goNext() {
    if (!detail?.can_go_next) return
    setOnDate(shiftDateIso(detail.budget.period_end, 1))
  }

  const label = budget.name || (budget.target_type === 'category' ? budget.category_labels.join(' + ') : budget.merchant_patterns.join(' + '))

  const chartData = useMemo(() => {
    if (!detail) return []
    const totalDays = Math.round(
      (new Date(detail.budget.period_end).getTime() - new Date(detail.budget.period_start).getTime()) / 86400000
    ) + 1
    return detail.daily_spend.map((p, i) => ({
      date: dateLabel(p.date),
      actual: p.cumulative,
      pace: Math.round((detail.budget.amount_limit * (i + 1) / totalDays) * 100) / 100,
    }))
  }, [detail])

  const historyData = useMemo(() => {
    if (!detail) return []
    return detail.history.map(h => ({
      label: historyLabel(h, detail.budget.period_type),
      spent: h.spent,
      percent: detail.budget.amount_limit > 0 ? Math.round((h.spent / detail.budget.amount_limit) * 100) : 0,
      color: statusColor(h.spent, detail.budget.amount_limit),
      periodStart: h.period_start,
      isCurrent: h.period_start === detail.budget.period_start,
    }))
  }, [detail])

  // History is oldest-first and anchored to today, not the period being
  // viewed — scroll to keep the highlighted (viewed) bar in view rather than
  // always jumping to the most recent one, so browsing the past doesn't lose
  // its place whenever the data refetches (e.g. expanding "Voir toute
  // l'évolution"). Uses the same width formula as the chart's own inline
  // style rather than reading el.scrollWidth, which can still reflect the
  // previous render's (wider) chart for a frame — ResponsiveContainer
  // resizes its SVG asynchronously via ResizeObserver, so measuring the DOM
  // directly here is a race that left scrollLeft pointing past the new,
  // narrower content after collapsing "Voir toute l'évolution".
  useEffect(() => {
    const el = historyScrollRef.current
    if (!el || historyData.length === 0) return
    const contentWidth = Math.max(HISTORY_CHART_MIN_WIDTH, historyData.length * HISTORY_BAR_WIDTH)
    const index = historyData.findIndex(h => h.isCurrent)
    const maxScrollLeft = Math.max(0, contentWidth - el.clientWidth)
    if (index === -1) {
      el.scrollLeft = maxScrollLeft
      return
    }
    const target = HISTORY_BAR_WIDTH * index - el.clientWidth / 2 + HISTORY_BAR_WIDTH / 2
    el.scrollLeft = Math.min(maxScrollLeft, Math.max(0, target))
  }, [historyData])

  const today = new Date()
  const periodEnd = detail ? new Date(detail.budget.period_end) : null
  const daysLeft = periodEnd ? Math.max(0, Math.ceil((periodEnd.getTime() - today.getTime()) / 86400000)) : 0

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{label}</h3>
            <div className="flex items-center gap-1.5 mt-1">
              {detail?.budget.recurring && (
                <button
                  onClick={goPrev}
                  disabled={!detail.can_go_prev}
                  className="w-6 h-6 shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 hover:text-blue-600 disabled:opacity-30 disabled:hover:bg-gray-100 disabled:hover:text-gray-600 transition-colors"
                  title="Période précédente"
                >
                  <ChevronLeft size={14} />
                </button>
              )}
              <p className="flex items-center justify-center gap-1 text-sm font-medium text-gray-600 min-w-[11rem] whitespace-nowrap">
                {detail && (detail.budget.recurring ? <Repeat size={12} /> : <CalendarClock size={12} />)}
                {detail ? periodLabel(detail.budget) : ''}
                {detail && !detail.budget.recurring && ' (ponctuel)'}
              </p>
              {detail?.budget.recurring && (
                <button
                  onClick={goNext}
                  disabled={!detail.can_go_next}
                  className="w-6 h-6 shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 hover:text-blue-600 disabled:opacity-30 disabled:hover:bg-gray-100 disabled:hover:text-gray-600 transition-colors"
                  title="Période suivante"
                >
                  <ChevronRight size={14} />
                </button>
              )}
              {onDate !== undefined && (
                <button
                  onClick={() => setOnDate(undefined)}
                  className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded-full whitespace-nowrap transition-colors"
                  title="Revenir à la période actuelle"
                >
                  <RotateCcw size={11} /> Aujourd'hui
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onEdit}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"
              title="Modifier ce budget"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading || !detail ? (
            <div className="text-center py-12 text-gray-400 text-sm font-medium">Chargement...</div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Dépensé</p>
                  <p className="text-lg font-bold text-gray-800 mt-0.5">{fmt(detail.budget.spent)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Limite</p>
                  <p className="text-lg font-bold text-gray-800 mt-0.5">{fmt(detail.budget.amount_limit)}</p>
                </div>
                <div className={clsx('rounded-xl p-3', detail.budget.amount_limit - detail.budget.spent >= 0 ? 'bg-green-50' : 'bg-red-50')}>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Restant</p>
                  <p className={clsx('text-lg font-bold mt-0.5', detail.budget.amount_limit - detail.budget.spent >= 0 ? 'text-green-600' : 'text-red-500')}>
                    {fmt(detail.budget.amount_limit - detail.budget.spent)}
                  </p>
                </div>
                <div className={clsx('rounded-xl p-3', detail.budget.projected_over ? 'bg-amber-50' : 'bg-gray-50')}>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Projection</p>
                  <p className={clsx('text-lg font-bold mt-0.5', detail.budget.projected_over ? 'text-amber-700' : 'text-gray-800')}>
                    {fmt(detail.budget.projected_total)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-400 -mt-3">
                {detail.budget.percent.toFixed(0)}% utilisé · {daysLeft > 0 ? `${daysLeft} jour(s) restant(s)` : 'Période terminée'}
              </p>

              {/* Pace chart */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Rythme de dépense</p>
                {chartData.length < 2 ? (
                  <p className="text-xs text-gray-400">Pas assez de données pour cette période.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={20} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={40} />
                      <Tooltip content={<PaceTooltip />} />
                      <Line type="monotone" dataKey="pace" name="Rythme cible" stroke="#94a3b8" strokeDasharray="4 3" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="actual" name="Dépensé" stroke="#2563eb" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* History chart */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-gray-700">Historique</p>
                    <span className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="w-2.5 h-0 border-t-2 border-dashed" style={{ borderColor: '#f59e0b' }} />
                      Limite {fmt(detail.budget.amount_limit)}
                    </span>
                  </div>
                  {detail.budget.recurring && (
                    <button
                      onClick={() => setHistoryCount(c => c === DEFAULT_HISTORY_COUNT ? EXPANDED_HISTORY_COUNT : DEFAULT_HISTORY_COUNT)}
                      className="text-xs text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      {historyCount === DEFAULT_HISTORY_COUNT ? "Voir toute l'évolution" : 'Réduire'}
                    </button>
                  )}
                </div>
                {historyData.length < 2 ? (
                  <p className="text-xs text-gray-400">
                    {detail.budget.recurring && !detail.can_go_prev
                      ? "Aucune période antérieure : c'est la plus ancienne pour laquelle des données existent."
                      : 'Pas encore d\'historique (budget récent).'}
                  </p>
                ) : (
                  <div ref={historyScrollRef} className="overflow-x-auto">
                    <div style={{ width: Math.max(HISTORY_CHART_MIN_WIDTH, historyData.length * HISTORY_BAR_WIDTH) }}>
                      <ResponsiveContainer width="100%" height={190}>
                        <BarChart
                          data={historyData}
                          margin={{ top: 4, right: 8, left: 0, bottom: 24 }}
                          style={{ cursor: 'pointer' }}
                          onClick={(state: { activePayload?: { payload: { periodStart: string; isCurrent: boolean } }[] }) => {
                            const d = state?.activePayload?.[0]?.payload
                            if (d) setOnDate(d.isCurrent ? undefined : d.periodStart)
                          }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10, fill: '#94a3b8' }}
                            interval={0}
                            angle={-45}
                            textAnchor="end"
                            height={45}
                          />
                          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={40} />
                          <Tooltip content={<HistoryTooltip />} />
                          <ReferenceLine
                            y={detail.budget.amount_limit}
                            stroke="#f59e0b"
                            strokeWidth={2}
                            strokeDasharray="6 3"
                          />
                          <Bar dataKey="spent" radius={[4, 4, 0, 0]}>
                            {historyData.map((h, i) => <Cell key={i} fill={h.color} stroke={h.isCurrent ? '#2563eb' : 'none'} strokeWidth={2} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              {/* Transactions */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Transactions de la période</p>
                {detail.transactions.length === 0 ? (
                  <p className="text-xs text-gray-400">Aucune transaction sur cette période.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.transactions.map(tx => (
                      <div key={tx.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50/50 flex items-center justify-between gap-4 hover:bg-gray-100/50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {tx.counterparty || tx.description || 'Transaction anonyme'}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                            <span>{new Date(tx.date).toLocaleDateString('fr-CH')}</span>
                            {tx.category_name && <span>{tx.category_icon} {tx.category_name}</span>}
                          </div>
                        </div>
                        <p className="text-sm font-extrabold text-gray-900 shrink-0">{fmt(tx.amount)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
