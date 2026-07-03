import { useEffect, useState } from 'react'
import { api, Budget, Category } from '../api'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import clsx from 'clsx'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

function monthLabel(m: string) {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function adjMonth(m: string, delta: number) {
  let [y, mo] = m.split('-').map(Number)
  mo += delta
  if (mo > 12) { mo = 1; y++ }
  if (mo < 1) { mo = 12; y-- }
  return `${y}-${String(mo).padStart(2, '0')}`
}

export default function Budgets() {
  const [month, setMonth] = useState(currentMonth())
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const [newCatId, setNewCatId] = useState('')
  const [newLimit, setNewLimit] = useState('')

  async function load() {
    setLoading(true)
    const [b, c] = await Promise.all([api.budgets(month), api.categories()])
    setBudgets(b)
    setCategories(c)
    setLoading(false)
  }

  useEffect(() => { load() }, [month])

  async function handleAdd() {
    if (!newCatId || !newLimit) return
    await api.createBudget({ category_id: +newCatId, month, amount_limit: +newLimit })
    setShowForm(false); setNewCatId(''); setNewLimit('')
    load()
  }

  async function handleEdit(id: number) {
    if (!editVal) return
    await api.updateBudget(id, +editVal)
    setEditId(null); setEditVal('')
    load()
  }

  async function handleDelete(id: number) {
    if (!confirm('Supprimer ce budget ?')) return
    await api.deleteBudget(id)
    load()
  }

  const usedCategoryIds = new Set(budgets.map(b => b.category_id))
  const availableCategories = categories.filter(c => !usedCategoryIds.has(c.id) && c.name !== 'Non catégorisé')

  const overBudget = budgets.filter(b => b.percent >= 100)
  const total_limit = budgets.reduce((s, b) => s + b.amount_limit, 0)
  const total_spent = budgets.reduce((s, b) => s + b.spent, 0)

  return (
    <div className="p-6 pt-4 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Limites de dépenses par catégorie</p>
        <div className="flex items-center gap-3">
          <button onClick={() => setMonth(m => adjMonth(m, -1))} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">‹</button>
          <span className="text-sm font-medium text-gray-700 min-w-32 text-center capitalize">{monthLabel(month)}</span>
          <button onClick={() => setMonth(m => adjMonth(m, 1))} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">›</button>
        </div>
      </div>

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
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-sm font-medium text-red-700">⚠️ Dépassements : {overBudget.map(b => b.category_name).join(', ')}</p>
        </div>
      )}

      {/* Budget cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Aucun budget pour ce mois.</div>
      ) : (
        <div className="space-y-3">
          {budgets.map(b => {
            const pct = Math.min(b.percent, 100)
            const color = b.percent < 75 ? 'bg-green-500' : b.percent < 100 ? 'bg-orange-400' : 'bg-red-500'
            return (
              <div key={b.id} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span>{b.category_icon}</span>
                    <span className="font-medium text-gray-800">{b.category_name}</span>
                    {b.percent >= 100 && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Dépassé</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {editId === b.id ? (
                      <>
                        <input
                          type="number"
                          className="w-24 text-sm border border-gray-200 rounded px-2 py-1"
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          autoFocus
                        />
                        <button onClick={() => handleEdit(b.id)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={14} /></button>
                        <button onClick={() => setEditId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={14} /></button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-gray-500">{fmt(b.spent)} / {fmt(b.amount_limit)}</span>
                        <button onClick={() => { setEditId(b.id); setEditVal(String(b.amount_limit)) }} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(b.id)} className="p-1 text-red-400 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
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
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Nouveau budget</p>
          <select
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            value={newCatId}
            onChange={e => setNewCatId(e.target.value)}
          >
            <option value="">Sélectionner une catégorie</option>
            {availableCategories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Montant limite (CHF)"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2"
              value={newLimit}
              onChange={e => setNewLimit(e.target.value)}
            />
            <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
              Ajouter
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-200 text-gray-500 text-sm rounded-xl w-full justify-center hover:border-blue-300 hover:text-blue-500 transition-colors"
        >
          <Plus size={16} /> Ajouter un budget
        </button>
      )}
    </div>
  )
}
