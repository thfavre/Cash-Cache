import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
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
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}

function AppInner() {
  const [dataStatus, setDataStatus] = useState<'loading' | 'empty' | 'has-data'>('loading')
  // Choosing to continue without importing is a per-session decision — it
  // is not persisted, so a page reload always re-checks and shows the
  // landing page again as long as there's still no data.
  const [bypass, setBypass] = useState(false)
  const navigate = useNavigate()

  function refreshDataStatus() {
    api.accounts().then(accts => setDataStatus(accts.length > 0 ? 'has-data' : 'empty'))
  }

  useEffect(() => { refreshDataStatus() }, [])

  // Whatever URL the app happened to be on while there was no data yet (it's
  // not necessarily "/" — e.g. a reload after all data got wiped while on
  // /import), the very first successful import should land the user on the
  // dashboard rather than leaving them stranded on the import screen.
  function handleFirstImport() {
    refreshDataStatus()
    navigate('/dashboard', { replace: true })
  }

  return (
    <>
      {dataStatus === 'loading' ? (
        <div className="h-screen bg-gray-50" />
      ) : dataStatus === 'empty' && !bypass ? (
        <div className="h-screen overflow-y-auto bg-gray-50">
          <Import onContinueWithoutData={() => setBypass(true)} onDataChanged={handleFirstImport} />
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
    </>
  )
}
