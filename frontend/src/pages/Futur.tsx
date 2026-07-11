import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, Flame, Settings2, Plus, X, ChevronDown, ChevronUp,
  Target, AlertTriangle, Sparkles, HelpCircle, PiggyBank, CheckCircle2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  api, InvestmentSettings, MonthlySimPoint, SimulationResult, ScenarioItem, CashflowSummary, Category,
} from '../api'

// ── Scenario persistence (cookie) ─────────────────────────────────────────────

const SCENARIOS_COOKIE = 'futur_scenarios'

function loadScenariosFromCookie(): ScenarioItem[] {
  const match = document.cookie.match(new RegExp(`(?:^|; )${SCENARIOS_COOKIE}=([^;]*)`))
  if (!match) return []
  try {
    return JSON.parse(decodeURIComponent(match[1]))
  } catch {
    return []
  }
}

function saveScenariosToCookie(scenarios: ScenarioItem[]) {
  const value = encodeURIComponent(JSON.stringify(scenarios))
  document.cookie = `${SCENARIOS_COOKIE}=${value}; max-age=31536000; path=/; samesite=lax`
}

// ── Chart value-mode persistence (cookie) — no backend field for this display-only toggle ──

const VALUE_MODE_COOKIE = 'futur_value_mode'

function loadValueModeFromCookie(): 'real' | 'nominal' {
  const match = document.cookie.match(new RegExp(`(?:^|; )${VALUE_MODE_COOKIE}=([^;]*)`))
  return match?.[1] === 'nominal' ? 'nominal' : 'real'
}

function saveValueModeToCookie(mode: 'real' | 'nominal') {
  document.cookie = `${VALUE_MODE_COOKIE}=${mode}; max-age=31536000; path=/; samesite=lax`
}

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

// ── History window presets (for the leftover/invested cashflow analysis) ──────

const HISTORY_WINDOWS: { label: string; months: number | null }[] = [
  { label: '1 mois',          months: 1 },
  { label: '3 mois',          months: 3 },
  { label: '6 mois',          months: 6 },
  { label: '1 an',            months: 12 },
  { label: '2 ans',           months: 24 },
  { label: '5 ans',           months: 60 },
  { label: 'Depuis toujours', months: null },
]

function availableHistoryWindows(historyMonths: number) {
  return HISTORY_WINDOWS.filter(w => w.months === null || w.months <= historyMonths)
}

// Prefer a 1-year window; fall back to the largest window the data actually
// supports, so we never suggest "5 ans" when there's only 1 year of history.
function defaultHistoryWindow(historyMonths: number): number | null {
  const avail = availableHistoryWindows(historyMonths)
  if (avail.some(w => w.months === 12)) return 12
  const largestFinite = [...avail].reverse().find(w => w.months !== null)
  return largestFinite ? largestFinite.months : null
}

// Chart row: a simulation month, plus the baseline (no-scenario) p50 for comparison,
// plus stacked-band segments for the currently selected view (see chartData below).
type ChartPoint = MonthlySimPoint & {
  baseline_networth_p50?: number
  baseline_balance_p50?: number
  baseline_portfolio_p50?: number
  band_base?: number
  band_10_25?: number
  band_25_75?: number
  band_75_90?: number
}

// All dollar-valued percentile fields — scaled when displaying in nominal terms
const MONEY_FIELDS = [
  'balance_p10', 'balance_p25', 'balance_p50', 'balance_p75', 'balance_p90',
  'portfolio_p10', 'portfolio_p25', 'portfolio_p50', 'portfolio_p75', 'portfolio_p90',
  'networth_p10', 'networth_p25', 'networth_p50', 'networth_p75', 'networth_p90',
] as const satisfies readonly (keyof Omit<MonthlySimPoint, 'month'>)[]

// ── Scenario helpers ──────────────────────────────────────────────────────────

const SCENARIO_TYPES = [
  { value: 'expense_reduction',  label: '📉 Ajuster une dépense' },
  { value: 'recurring_cashflow', label: '🔁 Revenu/dépense récurrent(e)' },
  { value: 'one_time_event',     label: '🎯 Événement ponctuel' },
  { value: 'contribution_change',label: '📈 Changer la contribution mensuelle' },
]

const FREQUENCIES = [
  { value: 'daily',   label: 'Quotidien',    perMonth: '/jour' },
  { value: 'weekly',  label: 'Hebdomadaire', perMonth: '/semaine' },
  { value: 'monthly', label: 'Mensuel',      perMonth: '/mois' },
  { value: 'yearly',  label: 'Annuel',       perMonth: '/an' },
] as const

function scenarioLabel(sc: ScenarioItem): string {
  const from = `dès ${monthsToLabel(sc.start_month)}`
  switch (sc.type) {
    case 'expense_reduction': {
      const pct = sc.percent_change ?? 0
      return `📉 Dépenses ${pct >= 0 ? '+' : ''}${pct}%${sc.category ? ` (${sc.category})` : ''} (${from})`
    }
    case 'recurring_cashflow': {
      const freq = FREQUENCIES.find(f => f.value === sc.frequency) ?? FREQUENCIES[2]
      const amt = sc.amount ?? 0
      return `🔁 ${amt >= 0 ? '+' : ''}${fmt(amt)}${freq.perMonth} (${from}) → ${sc.target === 'investment' ? 'investissement' : 'compte bancaire'}`
    }
    case 'one_time_event':      return `🎯 Événement: ${(sc.amount ?? 0) >= 0 ? '+' : ''}${fmt(sc.amount ?? 0)} au mois ${sc.start_month} → ${sc.target === 'investment' ? 'investissement' : 'compte bancaire'}`
    case 'contribution_change': return `📈 Contribution → ${fmt(sc.amount ?? 0)}/mois (${from})`
    default: return sc.type
  }
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ payload?: ChartPoint }>
  label?: string
  view: ViewMode
  hasBaseline: boolean
}

function CustomTooltip({ active, payload, label, view, hasBaseline }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  const at = (pct: string) => d[`${view}_${pct}` as keyof MonthlySimPoint] as number
  const keys = { p10: at('p10'), p25: at('p25'), p50: at('p50'), p75: at('p75'), p90: at('p90') }

  const baseline = hasBaseline ? d[`baseline_${view}_p50` as keyof ChartPoint] as number | undefined : undefined
  const delta = baseline !== undefined ? keys.p50 - baseline : undefined

  return (
    <div className="bg-gray-900 text-white rounded-xl px-4 py-3 shadow-2xl text-sm border border-gray-700 min-w-[200px]">
      <p className="font-semibold text-gray-300 mb-2">{label ? fmtMonth(label) : ''}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6"><span className="text-emerald-400">Optimiste (p90)</span><span className="font-bold">{fmt(keys.p90)}</span></div>
        <div className="flex justify-between gap-6"><span className="text-blue-400">Probable (p50)</span><span className="font-bold">{fmt(keys.p50)}</span></div>
        <div className="flex justify-between gap-6"><span className="text-orange-400">Pessimiste (p10)</span><span className="font-bold">{fmt(keys.p10)}</span></div>
        {delta !== undefined && (
          <div className="flex justify-between gap-6 pt-1.5 mt-1.5 border-t border-gray-700">
            <span className="text-purple-400">Impact scénarios</span>
            <span className={`font-bold ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {delta >= 0 ? '+' : ''}{fmt(delta)}
            </span>
          </div>
        )}
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

// ── Info tooltip ("little helper") ────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  const [align, setAlign] = useState<'center' | 'left' | 'right'>('center')
  const iconRef = useRef<HTMLSpanElement>(null)

  // Measure on hover so the tooltip flips away from whichever edge it's
  // close to, instead of always centering (which pushes it off-screen
  // for icons near the left/right edge of the viewport).
  function handleEnter() {
    const rect = iconRef.current?.getBoundingClientRect()
    if (!rect) return
    const halfWidth = 130 // ~half of the tooltip's w-56 (224px) + a little buffer
    if (rect.left < halfWidth) setAlign('left')
    else if (window.innerWidth - rect.right < halfWidth) setAlign('right')
    else setAlign('center')
  }

  const posClass =
    align === 'left'  ? 'left-0' :
    align === 'right' ? 'right-0' :
    'left-1/2 -translate-x-1/2'

  return (
    <span ref={iconRef} className="group relative inline-flex items-center" onMouseEnter={handleEnter}>
      <HelpCircle className="w-3.5 h-3.5 text-gray-300 hover:text-gray-500 cursor-help" />
      <span className={`pointer-events-none absolute ${posClass} bottom-full mb-2 w-56 rounded-lg bg-gray-900 text-white text-xs normal-case tracking-normal font-normal leading-snug p-2.5 opacity-0 scale-95 origin-bottom group-hover:opacity-100 group-hover:scale-100 transition-all z-20 shadow-2xl`}>
        {text}
      </span>
    </span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, iconColorClass, label, info, value, valueColorClass, caption,
}: {
  icon: LucideIcon
  iconColorClass: string
  label: string
  info: string
  value: string
  valueColorClass?: string
  caption?: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 min-w-0">
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 ${iconColorClass}`} />
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-0 break-words">{label}</span>
        <InfoTip text={info} />
      </div>
      <p className={`text-xl font-black break-words ${valueColorClass ?? 'text-gray-900'}`}>{value}</p>
      {caption && <p className="text-xs text-gray-400 mt-0.5 break-words">{caption}</p>}
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

  // Contribution mode: manual (fixed amount) vs auto (sweep excess above a liquid-balance target)
  const [contribMode, setContribMode] = useState<'manual' | 'auto'>('manual')

  // Liquid-balance target (buffer to always keep in cash, used by auto mode)
  const [targetLiquidInput, setTargetLiquidInput]           = useState('')  // raw input
  const [targetLiquidValue, setTargetLiquidValue]           = useState(0)   // live numeric value, drives the simulation immediately
  const [targetInflationAdjusted, setTargetInflationAdjusted] = useState(false)

  // Historical cashflow analysis (leftover / invested per month)
  const [cashflowWindow, setCashflowWindow]         = useState<number | null>(12)
  const [cashflowWindowInitialized, setCashflowWindowInitialized] = useState(false)
  const [cashflowSummary, setCashflowSummary]       = useState<CashflowSummary | null>(null)
  const [contribJustAdded, setContribJustAdded]     = useState<{ amount: number; newContrib: number } | null>(null)
  const [contribJustAddedFading, setContribJustAddedFading] = useState(false)

  // Simulation
  const [result, setResult]     = useState<SimulationResult | null>(null)
  const [baselineResult, setBaselineResult] = useState<SimulationResult | null>(null)  // no-scenario run, for what-if comparison
  const [fireResult, setFireResult] = useState<SimulationResult | null>(null)  // always run at the full 50-year horizon, for the FIRE timeline
  const [loading, setLoading]   = useState(false)
  const [horizonIdx, setHorizonIdx] = useState(4) // default 10 years
  const [view, setView]         = useState<ViewMode>('networth')
  // 'real' = today's purchasing power (what the engine computes natively);
  // 'nominal' = inflated back up to the actual future CHF amount, display-only.
  const [valueMode, setValueMode] = useState<'real' | 'nominal'>(loadValueModeFromCookie)
  useEffect(() => { saveValueModeToCookie(valueMode) }, [valueMode])

  // Scenarios (persisted to a cookie so they survive page reloads)
  const [scenarios, setScenarios]   = useState<ScenarioItem[]>(loadScenariosFromCookie)
  useEffect(() => { saveScenariosToCookie(scenarios) }, [scenarios])
  const [showScForm, setShowScForm] = useState(false)
  const [scType, setScType]         = useState<ScenarioItem['type']>('expense_reduction')
  const [scAmount, setScAmount]     = useState('')
  const [scPct, setScPct]           = useState('-20')
  const [scMonth, setScMonth]       = useState('1')
  const [scCategory, setScCategory] = useState('')
  const [scFrequency, setScFrequency] = useState<NonNullable<ScenarioItem['frequency']>>('monthly')
  const [scTarget, setScTarget]     = useState<NonNullable<ScenarioItem['target']>>('bank')
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    if (!showScForm) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowScForm(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showScForm])

  // Settings panel open/close
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [explainOpen, setExplainOpen]   = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const settingsLoadedRef = useRef(false)
  const settingsSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      setContribMode(s.contrib_mode)
      setTargetLiquidInput(s.target_liquid != null ? String(s.target_liquid) : '')
      setTargetLiquidValue(s.target_effective ?? s.target_liquid ?? 0)
      setTargetInflationAdjusted(s.target_inflation_adjusted)
      settingsLoadedRef.current = true
    })
    api.categories().then(setCategories)
  }, [])

  // ── Auto-save rendement/inflation/contribution mensuelle (debounced) so
  // slider tweaks aren't lost on reload without requiring an explicit save —
  // skipped until the initial load above completes, so we don't overwrite
  // stored settings with the sliders' default values first.
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    if (settingsSaveDebounceRef.current) clearTimeout(settingsSaveDebounceRef.current)
    settingsSaveDebounceRef.current = setTimeout(() => {
      api.saveInvestmentSettings({
        annual_rate:    annualRate,
        inflation_rate: inflationRate,
        ...(contribManuallySet ? { monthly_contrib: monthlyContrib } : {}),
      }).then(setSettings)
    }, 600)
    return () => { if (settingsSaveDebounceRef.current) clearTimeout(settingsSaveDebounceRef.current) }
  }, [annualRate, inflationRate, monthlyContrib, contribManuallySet])

  // ── Cleanup debounce on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  // ── Load cashflow analysis (re-fetch whenever the window changes) ────────
  useEffect(() => {
    if (!settings) return
    api.cashflowSummary(cashflowWindow ?? undefined).then(info => {
      setCashflowSummary(info)
      if (!cashflowWindowInitialized) {
        setCashflowWindowInitialized(true)
        // Only trigger a second fetch if the resolved default actually
        // differs from what we already fetched — avoids a redundant
        // round-trip (and the resulting flicker) on the common case.
        const def = defaultHistoryWindow(info.history_months_available)
        if (def !== cashflowWindow) setCashflowWindow(def)
      }
    })
  }, [settings, cashflowWindow, cashflowWindowInitialized])

  // ── Fade out the "contribution updated" confirmation after a few seconds ─
  useEffect(() => {
    if (!contribJustAdded) return
    const fadeTimer   = setTimeout(() => setContribJustAddedFading(true), 3200)
    const removeTimer = setTimeout(() => { setContribJustAdded(null); setContribJustAddedFading(false) }, 3700)
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer) }
  }, [contribJustAdded])

  // ── Run simulation (debounced) ────────────────────────────────────────────
  const runSim = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current
      setLoading(true)
      try {
        const baseParams = {
          months:          HORIZONS[horizonIdx].months,
          n_simulations:   1000,
          annual_rate:     annualRate,
          inflation_rate:  inflationRate,
          portfolio_value: portfolioValue,
          monthly_contrib: monthlyContrib,
          contrib_mode:    contribMode,
          // Only send a target once the user has actually set one — otherwise
          // targetLiquidValue defaults to 0, which the backend treats as a
          // real target and sweeps the entire liquid balance into the
          // portfolio every month (including going negative, since there's
          // no buffer left to protect).
          target_liquid:   contribMode === 'auto' && targetLiquidInput !== '' ? targetLiquidValue : undefined,
          // Shared across this run's calls so the scenario vs. baseline
          // comparison isolates the scenario's real effect instead of being
          // polluted by independently-drawn cashflow noise (each would
          // otherwise sample its own random future, making even a
          // scenario with zero effect on a given view show a nonzero
          // "Impact scénarios" purely by chance).
          seed:            Math.floor(Math.random() * 2 ** 31),
        }
        // When what-if scenarios are active, also run a no-scenario baseline
        // in parallel so the chart can show their impact by comparison.
        // The FIRE timeline (fire_months / pct_simulations_fire) is always
        // computed over the full 50-year horizon, independent of the
        // chart's own horizon selector — otherwise picking a short horizon
        // would make FIRE look unreachable just because the window is short.
        // Skip the extra request when the chart horizon already IS 50 years
        // — it would be an identical call to the main one.
        const alreadyMax = baseParams.months === 600
        const [res, baseRes, fireRes] = await Promise.all([
          api.simulate({ ...baseParams, scenarios }),
          scenarios.length > 0 ? api.simulate({ ...baseParams, scenarios: [] }) : Promise.resolve(null),
          alreadyMax ? Promise.resolve(null) : api.simulate({ ...baseParams, months: 600, scenarios }),
        ])
        // Drop stale responses from a superseded request (out-of-order network replies).
        if (requestId === requestIdRef.current) {
          setResult(res)
          setBaselineResult(baseRes)
          setFireResult(alreadyMax ? res : fireRes)
        }
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    }, 400)
  }, [annualRate, inflationRate, portfolioValue, monthlyContrib, horizonIdx, scenarios, contribMode, targetLiquidValue])

  useEffect(() => {
    if (settings !== null) runSim()
  }, [annualRate, inflationRate, portfolioValue, monthlyContrib, horizonIdx, scenarios, settings, contribMode, targetLiquidValue])

  // Real-terms → nominal (actual future CHF) factor for a given month offset
  const nominalFactor = (monthOffset: number) => (1 + inflationRate) ** (monthOffset / 12)

  // ── Chart data (merge baseline p50s in, scale to nominal if selected, thin out for long horizons) ───────
  const chartData: ChartPoint[] = (() => {
    if (!result) return []
    const data: ChartPoint[] = result.monthly.map((d, i) => {
      const f = valueMode === 'nominal' ? nominalFactor(i) : 1
      const scaled = { ...d }
      if (f !== 1) for (const k of MONEY_FIELDS) scaled[k] = d[k] * f
      const bd = baselineResult?.monthly[i]
      // Stacked-band segments (base offset + 3 increments) for the current
      // view, instead of drawing a full area and then painting an opaque
      // mask back over its bottom — the mask trick also hides the grid
      // lines underneath it all the way down to zero.
      const p10 = scaled[`${view}_p10`], p25 = scaled[`${view}_p25`]
      const p75 = scaled[`${view}_p75`], p90 = scaled[`${view}_p90`]
      return {
        ...scaled,
        baseline_networth_p50:  bd ? bd.networth_p50  * f : undefined,
        baseline_balance_p50:   bd ? bd.balance_p50   * f : undefined,
        baseline_portfolio_p50: bd ? bd.portfolio_p50 * f : undefined,
        band_base:   p10,
        band_10_25:  p25 - p10,
        band_25_75:  p75 - p25,
        band_75_90:  p90 - p75,
      }
    })
    const maxPoints = 120
    if (data.length <= maxPoints) return data
    const step = Math.ceil(data.length / maxPoints)
    return data.filter((_, i) => i % step === 0 || i === data.length - 1)
  })()

  // FIRE target as a single horizontal line only makes sense in real terms
  // (it's defined as 25× today's expenses); in nominal mode, scale it to
  // the horizon's end so it still lines up with where the curves land.
  const horizonMonths = HORIZONS[horizonIdx].months
  const fireNumber = result
    ? result.fire_number * (valueMode === 'nominal' ? nominalFactor(horizonMonths) : 1)
    : 0

  // ── Save settings to DB ───────────────────────────────────────────────────
  async function saveSettings() {
    if (manualPortfolio === '') return
    const updated = await api.saveInvestmentSettings({ manual_portfolio: Number(manualPortfolio) })
    setSettings(updated)
    setPortfolioValue(updated.effective_portfolio)
  }

  // ── Reset "Paramètres de simulation" to their defaults ────────────────────
  // Deliberately leaves "Valeur réelle (saisie manuelle)" (manualPortfolio)
  // untouched — that's a separate override the user asked to keep.
  async function resetSimulationParams() {
    setAnnualRate(0.07)
    setInflationRate(0.02)
    setValueMode('real')
    setContribMode('manual')
    const updated = await api.saveInvestmentSettings({
      annual_rate:     0.07,
      inflation_rate:  0.02,
      contrib_mode:    'manual',
      monthly_contrib: -1,
    })
    setSettings(updated)
    setContribManuallySet(false)
    setMonthlyContrib(updated.auto_monthly_contrib)
  }

  // ── Move the detected leftover into the monthly contribution ─────────────
  // Sets contribution to invested_per_month + leftover_per_month (i.e. average
  // net cashflow) rather than adding leftover on top of whatever's currently
  // saved — leftover is a historical figure that doesn't shrink after being
  // applied once, so adding it would let repeated clicks stack indefinitely.
  async function addLeftoverToContrib() {
    if (!cashflowSummary) return
    const amount = cashflowSummary.leftover_per_month
    const target = cashflowSummary.invested_per_month + amount
    const updated = await api.saveInvestmentSettings({
      monthly_contrib: target,
    })
    setSettings(updated)
    setMonthlyContrib(updated.effective_contrib)
    setContribManuallySet(true)
    setContribJustAdded({ amount, newContrib: updated.effective_contrib })
  }

  // ── Save the liquid-balance target (buffer to always keep in cash) ───────
  async function saveTargetLiquid() {
    const updated = await api.saveInvestmentSettings({
      target_liquid:              targetLiquidInput !== '' ? Number(targetLiquidInput) : -1,
      target_inflation_adjusted:  targetInflationAdjusted,
    })
    setSettings(updated)
    setTargetLiquidValue(updated.target_effective ?? updated.target_liquid ?? 0)
  }

  async function clearTargetLiquid() {
    const updated = await api.saveInvestmentSettings({ target_liquid: -1 })
    setSettings(updated)
    setTargetLiquidInput('')
    setTargetLiquidValue(0)
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
    if (scType === 'recurring_cashflow')  { sc.amount = Number(scAmount); sc.frequency = scFrequency; sc.target = scTarget }
    if (scType === 'one_time_event')      { sc.amount = Number(scAmount); sc.target = scTarget }
    if (scType === 'contribution_change') sc.amount = Number(scAmount)

    setScenarios(prev => [...prev, sc])
    setShowScForm(false)
    setScAmount(''); setScPct('-20'); setScMonth('1'); setScCategory(''); setScFrequency('monthly'); setScTarget('bank')
  }

  // ── FIRE labels ───────────────────────────────────────────────────────────
  const fireP10 = fireResult?.fire_months?.p10 ?? null
  const fireP50 = fireResult?.fire_months?.p50 ?? null
  const fireP90 = fireResult?.fire_months?.p90 ?? null

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

      {/* "Contribution updated" confirmation */}
      {contribJustAdded && (
        <div
          className={`bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-2.5 shadow-sm transition-opacity duration-500 ${
            contribJustAddedFading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="text-sm text-gray-700">
            Contribution mensuelle mise à jour : <strong className="text-emerald-700">{fmt(contribJustAdded.newContrib)}/mois</strong>
            {' '}(+{fmt(contribJustAdded.amount)})
          </p>
        </div>
      )}

      {/* Cashflow analysis: leftover / invested per month + buffer status */}
      {settingsOpen && cashflowSummary && (() => {
        const windows = availableHistoryWindows(cashflowSummary.history_months_available)
        const currentLabel = HISTORY_WINDOWS.find(w => w.months === cashflowWindow)?.label ?? 'Depuis toujours'
        const canAddToContrib = contribMode === 'manual' && cashflowSummary.leftover_per_month > 5 && cashflowSummary.above_target !== false
        return (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <PiggyBank className="w-5 h-5 text-purple-600 shrink-0" />
                <h2 className="text-sm font-semibold text-gray-700">Analyse de trésorerie — {currentLabel}</h2>
              </div>
              <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1">
                {windows.map(w => (
                  <button
                    key={w.label}
                    onClick={() => setCashflowWindow(w.months)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      cashflowWindow === w.months
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reste en moyenne / mois</p>
                <p className={`text-xl font-black ${cashflowSummary.leftover_per_month >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {cashflowSummary.leftover_per_month >= 0 ? '+' : ''}{fmt(cashflowSummary.leftover_per_month)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Investi en moyenne / mois</p>
                <p className="text-xl font-black text-blue-600">{fmt(cashflowSummary.invested_per_month)}</p>
              </div>
            </div>

            {contribMode === 'auto' && cashflowSummary.target_effective !== null && (
              <p className="text-xs text-gray-500">
                Solde actuel <strong className="text-gray-700">{fmt(cashflowSummary.current_liquid_balance)}</strong>
                {' '}—{' '}
                {cashflowSummary.above_target ? (
                  <span className="text-emerald-600 font-semibold">
                    {fmt(cashflowSummary.current_liquid_balance - cashflowSummary.target_effective)} au-dessus
                  </span>
                ) : (
                  <span className="text-red-500 font-semibold">
                    {fmt(cashflowSummary.target_effective - cashflowSummary.current_liquid_balance)} en-dessous
                  </span>
                )}
                {' '}de votre objectif de {fmt(cashflowSummary.target_effective)}.
              </p>
            )}

            {canAddToContrib && (
              <div className="flex justify-end">
                <button
                  onClick={addLeftoverToContrib}
                  className="px-4 py-1.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Ajouter à la contribution mensuelle (+{fmt(cashflowSummary.leftover_per_month)}/mois)
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Settings panel */}
      {settingsOpen && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* Left: sliders */}
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Paramètres de simulation</h2>
                <button
                  onClick={resetSimulationParams}
                  className="text-xs text-gray-400 hover:text-red-500 underline"
                >
                  Réinitialiser
                </button>
              </div>
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
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 inline-flex items-center gap-1">
                  Affichage du graphique
                  <InfoTip text="Réelle : montants en pouvoir d'achat d'aujourd'hui (un 100k dans 20 ans se lit comme 100k aujourd'hui). Nominale : montants regonflés à l'inflation — ce que votre compte affichera littéralement à cette date." />
                </span>
                <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1 w-fit">
                  {([
                    ['real',    'Valeur réelle (aujourd\'hui)'],
                    ['nominal', 'Valeur nominale (future)'],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setValueMode(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        valueMode === v
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-500 hover:text-gray-900 hover:bg-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  Mode de contribution
                  <InfoTip text="Manuel : vous fixez vous-même le montant investi chaque mois. Automatique : le montant à toujours garder en liquide est défini ci-dessous ; tout ce qui le dépasse est automatiquement investi chaque mois." />
                </span>
                <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1 w-fit">
                  {([
                    ['manual', 'Manuel'],
                    ['auto',   'Automatique'],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setContribMode(mode)
                        api.saveInvestmentSettings({ contrib_mode: mode }).then(setSettings)
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        contribMode === mode
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-500 hover:text-gray-900 hover:bg-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {contribMode === 'manual' ? (
                <div>
                  <Slider
                    label="Contribution mensuelle"
                    value={monthlyContrib}
                    min={0} max={10000} step={50}
                    format={v => fmt(v)}
                    onChange={v => { setMonthlyContrib(v); setContribManuallySet(true) }}
                  />
                  {contribManuallySet && (
                    <span className="inline-flex items-center gap-1 mt-1">
                      <button
                        onClick={clearContribOverride}
                        className="text-xs text-gray-400 hover:text-red-500 underline"
                      >
                        Revenir à la valeur calculée automatiquement ({fmt(settings?.auto_monthly_contrib ?? 0)})
                      </button>
                      <InfoTip text="Moyenne historique de ce qui a été effectivement investi chaque mois (catégorie Investissements), calculée sur tout votre historique de transactions." />
                    </span>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                        Montant cible (CHF)
                      </label>
                      <input
                        type="number"
                        placeholder="ex. 10000"
                        value={targetLiquidInput}
                        onChange={e => {
                          setTargetLiquidInput(e.target.value)
                          setTargetLiquidValue(e.target.value !== '' ? Number(e.target.value) : 0)
                        }}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
                      <input
                        type="checkbox"
                        checked={targetInflationAdjusted}
                        onChange={e => setTargetInflationAdjusted(e.target.checked)}
                        className="rounded border-gray-300 accent-blue-600"
                      />
                      Ajuster à l'inflation
                    </label>
                    <button
                      onClick={saveTargetLiquid}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Sauvegarder
                    </button>
                  </div>
                  {settings?.target_liquid != null && (
                    <>
                      {settings.target_inflation_adjusted && settings.target_effective != null && (
                        <p className="text-xs text-gray-400">
                          Objectif ajusté à l'inflation depuis le {settings.target_set_date} : {fmt(settings.target_effective)} aujourd'hui.
                        </p>
                      )}
                      <button
                        onClick={clearTargetLiquid}
                        className="text-xs text-gray-400 hover:text-red-500 underline"
                      >
                        Supprimer l'objectif
                      </button>
                    </>
                  )}
                </div>
              )}
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
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            Cône de probabilité — {
              view === 'networth' ? 'Patrimoine net (balance + portefeuille)' :
              view === 'portfolio' ? 'Portefeuille d\'investissement' : 'Balance liquide'
            }
            <InfoTip text="La zone ombrée couvre 80% des 1000 futurs simulés (p10 pessimiste à p90 optimiste). La ligne bleue est le résultat médian (p50) — celui qui a autant de chances d'être dépassé que non atteint." />
          </h2>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
              {valueMode === 'real' ? 'Valeur réelle' : 'Valeur nominale'}
              <InfoTip text={
                valueMode === 'real'
                  ? "Les montants sont exprimés en pouvoir d'achat d'aujourd'hui — un 100k dans 20 ans se lit comme 100k aujourd'hui. Modifiable dans les Paramètres."
                  : "Les montants sont regonflés à l'inflation projetée — ce que votre compte affichera littéralement à cette date future. Modifiable dans les Paramètres."
              } />
            </span>
            {loading && (
              <span className="text-xs text-blue-500 animate-pulse">Calcul en cours…</span>
            )}
          </div>
        </div>
        {baselineResult && (
          <p className="text-xs text-gray-400 mb-3 flex items-center gap-1.5">
            <span className="inline-block w-3 border-t-2 border-dashed border-gray-400" />
            Sans scénarios · <span className="inline-block w-3 border-t-2 border-dashed border-purple-400" /> Début d'un scénario
          </p>
        )}

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
              <Tooltip content={(props) => <CustomTooltip {...props} view={view} hasBaseline={!!baselineResult} />} />

              {/* p10–p90 probability band, built as stacked increments (base offset
                  + 3 segments) instead of an opaque mask painted back over the
                  bottom of a full area — that mask trick also hid the grid
                  lines underneath it all the way down to zero. */}
              {/* Colors below use the app's theme CSS variables (not raw hex)
                  so the chart tracks whichever theme is active, matching the
                  Tailwind-styled tooltip/legend text right next to it —
                  gray/blue are the two families this app remaps per theme
                  (see tailwind.config.js + index.css); a fixed hex here would
                  drift from the legend's color under any non-default theme,
                  and could end up low-contrast against some theme backgrounds. */}
              <Area type="monotone" dataKey="band_base"  stackId="band" stroke="none" fill="none" />
              <Area type="monotone" dataKey="band_10_25" stackId="band" stroke="none" fill="var(--blue-200)" fillOpacity={0.35} />
              <Area type="monotone" dataKey="band_25_75" stackId="band" stroke="none" fill="var(--blue-300)" fillOpacity={0.45} />
              <Area type="monotone" dataKey="band_75_90" stackId="band" stroke="none" fill="var(--blue-200)" fillOpacity={0.35} />

              {/* Invisible lines just to get colored hover dots on p90/p10,
                  matching the tooltip's Optimiste/Pessimiste rows */}
              <Line
                type="monotone"
                dataKey={`${view}_p90`}
                name="p90 (optimiste)"
                stroke="none"
                dot={false}
                activeDot={{ r: 4, fill: '#34d399', stroke: 'var(--color-white)', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey={`${view}_p10`}
                name="p10 (pessimiste)"
                stroke="none"
                dot={false}
                activeDot={{ r: 4, fill: '#fb923c', stroke: 'var(--color-white)', strokeWidth: 1 }}
              />

              {/* Median line */}
              <Line
                type="monotone"
                dataKey={`${view}_p50`}
                name="Médiane (p50)"
                stroke="var(--blue-600)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: 'var(--blue-400)', stroke: 'var(--color-white)', strokeWidth: 1 }}
              />

              {/* Baseline (no what-if scenarios) median, for comparison */}
              {baselineResult && (
                <Line
                  type="monotone"
                  dataKey={`baseline_${view}_p50`}
                  name="Sans scénarios"
                  stroke="var(--gray-400)"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={false}
                />
              )}

              {/* FIRE line — drawn last so it renders on top of the probability band */}
              {fireNumber > 0 && (
                <ReferenceLine
                  y={fireNumber}
                  stroke="#f59e0b"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{ value: `🎯 FIRE ${fmtSm(fireNumber)}`, position: 'insideTopRight', fontSize: 11, fill: '#f59e0b' }}
                />
              )}

              {/* Mark where each what-if scenario kicks in */}
              {scenarios.map((sc, i) => {
                const monthLabel = result.monthly[sc.start_month]?.month
                if (!monthLabel) return null
                const icon = SCENARIO_TYPES.find(t => t.value === sc.type)?.label.split(' ')[0] ?? '•'
                return (
                  <ReferenceLine
                    key={i}
                    x={monthLabel}
                    stroke="#c084fc"
                    strokeDasharray="2 3"
                    strokeWidth={1.5}
                    label={{ value: icon, position: 'insideBottom', fontSize: 13 }}
                  />
                )
              })}
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

      {/* Summary stats */}
      {result && (() => {
        const last = result.monthly.at(-1)
        const lastFactor = valueMode === 'nominal' ? nominalFactor(horizonMonths) : 1
        const solvent = result.pct_solvent_final
        const solventValueClass = solvent >= 90 ? 'text-emerald-600' : solvent >= 60 ? 'text-amber-500' : 'text-red-500'
        const solventIconClass  = solvent >= 60 ? 'text-orange-500' : 'text-red-500'
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={Flame} iconColorClass="text-amber-500"
                label="Capital FIRE"
                value={fmt(result.fire_number)}
                valueColorClass="text-amber-600"
                caption={`= ${fmt(result.annual_expenses_median)} dépenses/an × 25`}
                info="La règle des 4% : une fois votre portefeuille égal à 25× vos dépenses annuelles, vous pouvez théoriquement en retirer 4%/an indéfiniment. C'est le capital visé pour l'indépendance financière (FIRE)."
              />
              <StatCard
                icon={Target} iconColorClass="text-blue-500"
                label={`Patrimoine dans ${HORIZONS[horizonIdx].label}`}
                value={fmt((last?.networth_p50 ?? 0) * lastFactor)}
                caption={`Fourchette p10–p90 : ${fmt((last?.networth_p10 ?? 0) * lastFactor)} – ${fmt((last?.networth_p90 ?? 0) * lastFactor)}`}
                info="Patrimoine net médian (balance liquide + portefeuille) parmi les 1000 futurs simulés, à la fin de l'horizon choisi. La fourchette va du scénario pessimiste (p10) à optimiste (p90)."
              />
              <StatCard
                icon={Sparkles} iconColorClass="text-purple-500"
                label="Cash-flow moyen"
                value={`${result.mu_monthly_cashflow >= 0 ? '+' : ''}${fmt(result.mu_monthly_cashflow)}/mois`}
                valueColorClass={result.mu_monthly_cashflow >= 0 ? 'text-emerald-600' : 'text-red-500'}
                caption={`Variabilité typique (σ) : ± ${fmt(result.sigma_monthly_cashflow)}`}
                info="Revenus moins dépenses hors investissements, projetés mois par mois à partir de votre historique. σ (l'écart-type) indique de combien ce chiffre varie généralement d'un mois à l'autre — plus il est grand, plus le cône du graphique est large."
              />
              <StatCard
                icon={AlertTriangle} iconColorClass={solventIconClass}
                label="Solvabilité"
                value={`${solvent.toFixed(0)}%`}
                valueColorClass={solventValueClass}
                caption={`Balance liquide ≥ 0 dans ${HORIZONS[horizonIdx].label}`}
                info="Pourcentage des 1000 futurs simulés où votre balance liquide (hors portefeuille d'investissement) ne tombe jamais sous zéro d'ici la fin de l'horizon choisi."
              />
            </div>

            {/* FIRE timeline */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <div className="flex items-center gap-1.5 mb-4">
                <Flame className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-gray-700">Quand atteindrez-vous le FIRE ?</h3>
                <InfoTip text="Mois estimé où votre portefeuille d'investissement seul (hors balance liquide) dépasse le capital FIRE ci-dessus, pour les scénarios optimiste (p10), médian (p50) et pessimiste (p90) parmi les futurs simulés." />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-xs text-emerald-600 font-semibold">Optimiste (p10)</p>
                  <p className="text-sm font-bold text-gray-900 mt-1">{monthsToLabel(fireP10)}</p>
                </div>
                <div className="text-center border-x border-gray-100">
                  <p className="text-xs text-amber-600 font-semibold">Médian (p50)</p>
                  <p className="text-sm font-bold text-gray-900 mt-1">{monthsToLabel(fireP50)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-orange-500 font-semibold">Pessimiste (p90)</p>
                  <p className="text-sm font-bold text-gray-900 mt-1">{monthsToLabel(fireP90)}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-amber-400 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, fireResult?.pct_simulations_fire ?? 0)}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-amber-600 whitespace-nowrap">
                  {(fireResult?.pct_simulations_fire ?? 0).toFixed(0)}% des simulations atteignent le FIRE (sur 50 ans)
                </span>
              </div>
            </div>
          </>
        )
      })()}

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
                {SCENARIO_TYPES
                  .filter(t => contribMode !== 'auto' || t.value !== 'contribution_change')
                  .map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {scType === 'expense_reduction' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Variation (%, + ou −)</label>
                    <input
                      type="number" value={scPct} onChange={e => setScPct(e.target.value)} min={-100}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="-20 (baisse) ou 20 (hausse)"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Catégorie (optionnel)</label>
                    <select
                      value={scCategory} onChange={e => setScCategory(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="">Toutes les catégories</option>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {scType === 'recurring_cashflow' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Montant (+ ou −)</label>
                    <input
                      type="number" value={scAmount} onChange={e => setScAmount(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Fréquence</label>
                    <select
                      value={scFrequency} onChange={e => setScFrequency(e.target.value as ScenarioItem['frequency'] & string)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                </>
              )}

              {(scType === 'one_time_event' || scType === 'contribution_change') && (
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

              {(scType === 'one_time_event' || scType === 'recurring_cashflow') && (
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Destination</label>
                  <select
                    value={scTarget} onChange={e => setScTarget(e.target.value as NonNullable<ScenarioItem['target']>)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="bank">🏦 Compte bancaire</option>
                    <option value="investment">📈 Investissement</option>
                  </select>
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
            {scenarios.map((sc, i) => {
              // contribution_change scenarios have no effect once switched to
              // auto mode (contribution isn't a fixed amount there) — flag
              // them as inactive instead of silently ignoring them.
              const inactive = sc.type === 'contribution_change' && contribMode === 'auto'
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-xl px-4 py-2.5 border ${
                    inactive ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-100'
                  }`}
                >
                  <span className={`text-sm ${inactive ? 'text-gray-400' : 'text-gray-700'}`}>
                    {scenarioLabel(sc)}
                    {inactive && ' — sans effet en mode Automatique'}
                  </span>
                  <button
                    onClick={() => setScenarios(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 transition-colors ml-3"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">
            Aucun scénario actif. Ajoutez-en un pour voir l'impact sur votre patrimoine.
          </p>
        )}
      </div>

      {/* Explanation: how the forecast is actually computed, with real numbers */}
      {result && (() => {
        const historyMonths = cashflowSummary?.history_months_available ?? null
        const seasonal = historyMonths !== null && historyMonths >= 24
        const sinceLabel = historyMonths !== null ? monthsToLabel(-(historyMonths - 1)) : null
        return (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
            <button
              onClick={() => setExplainOpen(o => !o)}
              className="w-full flex items-center justify-between p-6 text-left"
            >
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-gray-400" />
                Comment cette prévision est-elle calculée ?
              </h2>
              {explainOpen ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
            </button>
            {explainOpen && (
              <div className="px-6 pb-6 space-y-3 text-sm text-gray-600 border-t border-gray-100 pt-4">
                <p>
                  {historyMonths !== null
                    ? <>Nous utilisons tout votre historique disponible : <strong>{historyMonths} mois</strong>, depuis environ <strong>{sinceLabel}</strong>.</>
                    : 'Nous utilisons tout votre historique de transactions disponible.'
                  }{' '}
                  Chaque mois, le cash-flow net = revenus − dépenses, en excluant les virements internes, les
                  transactions annulées, et les catégories marquées comme épargne/investissement ou ignorées.
                </p>
                <p>
                  {seasonal ? (
                    <>Avec {historyMonths} mois d'historique (≥ 24), un modèle de prévision saisonnière (AutoETS) est utilisé :
                    il détecte la tendance et les cycles annuels (ex : dépenses plus élevées en décembre) plutôt que
                    d'appliquer une simple moyenne constante.</>
                  ) : (
                    <>Avec seulement {historyMonths ?? '?'} mois d'historique (moins de 24), il n'y a pas assez de données pour
                    détecter une saisonnalité fiable : une moyenne simple de ces mois est utilisée à la place.</>
                  )}
                </p>
                <p>
                  Résultat pour votre compte : cash-flow net prévu de{' '}
                  <strong className={result.mu_monthly_cashflow >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                    {result.mu_monthly_cashflow >= 0 ? '+' : ''}{fmt(result.mu_monthly_cashflow)}/mois
                  </strong>{' '}
                  en moyenne, avec une variabilité typique (écart-type) de <strong>± {fmt(result.sigma_monthly_cashflow)}</strong> —
                  c'est cette variabilité qui détermine la largeur du cône de probabilité sur le graphique ci-dessus.
                </p>
                <p>
                  Au-delà de 5 ans (60 mois), le modèle cesse d'extrapoler la tendance — les modèles de prévision
                  peuvent dériver de façon irréaliste sur plusieurs décennies — et répète simplement à l'identique
                  le dernier cycle de 12 mois prévu pour les mois suivants.
                </p>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
