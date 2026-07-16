import { useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'

// A floating "little helper" tooltip: a dark popover that fades/scales in on
// hover instead of the native title tooltip.
export default function InfoTip({ text, wide }: { text: string; wide?: boolean }) {
  const [align, setAlign] = useState<'center' | 'left' | 'right'>('center')
  const iconRef = useRef<HTMLSpanElement>(null)
  const widthClass = wide ? 'w-80' : 'w-56'

  function handleEnter() {
    const rect = iconRef.current?.getBoundingClientRect()
    if (!rect) return
    const halfWidth = wide ? 170 : 130
    if (rect.left < halfWidth) setAlign('left')
    else if (window.innerWidth - rect.right < halfWidth) setAlign('right')
    else setAlign('center')
  }

  const posClass =
    align === 'left' ? 'left-0' :
    align === 'right' ? 'right-0' :
    'left-1/2 -translate-x-1/2'

  return (
    <span ref={iconRef} className="group relative inline-flex items-center" onMouseEnter={handleEnter}>
      <HelpCircle className="w-3.5 h-3.5 text-gray-300 hover:text-gray-500 cursor-help" />
      <span className={`pointer-events-none absolute ${posClass} bottom-full mb-2 ${widthClass} rounded-lg bg-gray-900 text-white text-xs normal-case tracking-normal font-normal leading-snug whitespace-pre-line p-2.5 opacity-0 scale-95 origin-bottom group-hover:opacity-100 group-hover:scale-100 transition-all z-20 shadow-2xl`}>
        {text}
      </span>
    </span>
  )
}
