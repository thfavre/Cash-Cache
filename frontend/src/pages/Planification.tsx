import { useState } from 'react'
import Budgets from './Budgets'
import Predictions from './Predictions'

const TABS = [
  { id: 'budgets', label: 'Budgets', icon: '🎯' },
  { id: 'predictions', label: 'Prévisions', icon: '📈' },
] as const

type TabId = typeof TABS[number]['id']

export default function Planification() {
  const [tab, setTab] = useState<TabId>('budgets')

  return (
    <div className="p-6 pb-0 max-w-4xl mx-auto">
      <div className="flex items-center gap-6 border-b border-gray-200 pb-2 mb-2">
        <h1 className="text-2xl font-bold text-gray-900 mr-4">Planification</h1>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`pb-2 text-sm font-bold border-b-2 transition-all ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="-mx-6">
        {tab === 'budgets' && <Budgets />}
        {tab === 'predictions' && <Predictions />}
      </div>
    </div>
  )
}
