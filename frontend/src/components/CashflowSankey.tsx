import React, { useMemo, useState } from 'react'
import { CashflowData } from '../api'

interface Props {
  data: CashflowData
  onSelectCategory?: (categoryName: string, categoryId?: number) => void
}

interface Node {
  id: string
  rawId?: number
  name: string
  amount: number
  color: string
  icon: string
  txCount?: number
  col: number
  percentage: number
  x: number
  y: number
  h: number
  currSourceY: number
  currTargetY: number
}

interface Link {
  id: string
  source: Node
  target: Node
  value: number
  color: string
  pathD?: string
}

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

export default function CashflowSankey({ data, onSelectCategory }: Props) {
  const [sizeMode, setSizeMode] = useState<'auto' | 'confort' | 'xxl'>('auto')
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null)

  const { nodes, links, width, height, nodeWidth } = useMemo(() => {
    const { summary, inflows, outflows } = data
    const maxVal = Math.max(summary.income, summary.expenses, 1)

    const width = 1380
    let height = 800
    const padY = 40
    const padX = 220
    const nodeWidth = 14

    const nodeList: Node[] = []
    const linkList: Link[] = []

    // Column 0: Sources of Income / Inflows
    const col0Nodes: { id: string; name: string; amount: number; color: string; icon: string }[] = []
    inflows.forEach((inf, i) => {
      if (inf.amount > 0) {
        col0Nodes.push({
          id: `in_${i}`,
          name: inf.name,
          amount: inf.amount,
          color: inf.color || '#10B981',
          icon: inf.icon || '💰'
        })
      }
    })
    if (summary.expenses > summary.income && summary.expenses - summary.income > 0.01) {
      col0Nodes.push({
        id: 'in_deficit',
        name: 'Puisage sur réserves',
        amount: summary.expenses - summary.income,
        color: '#EF4444',
        icon: '📉'
      })
    }
    if (col0Nodes.length === 0) {
      col0Nodes.push({
        id: 'in_budget',
        name: 'Revenus perçus',
        amount: Math.max(summary.income, summary.expenses, 1),
        color: '#10B981',
        icon: '💰'
      })
    }

    // Column 1: Intermediate Hub Layer (All money in goes here!)
    const totalIn = Math.max(summary.income, summary.expenses, 1)
    const col1Nodes = [
      { id: 'hub_budget', name: 'Budget / Trésorerie', amount: totalIn, color: '#3B82F6', icon: '🌊' }
    ]

    // Column 2: Expense Categories & Savings
    const col2Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string; txCount?: number }[] = []
    for (const out of outflows) {
      if (out.amount > 0) {
        col2Nodes.push({
          id: `cat_${out.id}_${out.name}`,
          rawId: out.id,
          name: out.name,
          amount: out.amount,
          color: out.color || '#64748B',
          icon: out.icon || '📦',
          txCount: out.tx_count
        })
      }
    }
    if (summary.net_savings > 0.01) {
      col2Nodes.push({
        id: 'cat_savings',
        name: 'Épargne constituée',
        amount: summary.net_savings,
        color: '#10B981',
        icon: '🏦'
      })
    }
    if (col2Nodes.length === 0) {
      col2Nodes.push({ id: 'cat_empty', name: 'Dépenses', amount: 1, color: '#94A3B8', icon: '❓' })
    }

    // Column 3: Subitems / Merchants
    const col3Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string }[] = []
    for (const out of outflows) {
      if (out.amount > 0 && out.subitems && out.subitems.length > 0) {
        for (let i = 0; i < out.subitems.length; i++) {
          const sub = out.subitems[i]
          col3Nodes.push({
            id: `sub_${out.id}_${i}`,
            rawId: out.id,
            name: sub.name,
            amount: sub.amount,
            color: out.color || '#64748B',
            icon: out.icon || '📌'
          })
        }
      } else if (out.amount > 0) {
        col3Nodes.push({
          id: `sub_${out.id}_single`,
          rawId: out.id,
          name: out.name,
          amount: out.amount,
          color: out.color || '#64748B',
          icon: out.icon || '📌'
        })
      }
    }
    if (summary.net_savings > 0.01) {
      col3Nodes.push({
        id: 'sub_savings_acc',
        name: 'Accumulation Nette',
        amount: summary.net_savings,
        color: '#10B981',
        icon: '✨'
      })
    }
    if (col3Nodes.length === 0) {
      col3Nodes.push({ id: 'sub_empty', name: 'Détail', amount: 1, color: '#94A3B8', icon: '▪' })
    }

    const colCols = [col0Nodes, col1Nodes, col2Nodes, col3Nodes]
    const maxNodes = Math.max(col0Nodes.length, col1Nodes.length, col2Nodes.length, col3Nodes.length)
    if (sizeMode === 'auto') {
      height = Math.max(860, maxNodes * 38 + 140)
    } else if (sizeMode === 'confort') {
      height = 1150
    } else if (sizeMode === 'xxl') {
      height = 1800
    }
    const colX = [padX, 510, 800, width - padX - nodeWidth]

    colCols.forEach((items, cIdx) => {
      const totalColVal = items.reduce((sum, item) => sum + item.amount, 0) || 1
      const n = items.length
      const gap = Math.min(24, Math.max(8, (height - 2 * padY - n * 18) / Math.max(1, n - 1)))
      const availH = height - 2 * padY - (n - 1) * gap

      const rawH = items.map(item => Math.max(18, (item.amount / totalColVal) * availH))
      const sumRaw = rawH.reduce((a, b) => a + b, 0)
      const scale = sumRaw > availH ? availH / sumRaw : 1

      let currY = padY
      items.forEach((item, i) => {
        const h = rawH[i] * scale
        nodeList.push({
          ...item,
          col: cIdx,
          x: colX[cIdx],
          y: currY,
          h,
          currSourceY: currY,
          currTargetY: currY,
          percentage: Math.round((item.amount / maxVal) * 1000) / 10
        })
        currY += h + gap
      })
    })

    const leftNodes = nodeList.filter(n => n.col === 0)
    const hubNode = nodeList.find(n => n.col === 1)!
    const catNodes = nodeList.filter(n => n.col === 2)
    const subNodes = nodeList.filter(n => n.col === 3)

    // Links Col 0 -> Col 1 (Inflows into Intermediate Hub)
    leftNodes.forEach(left => {
      linkList.push({
        id: `${left.id}->hub_budget`,
        source: left,
        target: hubNode,
        value: left.amount,
        color: left.color
      })
    })

    // Links Col 1 -> Col 2 (Hub into Categories)
    catNodes.forEach(cat => {
      linkList.push({
        id: `hub_budget->${cat.id}`,
        source: hubNode,
        target: cat,
        value: cat.amount,
        color: cat.color
      })
    })

    // Links Col 2 -> Col 3 (Categories into Subitems)
    catNodes.forEach(cat => {
      if (cat.id === 'cat_savings') {
        const savTarget = subNodes.find(s => s.id === 'sub_savings_acc')
        if (savTarget) {
          linkList.push({
            id: `${cat.id}->${savTarget.id}`,
            source: cat,
            target: savTarget,
            value: cat.amount,
            color: cat.color
          })
        }
      } else if (cat.rawId !== undefined) {
        const matchingSubs = subNodes.filter(s => s.rawId === cat.rawId)
        matchingSubs.forEach(sub => {
          linkList.push({
            id: `${cat.id}->${sub.id}`,
            source: cat,
            target: sub,
            value: sub.amount,
            color: cat.color
          })
        })
      }
    })

    // Precalculate all path SVG coordinates inside useMemo so re-renders never mutate coordinates!
    linkList.forEach(link => {
      const sNode = link.source
      const tNode = link.target

      const sThickness = Math.max(2, (link.value / sNode.amount) * sNode.h)
      const tThickness = Math.max(2, (link.value / tNode.amount) * tNode.h)

      const yS1 = sNode.currSourceY
      const yS2 = yS1 + sThickness
      sNode.currSourceY = yS2

      const yT1 = tNode.currTargetY
      const yT2 = yT1 + tThickness
      tNode.currTargetY = yT2

      const x1 = sNode.x + nodeWidth
      const x2 = tNode.x
      const mx = (x1 + x2) / 2

      link.pathD = `
        M ${x1} ${yS1}
        C ${mx} ${yS1}, ${mx} ${yT1}, ${x2} ${yT1}
        L ${x2} ${yT2}
        C ${mx} ${yT2}, ${mx} ${yS2}, ${x1} ${yS2}
        Z
      `
    })

    return { nodes: nodeList, links: linkList, width, height, nodeWidth }
  }, [data, sizeMode])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>🌊 Diagramme de Flux Détaillé (Style Finary)</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Survolez ou cliquez sur les sources, catégories ou marchands pour explorer le parcours complet de vos revenus
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">

          <div className="flex items-center bg-gray-100 p-1 rounded-xl text-xs font-medium">
            <button
              onClick={() => setSizeMode('auto')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                sizeMode === 'auto'
                  ? 'bg-white text-emerald-700 font-bold shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              title="Hauteur ajustée automatiquement au nombre de détails"
            >
              🎯 Dynamique
            </button>
            <button
              onClick={() => setSizeMode('confort')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                sizeMode === 'confort'
                  ? 'bg-white text-gray-900 font-bold shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              🖥️ Confort
            </button>
            <button
              onClick={() => setSizeMode('xxl')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                sizeMode === 'xxl'
                  ? 'bg-white text-gray-900 font-bold shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              🌊 XXL
            </button>
          </div>
        </div>
      </div>

      {/* Sankey SVG Container */}
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[1250px] select-none">
          <defs>
            {links.map(link => (
              <linearGradient key={link.id} id={`grad-${link.id.replace(/[^a-zA-Z0-9]/g, '_')}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={link.source.color} stopOpacity="0.75" />
                <stop offset="100%" stopColor={link.target.color} stopOpacity="0.75" />
              </linearGradient>
            ))}
          </defs>

          {/* Links */}
          {links.map(link => {
            const sNode = link.source
            const tNode = link.target
            const pathD = link.pathD

            const isHovered =
              hoveredLinkId === link.id ||
              hoveredNodeId === sNode.id ||
              hoveredNodeId === tNode.id

            const anyHovered = hoveredNodeId !== null || hoveredLinkId !== null
            const opacity = anyHovered ? (isHovered ? 0.88 : 0.08) : 0.42

            const gradId = `grad-${link.id.replace(/[^a-zA-Z0-9]/g, '_')}`

            return (
              <path
                key={link.id}
                d={pathD}
                fill={`url(#${gradId})`}
                opacity={opacity}
                className="transition-opacity duration-200 cursor-pointer"
                onMouseEnter={() => setHoveredLinkId(link.id)}
                onMouseLeave={() => setHoveredLinkId(null)}
              >
                <title>{`${sNode.name} ➔ ${tNode.name} : ${fmt(link.value)}`}</title>
              </path>
            )
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const isHovered = hoveredNodeId === node.id || links.some(l => (l.source.id === node.id || l.target.id === node.id) && hoveredLinkId === l.id)
            const anyHovered = hoveredNodeId !== null || hoveredLinkId !== null
            const isDimmed = anyHovered && !isHovered && !links.some(l => (l.source.id === node.id || l.target.id === node.id) && (hoveredLinkId === l.id || hoveredNodeId === l.source.id || hoveredNodeId === l.target.id))

            const isCol0 = node.col === 0
            const isCol1 = node.col === 1
            const isCol2 = node.col === 2
            const maxCol = 3
            const isLastCol = node.col === maxCol

            return (
              <g
                key={node.id}
                className="cursor-pointer transition-transform duration-200"
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => {
                  if (node.rawId !== undefined && onSelectCategory) {
                    onSelectCategory(node.name, node.rawId)
                  }
                }}
              >
                {/* Node Pill Bar */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={nodeWidth}
                  height={Math.max(6, node.h)}
                  rx={5}
                  fill={node.color}
                  opacity={isDimmed ? 0.25 : 1}
                  className="transition-all duration-200 drop-shadow-sm"
                />

                {/* Col 0 Labels (to left of bar) */}
                {isCol0 && (
                  <text
                    x={node.x - 12}
                    y={node.y + node.h / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className={`text-xs transition-opacity duration-200 font-medium ${isDimmed ? 'opacity-30 text-gray-400' : 'text-gray-900 font-bold'}`}
                  >
                    <tspan>{node.icon} {node.name}</tspan>
                    <tspan x={node.x - 12} dy="15" className="fill-blue-600 font-extrabold text-xs">
                      {fmt(node.amount)}
                    </tspan>
                  </text>
                )}

                {/* Col 1 Label (Intermediate Central Hub - right above the bar) */}
                {isCol1 && (
                  <text
                    x={node.x + nodeWidth / 2}
                    y={Math.max(20, node.y - 12)}
                    textAnchor="middle"
                    className={`text-xs transition-opacity duration-200 ${isDimmed ? 'opacity-30 text-gray-400' : 'text-blue-700 font-extrabold text-[13px]'}`}
                  >
                    {node.icon} {node.name} ({fmt(node.amount)})
                  </text>
                )}

                {/* Col 2 Labels (Categories - to left of vertical bar) */}
                {isCol2 && (
                  <text
                    x={node.x - 10}
                    y={node.y + node.h / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className={`text-xs transition-opacity duration-200 font-medium ${isDimmed ? 'opacity-30 text-gray-400' : 'text-gray-800 font-semibold'}`}
                  >
                    <tspan>{node.icon} {node.name}</tspan>
                    <tspan x={node.x - 10} dy="14" className="fill-gray-500 font-normal text-[11px]">
                      {fmt(node.amount)} ({node.percentage}%)
                    </tspan>
                  </text>
                )}

                {/* Last Column Labels (Details - to right of vertical bar) */}
                {isLastCol && (
                  <g>
                    <rect
                      x={node.x + nodeWidth + 6}
                      y={node.y + node.h / 2 - 4}
                      width={6}
                      height={8}
                      rx={3}
                      fill={node.color}
                      opacity={isDimmed ? 0.25 : 0.8}
                    />
                    <text
                      x={node.x + nodeWidth + 18}
                      y={node.y + node.h / 2}
                      textAnchor="start"
                      dominantBaseline="middle"
                      className={`text-xs transition-opacity duration-200 font-medium ${isDimmed ? 'opacity-30 text-gray-400' : 'text-gray-800 font-semibold'}`}
                    >
                      <tspan>{node.name}</tspan>
                      <tspan x={node.x + nodeWidth + 18} dy="14" className="fill-gray-500 font-normal text-[11px]">
                        {fmt(node.amount)} ({node.percentage}%)
                      </tspan>
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
        <span>💡 Astuce : Survolez un flux pour isoler son parcours ou cliquez sur une catégorie pour voir ses transactions.</span>
        <span className="font-semibold text-gray-500">Inspiré par Finary &amp; Monarch</span>
      </div>
    </div>
  )
}
