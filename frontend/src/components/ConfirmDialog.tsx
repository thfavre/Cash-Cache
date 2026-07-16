import { useEffect } from 'react'

interface ConfirmDialogProps {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  message, confirmLabel = 'Supprimer', cancelLabel = 'Annuler', danger = true, onConfirm, onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/30"
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-4"
      >
        <p className="text-sm font-medium text-gray-800 break-words">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={
              danger
                ? 'px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors'
                : 'px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
