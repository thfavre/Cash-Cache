interface Props {
  name: string | null
  color: string | null
  icon: string | null
  size?: 'sm' | 'md'
}

export default function CategoryBadge({ name, color, icon, size = 'sm' }: Props) {
  const bg = color ? `${color}22` : '#6B728022'
  const text = color ?? '#6B7280'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}`}
      style={{ backgroundColor: bg, color: text }}
    >
      {icon && <span>{icon}</span>}
      {name ?? 'Non catégorisé'}
    </span>
  )
}
