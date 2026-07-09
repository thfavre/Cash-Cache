import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, Check } from 'lucide-react'
import clsx from 'clsx'
import { THEMES } from '../theme/themes'

interface ThemeModalProps {
  current: string
  onSelect: (id: string) => void
  onPreview: (id: string | null) => void
  onClose: () => void
}

export default function ThemeModal({ current, onSelect, onPreview, onClose }: ThemeModalProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(
    () => THEMES.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase())),
    [query]
  )

  function handleClose() {
    onPreview(null)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/30"
      onClick={handleClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md max-h-[70vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
          <Search size={16} className="text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && handleClose()}
            placeholder="Thème..."
            className="flex-1 outline-none text-sm text-gray-900 placeholder:text-gray-400 bg-transparent"
          />
        </div>

        <div
          className="overflow-y-auto flex-1 py-1"
          onMouseLeave={() => onPreview(null)}
        >
          {filtered.map(theme => (
            <button
              key={theme.id}
              onMouseEnter={() => onPreview(theme.id)}
              onClick={() => onSelect(theme.id)}
              className={clsx(
                'w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors',
                theme.id === current ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <span className="w-4 shrink-0">
                {theme.id === current && <Check size={14} />}
              </span>
              <span className="flex-1 text-left">{theme.name}</span>
              <span
                className="flex items-center gap-1 rounded-full px-2 py-1 shrink-0 shadow-sm"
                style={{ backgroundColor: theme.bg }}
              >
                {theme.colors.map((color, i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Aucun thème trouvé</p>
          )}
        </div>
      </div>
    </div>
  )
}
