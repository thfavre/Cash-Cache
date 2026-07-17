import { useEffect, useRef, useState } from 'react'
import { Upload, FileText, Wallet, Trash2, Info, FileQuestion, Inbox, ChevronDown, AlertTriangle } from 'lucide-react'
import {
  api, ManagedAccount, ImportAccountOption, ImportAmountMode, ImportBankProfile,
  ImportBatchList, ImportMapping, ImportUploadResult,
} from '../api'
import ConfirmDialog from '../components/ConfirmDialog'
import InfoTip from '../components/InfoTip'

const inputClass = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500'

// Must match backend/routes/import_data.py's WIPE_ALL_CONFIRMATION exactly —
// the server checks it too, this is just the first line of defense.
const WIPE_ALL_CONFIRMATION = 'TOUT SUPPRIMER'

function WipeAllDialog({ onConfirm, onCancel, busy }: { onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  const [text, setText] = useState('')
  const ready = text === WIPE_ALL_CONFIRMATION

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/30"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-4 border-2 border-red-200">
        <div className="flex items-center gap-2 text-red-600">
          <AlertTriangle size={20} />
          <h2 className="text-base font-bold">Tout supprimer</h2>
        </div>
        <p className="text-sm text-gray-700">
          Cette action supprime <span className="font-semibold">définitivement TOUTES les données</span> :
          comptes, transactions, catégories personnalisées, budgets, historique, mappings CSV enregistrés,
          et les fichiers bancaires importés. <span className="font-semibold">Il n'y a aucun moyen d'annuler.</span>
        </p>
        <p className="text-sm text-gray-500">
          Pour confirmer, tapez <span className="font-mono font-semibold text-gray-800">{WIPE_ALL_CONFIRMATION}</span> ci-dessous :
        </p>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && ready && !busy) onConfirm() }}
          className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
          placeholder={WIPE_ALL_CONFIRMATION}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={!ready || busy}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Suppression…' : 'Tout supprimer définitivement'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-CH')
}

// A dropdown whose placeholder only ever shows in the closed state — a
// native <select> would list the placeholder as a selectable row too.
function CustomSelect({
  value, placeholder, options, onSelect, className,
}: {
  value: string
  placeholder: string
  options: { value: string; label: string }[]
  onSelect: (value: string) => void
  className: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className={selected ? '' : 'text-gray-400'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onSelect(o.value); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FieldLabel({ children, hint, wide }: { children: React.ReactNode; hint: string; wide?: boolean }) {
  return (
    <label className="text-xs text-gray-500 flex items-center gap-1">
      {children}
      <InfoTip text={hint} wide={wide} />
    </label>
  )
}

const DEFAULT_CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP', 'JPY', 'CAD']
const CUSTOM_CURRENCIES_KEY = 'importCustomCurrencies'
const OTHER_CURRENCY = '__other__'

function loadCustomCurrencies(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_CURRENCIES_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(c => typeof c === 'string') : []
  } catch {
    return []
  }
}

const KIND_LABEL: Record<string, string> = {
  camt: 'CAMT.053',
  revolut: 'Revolut CSV',
  generic_csv: 'CSV (mapping manuel)',
}

interface MappingState {
  uploadId: string
  headers: string[]
  sampleRows: string[][]
  accounts: ImportAccountOption[]
  suggestedProfile: ImportBankProfile | null
  mapping: ImportMapping
  accountMode: 'existing' | 'new'
  accountId: number | null
  newAccountName: string
  newAccountCurrency: string
  newAccountCurrencyCustom: boolean
  saveProfileName: string
}

function defaultMapping(delimiter: string, decimalSeparator: string): ImportMapping {
  return {
    delimiter,
    date_column: '',
    date_format: '%d.%m.%Y',
    description_column: null,
    counterparty_column: null,
    amount_mode: 'single_signed',
    amount_column: null,
    type_column: null,
    credit_value: null,
    debit_column: null,
    credit_column: null,
    decimal_separator: decimalSeparator,
  }
}

interface ImportPageProps {
  onContinueWithoutData?: () => void
  onDataChanged?: () => void
}

export default function Import({ onContinueWithoutData, onDataChanged }: ImportPageProps = {}) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [batchList, setBatchList] = useState<ImportBatchList | null>(null)
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: number[]; message: string } | null>(null)
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState<{ id: number; message: string } | null>(null)
  const [wipeAllOpen, setWipeAllOpen] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [mappingState, setMappingState] = useState<MappingState | null>(null)
  const [submittingMapping, setSubmittingMapping] = useState(false)
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set())
  const [customCurrencies, setCustomCurrencies] = useState<string[]>(loadCustomCurrencies)
  const currencyOptions = [...DEFAULT_CURRENCIES, ...customCurrencies.filter(c => !DEFAULT_CURRENCIES.includes(c))]

  useEffect(() => {
    if (!mappingState) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMappingState(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mappingState])

  function saveCustomCurrency(code: string) {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed || currencyOptions.includes(trimmed)) return
    const next = [...customCurrencies, trimmed]
    setCustomCurrencies(next)
    localStorage.setItem(CUSTOM_CURRENCIES_KEY, JSON.stringify(next))
  }
  const fileInputRef = useRef<HTMLInputElement>(null)

  function load() {
    Promise.all([api.accountsManage(), api.importBatches()]).then(([a, b]) => {
      setAccounts(a)
      setBatchList(b)
      setInitialLoading(false)
      onDataChanged?.()
    })
  }

  async function toggleAccountActive(acct: ManagedAccount) {
    try {
      const updated = await api.updateAccount(acct.id, { is_active: !acct.is_active })
      setAccounts(prev => prev.map(a => a.id === acct.id ? { ...a, is_active: updated.is_active } : a))
    } catch (e: any) {
      setError('Erreur: ' + e.message)
    }
  }

  function handleDeleteAccount(acct: ManagedAccount) {
    setDeleteAccountConfirm({
      id: acct.id,
      message: `Supprimer le compte "${acct.name}" et ses ${acct.transaction_count} transaction(s) ? Cette action est irréversible.`,
    })
  }

  async function confirmDeleteAccount() {
    if (!deleteAccountConfirm) return
    const { id } = deleteAccountConfirm
    setDeleteAccountConfirm(null)
    try {
      await api.deleteAccount(id)
      load()
    } catch (e: any) {
      setError('Erreur: ' + e.message)
    }
  }

  async function confirmWipeAll() {
    setWiping(true)
    setError('')
    try {
      await api.wipeAllData(WIPE_ALL_CONFIRMATION)
      // The server side is gone; also clear everything the browser itself
      // kept (theme choice, "tutorial seen" flag, custom currencies, any
      // cookie) and reload so the app re-initializes from a truly blank
      // slate instead of carrying stale client-side state forward.
      localStorage.clear()
      sessionStorage.clear()
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.split('=')[0].trim()
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
      }
      window.location.reload()
    } catch (e: any) {
      setError('Erreur: ' + e.message)
      setWiping(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    setMsg('')
    try {
      const result: ImportUploadResult = await api.uploadImport(file)
      if (result.status === 'imported') {
        if (result.transactions > 0) {
          setMsg(`✓ ${result.transactions} transaction(s) importée(s) sur ${result.accounts} compte(s).`)
        } else {
          setMsg('Rien à importer — toutes les transactions de ce fichier étaient déjà présentes.')
        }
        load()
      } else {
        setMappingState({
          uploadId: result.upload_id,
          headers: result.headers,
          sampleRows: result.sample_rows,
          accounts: result.accounts,
          suggestedProfile: result.suggested_profile,
          mapping: result.suggested_profile
            ? result.suggested_profile.mapping
            : defaultMapping(result.delimiter, result.decimal_separator),
          accountMode: 'new',
          accountId: result.accounts[0]?.id ?? null,
          newAccountName: '',
          newAccountCurrency: '',
          newAccountCurrencyCustom: false,
          saveProfileName: '',
        })
        setInvalidFields(new Set())
      }
    } catch (e: any) {
      setError('Erreur: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  function applySuggestedProfile() {
    if (!mappingState?.suggestedProfile) return
    setMappingState({ ...mappingState, mapping: mappingState.suggestedProfile.mapping })
  }

  function validateMapping(state: MappingState): Set<string> {
    const invalid = new Set<string>()
    const m = state.mapping
    if (!m.date_column) invalid.add('date_column')
    if (!m.date_format.trim()) invalid.add('date_format')
    if (m.amount_mode === 'separate_debit_credit') {
      if (!m.debit_column) invalid.add('debit_column')
      if (!m.credit_column) invalid.add('credit_column')
    } else {
      if (!m.amount_column) invalid.add('amount_column')
      if (m.amount_mode === 'single_unsigned_with_type') {
        if (!m.type_column) invalid.add('type_column')
        if (!m.credit_value?.trim()) invalid.add('credit_value')
      }
    }
    if (state.accountMode === 'existing') {
      if (!state.accountId) invalid.add('account')
    } else {
      if (!state.newAccountName.trim()) invalid.add('account')
      if (!state.newAccountCurrency.trim()) invalid.add('currency')
    }
    return invalid
  }

  function clearInvalid(...keys: string[]) {
    setInvalidFields(prev => {
      if (!keys.some(k => prev.has(k))) return prev
      const next = new Set(prev)
      keys.forEach(k => next.delete(k))
      return next
    })
  }

  async function submitMapping() {
    if (!mappingState) return
    const invalid = validateMapping(mappingState)
    if (invalid.size > 0) {
      setInvalidFields(invalid)
      setError('Merci de remplir les champs surlignés.')
      return
    }
    setInvalidFields(new Set())
    setSubmittingMapping(true)
    setError('')
    try {
      const payload: Parameters<typeof api.mapImport>[1] = {
        mapping: mappingState.mapping,
        save_profile_name: mappingState.saveProfileName || undefined,
      }
      if (mappingState.accountMode === 'existing') {
        payload.account_id = mappingState.accountId!
      } else {
        payload.new_account = { name: mappingState.newAccountName, currency: mappingState.newAccountCurrency }
      }
      const result = await api.mapImport(mappingState.uploadId, payload)
      if (result.status === 'imported') {
        setMsg(result.transactions > 0
          ? `✓ ${result.transactions} transaction(s) importée(s).`
          : 'Rien à importer — toutes les transactions de ce fichier étaient déjà présentes.')
        setMappingState(null)
        load()
      }
    } catch (e: any) {
      setError('Erreur: ' + e.message)
    } finally {
      setSubmittingMapping(false)
    }
  }

  function handleDeleteBatch(id: number, filename: string, count: number) {
    setDeleteConfirm({
      ids: [id],
      message: `Supprimer l'import "${filename}" et ses ${count} transaction(s) ? Cette action est irréversible.`,
    })
  }

  function toggleBatchSelected(id: number) {
    setSelectedBatchIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDeleteSelectedBatches() {
    const batches = (batchList?.batches ?? []).filter(b => selectedBatchIds.has(b.id))
    if (batches.length === 0) return
    const totalTx = batches.reduce((sum, b) => sum + b.transaction_count, 0)
    setDeleteConfirm({
      ids: batches.map(b => b.id),
      message: `Supprimer ${batches.length} import(s) et leurs ${totalTx} transaction(s) ? Cette action est irréversible.`,
    })
  }

  async function confirmDeleteBatches() {
    if (!deleteConfirm) return
    const { ids } = deleteConfirm
    setDeleteConfirm(null)
    const results = await Promise.allSettled(ids.map(id => api.deleteImportBatch(id)))
    const succeededIds = ids.filter((_, i) => results[i].status === 'fulfilled')
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    // Reconcile selection/list for whatever did succeed, even if some failed —
    // otherwise a partial failure left stale IDs selected against a list that
    // no longer matches what's actually still in the database.
    setSelectedBatchIds(prev => { const next = new Set(prev); succeededIds.forEach(id => next.delete(id)); return next })
    if (succeededIds.length > 0) load()
    if (failed.length > 0) {
      setError(`Erreur: ${failed.length} suppression(s) sur ${ids.length} ont échoué (${failed[0].reason?.message ?? failed[0].reason})`)
    }
  }

  function updateMapping(patch: Partial<ImportMapping>) {
    if (!mappingState) return
    setMappingState({ ...mappingState, mapping: { ...mappingState.mapping, ...patch } })
    clearInvalid(...Object.keys(patch))
  }

  function fieldCls(key: string): string {
    return invalidFields.has(key) ? `${inputClass} border-red-400 focus:ring-red-400` : inputClass
  }

  const isEmpty = !initialLoading && accounts.length === 0
    && (batchList?.batches.length ?? 0) === 0 && (batchList?.legacy_transaction_count ?? 0) === 0

  const uploadButton = (
    <button
      onClick={() => fileInputRef.current?.click()}
      disabled={uploading}
      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
    >
      <Upload size={16} className={uploading ? 'animate-pulse' : ''} />
      {uploading ? 'Import en cours…' : 'Importer un fichier'}
    </button>
  )

  const isLanding = !!onContinueWithoutData

  return (
    <div className="p-6 space-y-4 w-full">
      {isLanding ? (
        <input ref={fileInputRef} type="file" accept=".xml,.csv" className="hidden" onChange={handleFileSelected} />
      ) : (
        <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
          <h1 className="text-2xl font-bold text-gray-900 theme-fx-logo">Import de données</h1>
          <div>
            <input ref={fileInputRef} type="file" accept=".xml,.csv" className="hidden" onChange={handleFileSelected} />
            {uploadButton}
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isEmpty ? (
        <div className="bg-white border border-gray-100 rounded-xl flex flex-col items-center justify-center text-center py-20 px-6 gap-4">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
            <Inbox size={28} className="text-blue-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Aucune donnée pour le moment</h2>
          <p className="text-sm text-gray-500 max-w-md">
            Importez un relevé bancaire (fichier CSV ou XML) pour commencer.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <Upload size={16} className={uploading ? 'animate-pulse' : ''} />
            {uploading ? 'Import en cours…' : 'Importer un fichier'}
          </button>
          {onContinueWithoutData && (
            <button
              onClick={onContinueWithoutData}
              className="text-sm text-gray-400 hover:text-gray-600 underline mt-2"
            >
              Continuer sans importer de données
            </button>
          )}
        </div>
      ) : (
      <>
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex gap-3">
        <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-gray-600 space-y-1">
          <p>
            Importez un relevé bancaire exporté par votre banque : sélectionnez le fichier, il est analysé et
            les transactions sont ajoutées aux comptes correspondants.
          </p>
          <p>
            Les transactions déjà importées sont automatiquement ignorées (pas de doublons), et la
            catégorisation automatique s'exécute après chaque import.
          </p>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Formats supportés</p>
        <ul className="text-sm text-gray-600 space-y-1">
          <li><span className="font-medium">CAMT.053 (XML)</span> — format ISO 20022 utilisé par la plupart des banques suisses et européennes (Raiffeisen, UBS, PostFinance…), détecté et importé automatiquement.</li>
          <li><span className="font-medium">Revolut (CSV)</span> — export "Account statement" de l'app Revolut, détecté et importé automatiquement.</li>
          <li><span className="font-medium">Autre CSV</span> — si le format n'est pas reconnu, un outil de configuration s'ouvre pour indiquer quelle colonne correspond à la date, au montant, etc. Le mapping peut être enregistré pour être réutilisé.</li>
        </ul>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Wallet size={16} /> Comptes
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2 font-medium whitespace-nowrap">Compte</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Solde</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Transactions</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Dernière mise à jour</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Actif</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} className={`border-b border-gray-50 last:border-0 ${a.is_active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{a.name}</div>
                    <div className="text-xs text-gray-400">{a.iban}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                    {new Intl.NumberFormat('fr-CH', { style: 'currency', currency: a.currency }).format(a.closing_balance)}
                  </td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{a.transaction_count}</td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{a.last_updated ? formatDateTime(a.last_updated) : '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleAccountActive(a)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        a.is_active ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                      title={a.is_active ? 'Désactiver ce compte' : 'Activer ce compte'}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          a.is_active ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleDeleteAccount(a)}
                      title="Supprimer ce compte"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Aucun compte pour le moment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <FileText size={16} /> Historique des imports
          </div>
          {selectedBatchIds.size > 0 && (
            <button
              onClick={handleDeleteSelectedBatches}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 px-2.5 py-1 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={13} /> Supprimer ({selectedBatchIds.size})
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2 font-medium w-8">
                  {(batchList?.batches.length ?? 0) > 0 && (
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 accent-blue-600"
                      checked={selectedBatchIds.size === batchList?.batches.length}
                      onChange={e => setSelectedBatchIds(e.target.checked ? new Set(batchList?.batches.map(b => b.id)) : new Set())}
                    />
                  )}
                </th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Fichier</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Type</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Comptes</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Transactions</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">Importé le</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {batchList?.batches.map(b => (
                <tr key={b.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 accent-blue-600"
                      checked={selectedBatchIds.has(b.id)}
                      onChange={() => toggleBatchSelected(b.id)}
                    />
                  </td>
                  <td className="px-4 py-2 text-gray-900 whitespace-nowrap">{b.filename}</td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{KIND_LABEL[b.kind] ?? b.kind}</td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{b.accounts.map(a => a.name).join(', ') || '—'}</td>
                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{b.transaction_count}</td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatDateTime(b.created_at)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleDeleteBatch(b.id, b.filename, b.transaction_count)}
                      title="Supprimer cet import"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {batchList && batchList.batches.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Aucun import réalisé via cette page.</td></tr>
              )}
              {batchList && batchList.legacy_transaction_count > 0 && (
                <tr className="bg-gray-50">
                  <td></td>
                  <td colSpan={4} className="px-4 py-2 text-gray-400 italic whitespace-nowrap">Anciennes données (avant le suivi des imports)</td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{batchList.legacy_transaction_count} transaction(s)</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center pt-2">
        {uploadButton}
      </div>
      </>
      )}

      {!isLanding && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">Zone dangereuse</p>
            <p className="text-sm text-red-600 mt-0.5">
              Supprime définitivement toutes les données de l'application (comptes, transactions, catégories,
              budgets, historique, imports) pour repartir de zéro.
            </p>
          </div>
          <button
            onClick={() => setWipeAllOpen(true)}
            className="shrink-0 px-3 py-2 text-sm font-semibold text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-100 transition-colors"
          >
            Tout supprimer
          </button>
        </div>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          message={deleteConfirm.message}
          confirmLabel="Supprimer"
          onConfirm={confirmDeleteBatches}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {deleteAccountConfirm && (
        <ConfirmDialog
          message={deleteAccountConfirm.message}
          confirmLabel="Supprimer"
          onConfirm={confirmDeleteAccount}
          onCancel={() => setDeleteAccountConfirm(null)}
        />
      )}

      {wipeAllOpen && (
        <WipeAllDialog
          onConfirm={confirmWipeAll}
          onCancel={() => { if (!wiping) setWipeAllOpen(false) }}
          busy={wiping}
        />
      )}

      {mappingState && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 bg-black/30 backdrop-blur-sm overflow-y-auto"
          onClick={() => setMappingState(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-5 space-y-4 mb-12"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <FileQuestion size={18} className="text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Configurer l'import</h2>
            </div>
            <p className="text-sm text-gray-500">
              Ce format de fichier n'est pas reconnu automatiquement. Indiquez quelle colonne correspond à
              quel champ.
            </p>

            {mappingState.suggestedProfile && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-center justify-between gap-3">
                <span className="text-sm text-blue-800">
                  Mapping enregistré trouvé : <span className="font-medium">{mappingState.suggestedProfile.name}</span>
                </span>
                <button onClick={applySuggestedProfile} className="text-sm font-medium text-blue-700 hover:underline">
                  Utiliser
                </button>
              </div>
            )}

            <div className="border border-gray-100 rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    {mappingState.headers.map(h => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappingState.sampleRows.map((row, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      {row.map((cell, j) => (
                        <td key={j} className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel hint="La colonne du fichier qui contient la date de la transaction.">Colonne date</FieldLabel>
                <select className={fieldCls('date_column')} value={mappingState.mapping.date_column}
                  onChange={e => updateMapping({ date_column: e.target.value })}>
                  <option value="">—</option>
                  {mappingState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel wide hint={
                  'Comment la date est écrite dans le fichier :\n' +
                  '%d jour\n' +
                  '%m mois\n' +
                  '%Y année (4 chiffres)\n' +
                  '%y année (2 chiffres)\n' +
                  '%H heures\n' +
                  '%M minutes\n' +
                  '%S secondes\n\n' +
                  'Exemples :\n' +
                  '« 31.12.2026 » → %d.%m.%Y\n' +
                  '« 31/12/2026 » → %d/%m/%Y\n' +
                  '« 2026-12-31 » → %Y-%m-%d\n' +
                  '« 12/31/2026 » (format US) → %m/%d/%Y\n' +
                  '« 31.12.2026 14:30 » → %d.%m.%Y %H:%M\n' +
                  '« 2026-12-31 14:30:00 » → %Y-%m-%d %H:%M:%S'
                }>
                  Format de date (ex. %d.%m.%Y)
                </FieldLabel>
                <input className={fieldCls('date_format')} value={mappingState.mapping.date_format}
                  onChange={e => updateMapping({ date_format: e.target.value })} />
              </div>
              <div>
                <FieldLabel hint="La colonne utilisée comme libellé de la transaction, affichée dans la liste des transactions.">
                  Colonne description
                </FieldLabel>
                <select className={inputClass} value={mappingState.mapping.description_column ?? ''}
                  onChange={e => updateMapping({ description_column: e.target.value || null })}>
                  <option value="">—</option>
                  {mappingState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel hint="Colonne contenant le nom de la personne ou de l'entreprise concernée, si le fichier en fournit une.">
                  Colonne contrepartie (optionnel)
                </FieldLabel>
                <select className={inputClass} value={mappingState.mapping.counterparty_column ?? ''}
                  onChange={e => updateMapping({ counterparty_column: e.target.value || null })}>
                  <option value="">—</option>
                  {mappingState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            <details className="border border-gray-100 rounded-lg">
              <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none">
                Configuration avancée (séparateurs — détectés automatiquement)
              </summary>
              <div className="grid grid-cols-2 gap-3 p-3 pt-0">
                <div>
                  <FieldLabel hint="Le caractère qui sépare les centimes dans les montants du fichier : un point (12.50) ou une virgule (12,50). Détecté automatiquement à partir de l'aperçu.">
                    Séparateur décimal
                  </FieldLabel>
                  <select className={inputClass} value={mappingState.mapping.decimal_separator}
                    onChange={e => updateMapping({ decimal_separator: e.target.value })}>
                    <option value=".">Point (1234.56)</option>
                    <option value=",">Virgule (1234,56)</option>
                  </select>
                </div>
                <div>
                  <FieldLabel hint="Le caractère qui sépare les colonnes dans le fichier (virgule, point-virgule, tabulation…). Détecté automatiquement.">
                    Séparateur de colonnes
                  </FieldLabel>
                  <input className={inputClass} maxLength={1} value={mappingState.mapping.delimiter}
                    onChange={e => updateMapping({ delimiter: e.target.value })} />
                </div>
              </div>
            </details>

            <div>
              <FieldLabel hint={'Certaines banques mettent le montant dans une seule colonne signée (positive ou négative), d\'autres ajoutent une colonne "type" qui indique débit/crédit, d\'autres encore utilisent deux colonnes séparées.'}>
                Comment le montant est représenté
              </FieldLabel>
              <select className={inputClass} value={mappingState.mapping.amount_mode}
                onChange={e => updateMapping({ amount_mode: e.target.value as ImportAmountMode })}>
                <option value="single_signed">Une colonne, signée (-12.50 / +12.50)</option>
                <option value="single_unsigned_with_type">Une colonne + une colonne "type" (débit/crédit)</option>
                <option value="separate_debit_credit">Deux colonnes séparées (débit / crédit)</option>
              </select>
            </div>

            {mappingState.mapping.amount_mode !== 'separate_debit_credit' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel hint="La colonne contenant la valeur du montant.">Colonne montant</FieldLabel>
                  <select className={fieldCls('amount_column')} value={mappingState.mapping.amount_column ?? ''}
                    onChange={e => updateMapping({ amount_column: e.target.value || null })}>
                    <option value="">—</option>
                    {mappingState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                {mappingState.mapping.amount_mode === 'single_unsigned_with_type' && (
                  <>
                    <div>
                      <FieldLabel hint="La colonne qui indique si la ligne est un débit (sortie d'argent) ou un crédit (entrée d'argent).">
                        Colonne type
                      </FieldLabel>
                      <select className={fieldCls('type_column')} value={mappingState.mapping.type_column ?? ''}
                        onChange={e => updateMapping({ type_column: e.target.value || null })}>
                        <option value="">—</option>
                        {mappingState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                    <div>
                      <FieldLabel hint={'La valeur exacte que contient la colonne "type" quand il s\'agit d\'une entrée d\'argent (ex. "Credit", "CRDT"…). Toute autre valeur sera traitée comme une sortie d\'argent.'}>
                        Valeur signifiant "crédit"
                      </FieldLabel>
                      <input className={fieldCls('credit_value')} value={mappingState.mapping.credit_value ?? ''}
                        onChange={e => updateMapping({ credit_value: e.target.value })} />
                    </div>
                  </>
                )}
              </div>
            )}

            {mappingState.mapping.amount_mode === 'separate_debit_credit' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel hint="La colonne qui contient un montant uniquement lorsqu'il s'agit d'une sortie d'argent (dépense).">
                    Colonne débit
                  </FieldLabel>
                  <select className={fieldCls('debit_column')} value={mappingState.mapping.debit_column ?? ''}
                    onChange={e => updateMapping({ debit_column: e.target.value || null })}>
                    <option value="">—</option>
                    {mappingState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel hint="La colonne qui contient un montant uniquement lorsqu'il s'agit d'une entrée d'argent (revenu).">
                    Colonne crédit
                  </FieldLabel>
                  <select className={fieldCls('credit_column')} value={mappingState.mapping.credit_column ?? ''}
                    onChange={e => updateMapping({ credit_column: e.target.value || null })}>
                    <option value="">—</option>
                    {mappingState.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="border-t border-gray-100 pt-3 space-y-2">
              <FieldLabel hint="Le compte auquel rattacher les transactions de ce fichier : un compte déjà existant, ou un nouveau compte que vous créez maintenant.">
                Compte concerné
              </FieldLabel>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={mappingState.accountMode === 'new'}
                    onChange={() => { setMappingState({ ...mappingState, accountMode: 'new' }); clearInvalid('account') }} />
                  Nouveau compte
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={mappingState.accountMode === 'existing'}
                    onChange={() => { setMappingState({ ...mappingState, accountMode: 'existing' }); clearInvalid('account') }} />
                  Compte existant
                </label>
              </div>
              {mappingState.accountMode === 'existing' ? (
                <select className={fieldCls('account')} value={mappingState.accountId ?? ''}
                  onChange={e => { setMappingState({ ...mappingState, accountId: Number(e.target.value) }); clearInvalid('account') }}>
                  {mappingState.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <input className={fieldCls('account')} placeholder="Nom du compte" value={mappingState.newAccountName}
                    onChange={e => { setMappingState({ ...mappingState, newAccountName: e.target.value }); clearInvalid('account') }} />
                  {mappingState.newAccountCurrencyCustom ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        className={fieldCls('currency')}
                        placeholder="Code devise (ex. AUD)"
                        value={mappingState.newAccountCurrency}
                        autoFocus
                        onChange={e => { setMappingState({ ...mappingState, newAccountCurrency: e.target.value.toUpperCase() }); clearInvalid('currency') }}
                        onBlur={e => saveCustomCurrency(e.target.value)}
                      />
                      <button
                        type="button"
                        title="Revenir à la liste"
                        onClick={() => setMappingState({ ...mappingState, newAccountCurrencyCustom: false, newAccountCurrency: '' })}
                        className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                      >
                        liste
                      </button>
                    </div>
                  ) : (
                    <CustomSelect
                      className={fieldCls('currency')}
                      placeholder="Devise…"
                      value={mappingState.newAccountCurrency}
                      options={[
                        ...currencyOptions.map(c => ({ value: c, label: c })),
                        { value: OTHER_CURRENCY, label: 'Autre…' },
                      ]}
                      onSelect={v => {
                        clearInvalid('currency')
                        if (v === OTHER_CURRENCY) {
                          setMappingState({ ...mappingState, newAccountCurrencyCustom: true, newAccountCurrency: '' })
                        } else {
                          setMappingState({ ...mappingState, newAccountCurrency: v })
                        }
                      }}
                    />
                  )}
                </div>
              )}
            </div>

            <div>
              <FieldLabel hint="Donnez un nom à cette configuration pour qu'elle soit proposée automatiquement la prochaine fois qu'un fichier avec les mêmes colonnes est importé.">
                Enregistrer ce mapping pour le réutiliser (optionnel)
              </FieldLabel>
              <input className={inputClass} placeholder="Nom du mapping, ex. « Ma banque CSV »"
                value={mappingState.saveProfileName}
                onChange={e => setMappingState({ ...mappingState, saveProfileName: e.target.value })} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setMappingState(null)}
                className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
                Annuler
              </button>
              <button onClick={submitMapping} disabled={submittingMapping}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
                {submittingMapping ? 'Import en cours…' : 'Importer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
