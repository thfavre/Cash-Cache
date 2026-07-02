import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Analytics from './pages/Analytics'
import Budgets from './pages/Budgets'
import Predictions from './pages/Predictions'
import Categorize from './pages/Categorize'

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
            <Route path="/budgets" element={<div className="overflow-y-auto flex-1"><Budgets /></div>} />
            <Route path="/predictions" element={<div className="overflow-y-auto flex-1"><Predictions /></div>} />
            <Route path="/categorize" element={<Categorize />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
