import { useEffect, useState } from 'react'
import { api, Category, Prediction, CategoryPrediction } from '../api'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine
} from 'recharts'

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)
const fmtMonth = (s: string) => {
  if (!s) return ''
  const [y, m] = s.split('-')
  return new Date(+y, +m - 1).toLocaleDateString('fr-CH', { month: 'short', year: '2-digit' })
}

export default function Predictions() {
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCat, setSelectedCat] = useState<number | undefined>(undefined)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [allPredictions, setAllPredictions] = useState<CategoryPrediction[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingAll, setLoadingAll] = useState(true)

  useEffect(() => {
    api.categories().then(setCategories)
    api.allCategoryPredictions(3).then(setAllPredictions).finally(() => setLoadingAll(false))
  }, [])

  useEffect(() => {
    setLoading(true)
    api.prediction(selectedCat, 3).then(setPrediction).finally(() => setLoading(false))
  }, [selectedCat])

  const lastHistorical = prediction?.historical.at(-1)?.month

  const chartData = [
    ...(prediction?.historical.slice(-12) ?? []).map(h => ({
      month: h.month,
      actual: h.actual,
      predicted: undefined,
      lower: undefined,
      upper: undefined,
    })),
    ...(prediction?.forecast ?? []).map(f => ({
      month: f.month,
      actual: undefined,
      predicted: f.predicted,
      lower: f.lower,
      upper: f.upper,
    })),
  ]

  const selectedCatObj = categories.find(c => c.id === selectedCat)

  return (
    <div className="p-6 pt-4 space-y-6">
      <p className="text-sm text-gray-500">Estimation des dépenses futures par catégorie</p>

      {/* Category forecast chart */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">
            Prévision de dépenses
            {selectedCatObj ? ` — ${selectedCatObj.icon} ${selectedCatObj.name}` : ' — Toutes catégories'}
          </h2>
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
            value={selectedCat ?? ''}
            onChange={e => setSelectedCat(e.target.value ? +e.target.value : undefined)}
          >
            <option value="">Toutes dépenses</option>
            {categories
              .filter(c => c.name !== 'Non catégorisé')
              .map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)
            }
          </select>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Chargement...</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: unknown) => typeof v === 'number' ? fmt(v) : '—'} labelFormatter={fmtMonth} />
              {lastHistorical && (
                <ReferenceLine x={lastHistorical} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: 'Aujourd\'hui', fontSize: 10, fill: '#94A3B8' }} />
              )}
              <Area
                type="monotone" dataKey="upper" name="Fourchette haute"
                stroke="none" fill="#BFDBFE" fillOpacity={0.5}
              />
              <Area
                type="monotone" dataKey="lower" name="Fourchette basse"
                stroke="none" fill="#fff" fillOpacity={1}
              />
              <Line
                type="monotone" dataKey="actual" name="Réel"
                stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} connectNulls={false}
              />
              <Line
                type="monotone" dataKey="predicted" name="Prévu"
                stroke="#F97316" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 4 }} connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {prediction && prediction.forecast.length > 0 && (
          <div className="flex gap-4 mt-4">
            {prediction.forecast.map(f => (
              <div key={f.month} className="flex-1 bg-orange-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 capitalize">{fmtMonth(f.month)}</p>
                <p className="text-lg font-bold text-orange-600 mt-1">{fmt(f.predicted)}</p>
                <p className="text-xs text-gray-400">{fmt(f.lower)} – {fmt(f.upper)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All categories next month */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Prévisions par catégorie (mois prochain)</h2>
        {loadingAll ? (
          <div className="text-center py-8 text-gray-400">Chargement...</div>
        ) : (
          <div className="space-y-3">
            {allPredictions.map(cat => (
              <div key={cat.category_id} className="flex items-center gap-3">
                <span className="text-lg w-7 shrink-0">{cat.category_icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-700">{cat.category_name}</p>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-xs text-gray-400">Moy. 3 mois: {fmt(cat.avg_last_3)}</span>
                      <span className="text-sm font-bold text-orange-600">{fmt(cat.next_month_predicted)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.min(100, (cat.next_month_predicted / (allPredictions[0]?.next_month_predicted || 1)) * 100)}%`,
                        backgroundColor: cat.category_color,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
