import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Analytics from './pages/Analytics'
import Planification from './pages/Planification'
import Categorize from './pages/Categorize'
import Futur from './pages/Futur'
import Import from './pages/Import'
import { api } from './api'

export default function App() {
  const [dataStatus, setDataStatus] = useState<'loading' | 'empty' | 'has-data'>('loading')
  // Choosing to continue without importing is a per-session decision — it
  // is not persisted, so a page reload always re-checks and shows the
  // landing page again as long as there's still no data.
  const [bypass, setBypass] = useState(false)

  function refreshDataStatus() {
    api.accounts().then(accts => setDataStatus(accts.length > 0 ? 'has-data' : 'empty'))
  }

  useEffect(() => { refreshDataStatus() }, [])

  return (
    <BrowserRouter>
      {dataStatus === 'loading' ? (
        <div className="h-screen bg-gray-50" />
      ) : dataStatus === 'empty' && !bypass ? (
        <div className="h-screen overflow-y-auto bg-gray-50">
          <Import onContinueWithoutData={() => setBypass(true)} onDataChanged={refreshDataStatus} />
        </div>
      ) : (
        <div className="flex h-screen overflow-hidden bg-gray-50">
          <Sidebar />
          <main className="flex-1 overflow-hidden flex flex-col">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<div className="overflow-y-auto flex-1"><Dashboard /></div>} />
              <Route path="/transactions" element={<div className="overflow-y-auto flex-1"><Transactions /></div>} />
              <Route path="/analytics" element={<div className="overflow-y-auto flex-1"><Analytics /></div>} />
              <Route path="/planification" element={<div className="overflow-y-auto flex-1"><Planification /></div>} />
              <Route path="/futur" element={<div className="overflow-y-auto flex-1"><Futur /></div>} />
              <Route path="/categorize" element={<Categorize />} />
              <Route path="/import" element={<div className="overflow-y-auto flex-1"><Import onDataChanged={refreshDataStatus} /></div>} />
              {/* Redirects for the old, now-merged routes */}
              <Route path="/cashflow" element={<Navigate to="/analytics" replace />} />
              <Route path="/budgets" element={<Navigate to="/planification" replace />} />
              <Route path="/predictions" element={<Navigate to="/planification" replace />} />
            </Routes>
          </main>
        </div>
      )}
    </BrowserRouter>
  )
}
