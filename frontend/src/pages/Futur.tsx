import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, Flame, Settings2, Plus, X, ChevronDown, ChevronUp,
  Target, AlertTriangle, Sparkles,
} from 'lucide-react'
import {
  api, InvestmentSettings, MonthlySimPoint, SimulationResult, ScenarioItem,
} from '../api'

// ── Formatters ────────────────────────────────────────────────────────────────

const fmt   = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF', maximumFractionDigits: 0 }).format(n)
const fmtSm = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : String(Math.round(n))

function fmtMonth(s: string) {
  if (!s) return ''
  const [y, m] = s.split('-')
  return new Date(+y, +m - 1).toLocaleDateString('fr-CH', { month: 'short', year: '2-digit' })
}

function monthsToLabel(m: number | null): string {
  if (m === null || m === undefined) return '—'
  const today = new Date()
  const target = new Date(today.getFullYear(), today.getMonth() + m, 1)
  return target.toLocaleDateString('fr-CH', { month: 'short', year: 'numeric' })
}

// ── Horizon options ───────────────────────────────────────────────────────────

const HORIZONS = [
  { label: '6 mois',  months: 6 },
  { label: '1 an',    months: 12 },
  { label: '2 ans',   months: 24 },
  { label: '5 ans',   months: 60 },
  { label: '10 ans',  months: 120 },
  { label: '20 ans',  months: 240 },
  { label: '30 ans',  months: 360 },
  { label: '50 ans',  months: 600 },
]

// Which data key to show
type ViewMode = 'networth' | 'balance' | 'portfolio'

// ── Scenario helpers ──────────────────────────────────────────────────────────

const SCENARIO_TYPES = [
  { value: 'expense_reduction',  label: '📉 Réduire une dépense' },
  { value: 'income_increase',    label: '💰 Augmentation de salaire' },
  { value: 'one_time_event',     label: '🎯 Événement ponctuel' },
  { value: 'contribution_change',label: '📈 Changer la contribution mensuelle' },
]

function scenarioLabel(sc: ScenarioItem): string {
  switch (sc.type) {
    case 'expense_reduction':   return `📉 Réduction dépenses −${sc.percent_change ?? 0}%${sc.category ? ` (${sc.category})` : ''}`
    case 'income_increase':     return `💰 Salaire +${fmt(sc.amount ?? 0)}/mois`
    case 'one_time_event':      return `🎯 Événement: ${(sc.amount ?? 0) >= 0 ? '+' : ''}${fmt(sc.amount ?? 0)} au mois ${sc.start_month}`
    case 'contribution_change': return `📈 Contribution → ${fmt(sc.amount ?? 0)}/mois`
    default: return sc.type
  }
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ payload?: MonthlySimPoint }>
  label?: string
  view: ViewMode
}

function CustomTooltip({ active, payload, label, view }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  const at = (pct: string) => d[`${view}_${pct}` as keyof MonthlySimPoint] as number
  const keys = { p10: at('p10'), p25: at('p25'), p50: at('p50'), p75: at('p75'), p90: at('p90') }

  return (
    <div className="bg-gray-900 text-white rounded-xl px-4 py-3 shadow-2xl text-sm border border-gray-700 min-w-[200px]">
      <p className="font-semibold text-gray-300 mb-2">{label ? fmtMonth(label) : ''}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6"><span className="text-emerald-400">Optimiste (p90)</span><span className="font-bold">{fmt(keys.p90)}</span></div>
        <div className="flex justify-between gap-6"><span className="text-blue-400">Probable (p50)</span><span className="font-bold">{fmt(keys.p50)}</span></div>
        <div className="flex justify-between gap-6"><span className="text-orange-400">Pessimiste (p10)</span><span className="font-bold">{fmt(keys.p10)}</span></div>
      </div>
    </div>
  )
}

// ── Slider component ──────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step, format, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <span className="text-sm font-bold text-gray-900">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full accent-blue-600 cursor-pointer"
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Futur() {
  // Settings
  const [settings, setSettings] = useState<InvestmentSettings | null>(null)
  const [annualRate, setAnnualRate]         = useState(0.07)
  const [inflationRate, setInflationRate]   = useState(0.02)
  const [portfolioValue, setPortfolioValue] = useState(0)
  const [monthlyContrib, setMonthlyContrib] = useState(0)
  const [manualPortfolio, setManualPortfolio] = useState('')  // raw input for portfolio override
  const [contribManuallySet, setContribManuallySet] = useState(false)  // whether monthly_contrib should be persisted as an override

  // Simulation
  const [result, setResult]     = useState<SimulationResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [horizonIdx, setHorizonIdx] = useState(4) // default 10 years
  const [view, setView]         = useState<ViewMode>('networth')

  // Scenarios
  const [scenarios, setScenarios]   = useState<ScenarioItem[]>([])
  const [showScForm, setShowScForm] = useState(false)
  const [scType, setScType]         = useState<ScenarioItem['type']>('expense_reduction')
  const [scAmount, setScAmount]     = useState('')
  const [scPct, setScPct]           = useState('20')
  const [scMonth, setScMonth]       = useState('1')
  const [scCategory, setScCategory] = useState('')

  // Settings panel open/close
  const [settingsOpen, setSettingsOpen] = useState(true)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  // ── Load settings on mount ────────────────────────────────────────────────
  useEffect(() => {
    api.investmentSettings().then(s => {
      setSettings(s)
      setAnnualRate(s.annual_rate)
      setInflationRate(s.inflation_rate)
      setPortfolioValue(s.effective_portfolio)
      setMonthlyContrib(s.effective_contrib)
      setManualPortfolio(s.manual_portfolio != null ? String(s.manual_portfolio) : '')
      setContribManuallySet(s.monthly_contrib != null)
    })
  }, [])

  // ── Cleanup debounce on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  // ── Run simulation (debounced) ────────────────────────────────────────────
  const runSim = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current
      setLoading(true)
      try {
        const res = await api.simulate({
          months:          HORIZONS[horizonIdx].months,
          n_simulations:   1000,
          annual_rate:     annualRate,
          inflation_rate:  inflationRate,
          portfolio_value: portfolioValue,
          monthly_contrib: monthlyContrib,
          scenarios,
        })
        // Drop stale responses from a superseded request (out-of-order network replies).
        if (requestId === requestIdRef.current) setResult(res)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    }, 400)
  }, [annualRate, inflationRate, portfolioValue, monthlyContrib, horizonIdx, scenarios])

  useEffect(() => {
    if (settings !== null) runSim()
  }, [annualRate, inflationRate, portfolioValue, monthlyContrib, horizonIdx, scenarios, settings])

  // ── Chart data (thin out for long horizons) ───────────────────────────────
  const chartData = (() => {
    if (!result) return []
    const data = result.monthly
    const maxPoints = 120
    if (data.length <= maxPoints) return data
    const step = Math.ceil(data.length / maxPoints)
    return data.filter((_, i) => i % step === 0 || i === data.length - 1)
  })()

  const fireNumber = result?.fire_number ?? 0

  // ── Save settings to DB ───────────────────────────────────────────────────
  async function saveSettings() {
    const body: {
      annual_rate: number
      inflation_rate: number
      manual_portfolio?: number
      monthly_contrib?: number
    } = {
      annual_rate:    annualRate,
      inflation_rate: inflationRate,
    }
    if (manualPortfolio !== '') body.manual_portfolio = Number(manualPortfolio)
    if (contribManuallySet) body.monthly_contrib = monthlyContrib
    const updated = await api.saveInvestmentSettings(body)
    setSettings(updated)
    setPortfolioValue(updated.effective_portfolio)
    setMonthlyContrib(updated.effective_contrib)
  }

  // ── Reset monthly contribution back to the auto-computed average ─────────
  async function clearContribOverride() {
    const updated = await api.saveInvestmentSettings({ monthly_contrib: -1 })
    setSettings(updated)
    setContribManuallySet(false)
    setMonthlyContrib(updated.auto_monthly_contrib)
  }

  // ── Add scenario ──────────────────────────────────────────────────────────
  function addScenario() {
    const sc: ScenarioItem = {
      type: scType,
      start_month: Number(scMonth) || 1,
    }
    if (scType === 'expense_reduction')   { sc.percent_change = Number(scPct); if (scCategory) sc.category = scCategory }
    if (scType === 'income_increase')     sc.amount = Number(scAmount)
    if (scType === 'one_time_event')      sc.amount = Number(scAmount)
    if (scType === 'contribution_change') sc.amount = Number(scAmount)

    setScenarios(prev => [...prev, sc])
    setShowScForm(false)
    setScAmount(''); setScPct('20'); setScMonth('1'); setScCategory('')
  }

  // ── FIRE labels ───────────────────────────────────────────────────────────
  const fireP10 = result?.fire_months?.p10 ?? null
  const fireP50 = result?.fire_months?.p50 ?? null
  const fireP90 = result?.fire_months?.p90 ?? null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 theme-fx-logo">Futur & Investissements</h1>
          <p className="text-sm text-gray-500 mt-1">
            Simulation Monte Carlo · 1 000 scénarios aléatoires
          </p>
        </div>
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Settings2 className="w-4 h-4" />
          Paramètres
          {settingsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* Left: sliders */}
            <div className="space-y-5">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Paramètres de simulation</h2>
              <Slider
                label="Rendement annuel"
                value={annualRate}
                min={0} max={0.20} step={0.005}
                format={v => `${(v * 100).toFixed(1)} %`}
                onChange={setAnnualRate}
              />
              <Slider
                label="Inflation annuelle"
                value={inflationRate}
                min={0} max={0.10} step={0.005}
                format={v => `${(v * 100).toFixed(1)} %`}
                onChange={setInflationRate}
              />
              <div>
                <Slider
                  label="Contribution mensuelle"
                  value={monthlyContrib}
                  min={0} max={10000} step={50}
                  format={v => fmt(v)}
                  onChange={v => { setMonthlyContrib(v); setContribManuallySet(true) }}
                />
                {contribManuallySet && (
                  <button
                    onClick={clearContribOverride}
                    className="text-xs text-gray-400 hover:text-red-500 mt-1 underline"
                  >
                    Revenir à la moyenne auto ({fmt(settings?.auto_monthly_contrib ?? 0)})
                  </button>
                )}
              </div>
            </div>

            {/* Right: portfolio value override */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Portefeuille actuel</h2>

              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <p className="text-xs text-blue-600 font-medium mb-1">Valeur auto-calculée depuis vos transactions</p>
                <p className="text-2xl font-bold text-blue-700">{fmt(settings?.auto_portfolio ?? 0)}</p>
                <p className="text-xs text-gray-400 mt-1">Chaque investissement passé est capitalisé jusqu'à aujourd'hui au taux défini</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                  Valeur réelle (saisie manuelle)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder={String(Math.round(settings?.auto_portfolio ?? 0))}
                    value={manualPortfolio}
                    onChange={e => {
                      setManualPortfolio(e.target.value)
                      if (e.target.value !== '') setPortfolioValue(Number(e.target.value))
                      else setPortfolioValue(settings?.auto_portfolio ?? 0)
                    }}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    onClick={saveSettings}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Sauvegarder
                  </button>
                </div>
                {settings?.manual_portfolio != null && (
                  <button
                    onClick={() => {
                      api.saveInvestmentSettings({ manual_portfolio: -1 }).then(s => {
                        setSettings(s); setManualPortfolio(''); setPortfolioValue(s.auto_portfolio)
                      })
                    }}
                    className="text-xs text-gray-400 hover:text-red-500 mt-1 underline"
                  >
                    Supprimer la valeur manuelle
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Horizon + view selectors */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {HORIZONS.map((h, i) => (
            <button
              key={h.months}
              onClick={() => setHorizonIdx(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                horizonIdx === i
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {([
            ['networth',  'Patrimoine net', '🏦'],
            ['balance',   'Balance liquide','💵'],
            ['portfolio', 'Portefeuille',   '📈'],
          ] as const).map(([v, label, icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                view === v
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main chart */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">
            Cône de probabilité — {
              view === 'networth' ? 'Patrimoine net (balance + portefeuille)' :
              view === 'portfolio' ? 'Portefeuille d\'investissement' : 'Balance liquide'
            }
          </h2>
          {loading && (
            <span className="text-xs text-blue-500 animate-pulse">Calcul en cours…</span>
          )}
        </div>

        {result ? (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="month"
                tickFormatter={fmtMonth}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={fmtSm}
                width={60}
              />
              <Tooltip content={(props) => <CustomTooltip {...props} view={view} />} />

              {/* FIRE line */}
              {fireNumber > 0 && (
                <ReferenceLine
                  y={fireNumber}
                  stroke="#f59e0b"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{ value: `🎯 FIRE ${fmtSm(fireNumber)}`, position: 'insideTopRight', fontSize: 11, fill: '#f59e0b' }}
                />
              )}

              {/* p10–p90 outer band */}
              <Area
                type="monotone"
                dataKey={`${view}_p90`}
                name="p90 (optimiste)"
                stroke="none"
                fill="#bfdbfe"
                fillOpacity={0.35}
              />
              <Area
                type="monotone"
                dataKey={`${view}_p10`}
                name="p10 (pessimiste)"
                stroke="none"
                fill="#ffffff"
                fillOpacity={1}
              />

              {/* p25–p75 inner band */}
              <Area
                type="monotone"
                dataKey={`${view}_p75`}
                name="p75"
                stroke="none"
                fill="#93c5fd"
                fillOpacity={0.45}
              />
              <Area
                type="monotone"
                dataKey={`${view}_p25`}
                name="p25"
                stroke="none"
                fill="#ffffff"
                fillOpacity={1}
              />

              {/* Median line */}
              <Line
                type="monotone"
                dataKey={`${view}_p50`}
                name="Médiane (p50)"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[380px] flex items-center justify-center text-gray-400">
            <div className="text-center">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Chargement de la simulation…</p>
            </div>
          </div>
        )}
      </div>

      {/* FIRE card + summary stats */}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* FIRE card */}
          <div className="md:col-span-2 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <div className="bg-amber-400 rounded-xl p-2.5">
                <Flame className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 text-base">Indépendance Financière (FIRE)</h3>
                <p className="text-xs text-gray-500 mt-0.5">Règle des 4% · Portefeuille cible</p>
                <p className="text-3xl font-black text-amber-600 mt-2">{fmt(result.fire_number)}</p>
                <p className="text-xs text-gray-500 mt-1">= {fmt(result.annual_expenses_median)} dépenses/an × 25</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="bg-white/70 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-600 font-semibold">Optimiste</p>
                <p className="text-sm font-bold text-gray-900 mt-1">{monthsToLabel(fireP10)}</p>
                <p className="text-xs text-gray-400">p10</p>
              </div>
              <div className="bg-white/90 rounded-xl p-3 text-center border-2 border-amber-300">
                <p className="text-xs text-amber-600 font-semibold">Médian</p>
                <p className="text-sm font-bold text-gray-900 mt-1">{monthsToLabel(fireP50)}</p>
                <p className="text-xs text-gray-400">p50</p>
              </div>
              <div className="bg-white/70 rounded-xl p-3 text-center">
                <p className="text-xs text-orange-500 font-semibold">Pessimiste</p>
                <p className="text-sm font-bold text-gray-900 mt-1">{monthsToLabel(fireP90)}</p>
                <p className="text-xs text-gray-400">p90</p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 bg-amber-100 rounded-full h-2">
                <div
                  className="bg-amber-400 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, result.pct_simulations_fire)}%` }}
                />
              </div>
              <span className="text-xs font-bold text-amber-700 whitespace-nowrap">
                {result.pct_simulations_fire.toFixed(0)}% des simulations atteignent le FIRE
              </span>
            </div>
          </div>

          {/* Stats column */}
          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Patrimoine médian dans {HORIZONS[horizonIdx].label}</span>
              </div>
              {(() => {
                const last = result.monthly.at(-1)
                return (
                  <>
                    <p className="text-xl font-black text-gray-900">{fmt(last?.networth_p50 ?? 0)}</p>
                    <p className="text-xs text-gray-400">Fourchette: {fmt(last?.networth_p10 ?? 0)} – {fmt(last?.networth_p90 ?? 0)}</p>
                  </>
                )
              })()}
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cash-flow moyen</span>
              </div>
              <p className={`text-xl font-black ${result.mu_monthly_cashflow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {result.mu_monthly_cashflow >= 0 ? '+' : ''}{fmt(result.mu_monthly_cashflow)}/mois
              </p>
              <p className="text-xs text-gray-400">σ = {fmt(result.sigma_monthly_cashflow)}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Solvabilité</span>
              </div>
              {(() => {
                const last = result.monthly.at(-1)
                const solvent = last ? (last.balance_p10 >= 0 ? 100 : last.balance_p25 >= 0 ? 75 : last.balance_p50 >= 0 ? 50 : 25) : 0
                const color = solvent >= 75 ? 'text-emerald-600' : solvent >= 50 ? 'text-amber-500' : 'text-red-500'
                return <p className={`text-xl font-black ${color}`}>{solvent}%</p>
              })()}
              <p className="text-xs text-gray-400">Prob. balance liquide ≥ 0</p>
            </div>
          </div>
        </div>
      )}

      {/* Scenarios panel */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            Scénarios What-If
          </h2>
          <button
            onClick={() => setShowScForm(f => !f)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>

        {/* Scenario form */}
        {showScForm && (
          <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-200 space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Type de scénario</label>
              <select
                value={scType}
                onChange={e => setScType(e.target.value as ScenarioItem['type'])}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {SCENARIO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {scType === 'expense_reduction' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Réduction (%)</label>
                    <input
                      type="number" value={scPct} onChange={e => setScPct(e.target.value)} min={0} max={100}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Catégorie (optionnel)</label>
                    <input
                      type="text" value={scCategory} onChange={e => setScCategory(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="Restaurants"
                    />
                  </div>
                </>
              )}

              {(scType === 'income_increase' || scType === 'one_time_event' || scType === 'contribution_change') && (
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">
                    {scType === 'one_time_event' ? 'Montant (+ ou −)' : 'Montant (CHF/mois)'}
                  </label>
                  <input
                    type="number" value={scAmount} onChange={e => setScAmount(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder={scType === 'one_time_event' ? '-5000' : '500'}
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Débute au mois n°</label>
                <input
                  type="number" value={scMonth} onChange={e => setScMonth(e.target.value)} min={1}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="1"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowScForm(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={addScenario}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Ajouter
              </button>
            </div>
          </div>
        )}

        {/* Active scenarios */}
        {scenarios.length > 0 ? (
          <div className="space-y-2">
            {scenarios.map((sc, i) => (
              <div key={i} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
                <span className="text-sm text-gray-700">{scenarioLabel(sc)}</span>
                <button
                  onClick={() => setScenarios(prev => prev.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-500 transition-colors ml-3"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">
            Aucun scénario actif. Ajoutez-en un pour voir l'impact sur votre patrimoine.
          </p>
        )}
      </div>
    </div>
  )
}
