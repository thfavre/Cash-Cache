import Budgets from './Budgets'

export default function Planification() {
  return (
    <div className="p-6 pb-0 w-full">
      <div className="flex items-center gap-6 border-b border-gray-200 pb-2 mb-2">
        <h1 className="text-2xl font-bold text-gray-900 mr-4 theme-fx-logo">Planification</h1>
      </div>
      <div className="-mx-6">
        <Budgets />
      </div>
    </div>
  )
}
