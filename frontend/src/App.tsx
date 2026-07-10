import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Analytics from './pages/Analytics'
import Planification from './pages/Planification'
import Categorize from './pages/Categorize'
import Futur from './pages/Futur'

export default function App() {
  return (
    <BrowserRouter>
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
            {/* Redirects for the old, now-merged routes */}
            <Route path="/cashflow" element={<Navigate to="/analytics" replace />} />
            <Route path="/budgets" element={<Navigate to="/planification" replace />} />
            <Route path="/predictions" element={<Navigate to="/planification" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
