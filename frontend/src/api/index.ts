const BASE = '/api'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

// ---- Types ----

export interface Account {
  id: number
  iban: string
  name: string
  currency: string
  closing_balance: number
}

export interface Category {
  id: number
  name: string
  color: string
  icon: string
  rules: string[]
  is_savings: boolean
  is_ignored: boolean
}

export interface Transaction {
  id: number
  account_id: number
  account_iban: string | null
  date: string
  amount: number
  is_credit: boolean
  description: string | null
  counterparty: string | null
  counterparty_iban: string | null
  remittance_info: string | null
  category_id: number | null
  category_name: string | null
  category_color: string | null
  category_icon: string | null
  tx_code: string | null
  bank_ref: string
  is_reversal: boolean
  is_internal: boolean
}

export interface PaginatedTransactions {
  total: number
  page: number
  per_page: number
  items: Transaction[]
}

export interface MonthlyStats {
  month: string
  income: number
  expenses: number
  net: number
}

export interface CategoryStats {
  id: number
  name: string
  color: string
  icon: string
  total: number
}

export interface Overview {
  total_balance: number
  income: number
  expenses: number
  net: number
  savings_rate: number
}

export interface BalanceHistory {
  month: string
  balance: number
}

export interface Budget {
  id: number
  category_id: number
  category_name: string
  category_color: string
  category_icon: string
  month: string
  amount_limit: number
  spent: number
  percent: number
}

export interface ForecastPoint {
  month: string
  predicted: number
  lower: number
  upper: number
}

export interface HistoricalPoint {
  month: string
  actual: number
}

export interface Prediction {
  historical: HistoricalPoint[]
  forecast: ForecastPoint[]
}

export interface CategoryPrediction {
  category_id: number
  category_name: string
  category_color: string
  category_icon: string
  next_month_predicted: number
  avg_last_3: number
}

export interface Merchant {
  name: string
  total: number
  count: number
}

export interface CashflowInflow {
  id?: number | null
  name: string
  amount: number
  color: string
  icon: string
  tx_count: number
  percentage: number
}

export interface CashflowOutflow {
  id: number
  name: string
  amount: number
  color: string
  icon: string
  tx_count: number
  percentage_of_expenses: number
  percentage_of_income: number
  avg_ticket: number
  subitems?: { name: string; amount: number; detail?: { name: string; amount: number }[] }[]
}

export interface CashflowData {
  summary: {
    income: number
    expenses: number
    net_savings: number
    savings_rate: number
    tx_count: number
  }
  inflows: CashflowInflow[]
  outflows: CashflowOutflow[]
  monthly_trend: {
    month: string
    income: number
    expenses: number
    net: number
  }[]
}

export interface HistoryEntry {
  id: number
  created_at: string
  action: string
  summary: string
  reverted: boolean
  transactions: string[] | null
}

// ---- API functions ----


export const api = {
  // Accounts
  accounts: (): Promise<Account[]> => req('/stats/accounts'),

  // Transactions
  transactions: (params: Record<string, string | number | boolean | string[] | undefined>): Promise<PaginatedTransactions> => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) {
        v.forEach(item => qs.append(k, item))
      } else {
        qs.set(k, String(v))
      }
    }
    return req(`/transactions?${qs}`)
  },
  updateTransactionCategory: (txId: number, categoryId: number | null): Promise<{ ok: boolean }> =>
    req(`/transactions/${txId}/category`, {
      method: 'PUT',
      body: JSON.stringify({ category_id: categoryId }),
    }),
  updateTransactionsCategory: (txIds: number[], categoryId: number | null): Promise<{ updated: number; history_id: number | null }> =>
    req(`/transactions/bulk-category`, {
      method: 'PUT',
      body: JSON.stringify({ tx_ids: txIds, category_id: categoryId }),
    }),

  // Categories
  categories: (): Promise<Category[]> => req('/categories'),
  createCategory: (body: { name: string; color: string; icon: string; rules: string[] }): Promise<Category> =>
    req('/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id: number, body: Partial<Omit<Category, 'id'>>): Promise<Category> =>
    req(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCategory: (id: number): Promise<{ ok: boolean }> =>
    req(`/categories/${id}`, { method: 'DELETE' }),
  recategorize: (catId: number): Promise<{ updated: number }> =>
    req(`/categories/${catId}/recategorize`, { method: 'POST' }),

  // Stats
  overview: (params?: { account_id?: number; year?: number; month?: number }): Promise<Overview> => {
    const qs = new URLSearchParams()
    if (params?.account_id) qs.set('account_id', String(params.account_id))
    if (params?.year) qs.set('year', String(params.year))
    if (params?.month) qs.set('month', String(params.month))
    return req(`/stats/overview?${qs}`)
  },
  monthly: (params?: { account_id?: number; year?: number }): Promise<MonthlyStats[]> => {
    const qs = new URLSearchParams()
    if (params?.account_id) qs.set('account_id', String(params.account_id))
    if (params?.year) qs.set('year', String(params.year))
    return req(`/stats/monthly?${qs}`)
  },
  categoryStats: (params?: { account_id?: number; year?: number; month?: number }): Promise<CategoryStats[]> => {
    const qs = new URLSearchParams()
    if (params?.account_id) qs.set('account_id', String(params.account_id))
    if (params?.year) qs.set('year', String(params.year))
    if (params?.month) qs.set('month', String(params.month))
    return req(`/stats/categories?${qs}`)
  },
  topMerchants: (params?: { account_id?: number; year?: number; month?: number; limit?: number }): Promise<Merchant[]> => {
    const qs = new URLSearchParams()
    if (params?.account_id) qs.set('account_id', String(params.account_id))
    if (params?.year) qs.set('year', String(params.year))
    if (params?.month) qs.set('month', String(params.month))
    if (params?.limit) qs.set('limit', String(params.limit))
    return req(`/stats/top-merchants?${qs}`)
  },
  balanceHistory: (accountId?: number): Promise<BalanceHistory[]> => {
    const qs = accountId ? `?account_id=${accountId}` : ''
    return req(`/stats/balance-history${qs}`)
  },
  cashflow: (params?: { account_id?: number; year?: number; month?: number; period?: string }): Promise<CashflowData> => {
    const qs = new URLSearchParams()
    if (params?.account_id) qs.set('account_id', String(params.account_id))
    if (params?.year) qs.set('year', String(params.year))
    if (params?.month) qs.set('month', String(params.month))
    if (params?.period) qs.set('period', params.period)
    return req(`/stats/cashflow?${qs}`)
  },

  // Budgets
  budgets: (month?: string): Promise<Budget[]> => {
    const qs = month ? `?month=${month}` : ''
    return req(`/budgets${qs}`)
  },
  createBudget: (body: { category_id: number; month: string; amount_limit: number }): Promise<Budget> =>
    req('/budgets', { method: 'POST', body: JSON.stringify(body) }),
  updateBudget: (id: number, amount_limit: number): Promise<Budget> =>
    req(`/budgets/${id}`, { method: 'PUT', body: JSON.stringify({ amount_limit }) }),
  deleteBudget: (id: number): Promise<{ ok: boolean }> =>
    req(`/budgets/${id}`, { method: 'DELETE' }),

  // Predictions
  prediction: (categoryId?: number, months?: number): Promise<Prediction> => {
    const qs = new URLSearchParams()
    if (categoryId) qs.set('category_id', String(categoryId))
    if (months) qs.set('months', String(months))
    return req(`/predictions?${qs}`)
  },
  allCategoryPredictions: (months?: number): Promise<CategoryPrediction[]> => {
    const qs = months ? `?months=${months}` : ''
    return req(`/predictions/all-categories${qs}`)
  },

  // Import
  reimport: (): Promise<{ files: number; accounts: number; transactions: number }> =>
    req('/import', { method: 'POST' }),

  // History
  history: (): Promise<HistoryEntry[]> => req('/history'),
  revertHistory: (id: number): Promise<HistoryEntry> =>
    req(`/history/${id}/revert`, { method: 'POST' }),

  // Settings
  getThemeFavorites: (): Promise<string[]> =>
    req<{ favorites: string[] }>('/settings/theme-favorites').then(r => r.favorites),
  setThemeFavorites: (favorites: string[]): Promise<string[]> =>
    req<{ favorites: string[] }>('/settings/theme-favorites', {
      method: 'PUT',
      body: JSON.stringify({ favorites }),
    }).then(r => r.favorites),
  getTheme: (): Promise<string | null> =>
    req<{ theme: string | null }>('/settings/theme').then(r => r.theme),
  setTheme: (theme: string): Promise<string> =>
    req<{ theme: string }>('/settings/theme', {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    }).then(r => r.theme),
}
