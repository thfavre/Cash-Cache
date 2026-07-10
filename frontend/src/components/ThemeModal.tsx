import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, Check, Sparkles, Star } from 'lucide-react'
import clsx from 'clsx'
import { THEMES } from '../theme/themes'

const FAVORITES_KEY = 'themeFavorites'

function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

interface ThemeModalProps {
  current: string
  onSelect: (id: string) => void
  onClose: () => void
}

export default function ThemeModal({ current, onSelect, onClose }: ThemeModalProps) {
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState(loadFavorites)
  // Order is frozen for the lifetime of the modal so starring a theme doesn't
  // yank it out from under the cursor mid-session — the new order only takes
  // effect the next time the picker is opened.
  const [sortSnapshot] = useState(loadFavorites)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function toggleFavorite(id: string) {
    setFavorites(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const filtered = useMemo(
    () =>
      THEMES.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase())).sort(
        (a, b) => Number(sortSnapshot.has(b.id)) - Number(sortSnapshot.has(a.id))
      ),
    [query, sortSnapshot]
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/30"
      onClick={onClose}
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
            onKeyDown={e => e.key === 'Escape' && onClose()}
            placeholder="Thème..."
            className="flex-1 outline-none text-sm text-gray-900 placeholder:text-gray-400 bg-transparent"
          />
        </div>

        <div className="overflow-y-auto flex-1 py-1">
          {filtered.map(theme => (
            <div
              key={theme.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(theme.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(theme.id) }
              }}
              className={clsx(
                'w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors cursor-pointer',
                theme.id === current ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <span className="w-4 shrink-0">
                {theme.id === current && <Check size={14} />}
              </span>
              <span className="flex-1 text-left">{theme.name}</span>
              <button
                onClick={e => { e.stopPropagation(); toggleFavorite(theme.id) }}
                className="shrink-0 p-0.5 -m-0.5"
                title={favorites.has(theme.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              >
                <Star
                  size={14}
                  fill={favorites.has(theme.id) ? 'currentColor' : 'none'}
                  className={favorites.has(theme.id) ? 'text-amber-400' : 'text-gray-300'}
                />
              </button>
              <span
                className="flex items-center gap-1 rounded-full px-2 py-1 shrink-0 shadow-sm"
                style={{ backgroundColor: theme.bg }}
              >
                {theme.colors.map((color, i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span
                className="w-4 shrink-0 text-amber-400 flex justify-center"
                title={theme.effect ? 'Thème spécial' : undefined}
              >
                {theme.effect && <Sparkles size={13} />}
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Aucun thème trouvé</p>
          )}
        </div>
      </div>
    </div>
  )
}
