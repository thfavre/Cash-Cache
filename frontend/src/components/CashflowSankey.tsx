import React, { useState, useMemo } from 'react'
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
  col: number
  percentage?: number
  txCount?: number
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
}

const fmt = (n: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF' }).format(n)

export default function CashflowSankey({ data, onSelectCategory }: Props) {
  const [viewMode, setViewMode] = useState<'2col' | '3col'>('2col')
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null)

  const width = 900
  const height = 540
  const padY = 28
  const padX = 170
  const nodeWidth = 20

  const { nodes, links } = useMemo(() => {
    const { summary, inflows, outflows } = data
    const maxVal = Math.max(summary.income, summary.expenses, 1)

    const nodeList: Node[] = []
    const linkList: Link[] = []

    if (viewMode === '2col') {
      // Column 0: Inflows / Income
      const col0Nodes: { id: string; name: string; amount: number; color: string; icon: string }[] = []
      if (summary.income > 0) {
        col0Nodes.push({
          id: 'in_total',
          name: 'Revenus perçus',
          amount: summary.income,
          color: '#10B981',
          icon: '💰'
        })
      }
      if (summary.expenses > summary.income) {
        col0Nodes.push({
          id: 'in_deficit',
          name: 'Puisage sur réserves',
          amount: summary.expenses - summary.income,
          color: '#EF4444',
          icon: '📉'
        })
      }
      if (col0Nodes.length === 0) {
        col0Nodes.push({ id: 'in_empty', name: 'Aucune entrée', amount: 1, color: '#94A3B8', icon: '❓' })
      }

      // Column 1: Outflows + Savings
      const col1Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string; txCount?: number }[] = []
      for (const out of outflows) {
        if (out.amount > 0) {
          col1Nodes.push({
            id: `out_${out.id}_${out.name}`,
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
        col1Nodes.push({
          id: 'out_savings',
          name: 'Épargne constituée',
          amount: summary.net_savings,
          color: '#059669',
          icon: '🏦'
        })
      }
      if (col1Nodes.length === 0) {
        col1Nodes.push({ id: 'out_empty', name: 'Aucune sortie', amount: 1, color: '#94A3B8', icon: '❓' })
      }

      // Compute Y coords for Col 0 and Col 1
      const colCols = [col0Nodes, col1Nodes]
      const colX = [padX, width - padX - nodeWidth]

      colCols.forEach((items, cIdx) => {
        const totalColVal = items.reduce((sum, item) => sum + item.amount, 0) || 1
        const n = items.length
        const gap = Math.min(16, Math.max(4, (height - 2 * padY - n * 18) / Math.max(1, n - 1)))
        const availH = height - 2 * padY - (n - 1) * gap

        // Compute raw heights
        const rawH = items.map(item => Math.max(16, (item.amount / totalColVal) * availH))
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

      // Create links between col 0 and col 1
      const leftNodes = nodeList.filter(n => n.col === 0)
      const rightNodes = nodeList.filter(n => n.col === 1)

      if (leftNodes.length === 1) {
        const left = leftNodes[0]
        rightNodes.forEach(right => {
          linkList.push({
            id: `${left.id}->${right.id}`,
            source: left,
            target: right,
            value: right.amount,
            color: right.color
          })
        })
      } else {
        // Proportional links from each left node to each right node
        leftNodes.forEach(left => {
          rightNodes.forEach(right => {
            const val = (left.amount / (left.amount + (leftNodes[1]?.amount || 0))) * right.amount
            if (val > 0.01) {
              linkList.push({
                id: `${left.id}->${right.id}`,
                source: left,
                target: right,
                value: val,
                color: right.color
              })
            }
          })
        })
      }
    } else {
      // 3 Column Mode: Inflows -> Total -> Outflows
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
      if (summary.expenses > summary.income) {
        col0Nodes.push({
          id: 'in_deficit',
          name: 'Puisage réserves',
          amount: summary.expenses - summary.income,
          color: '#EF4444',
          icon: '📉'
        })
      }
      if (col0Nodes.length === 0) {
        col0Nodes.push({ id: 'in_empty', name: 'Revenus', amount: 1, color: '#10B981', icon: '💰' })
      }

      const col1Nodes = [
        { id: 'hub', name: 'Flux de Trésorerie', amount: maxVal, color: '#3B82F6', icon: '🌊' }
      ]

      const col2Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string; txCount?: number }[] = []
      outflows.forEach(out => {
        if (out.amount > 0) {
          col2Nodes.push({
            id: `out_${out.id}_${out.name}`,
            rawId: out.id,
            name: out.name,
            amount: out.amount,
            color: out.color || '#64748B',
            icon: out.icon || '📦',
            txCount: out.tx_count
          })
        }
      })
      if (summary.net_savings > 0.01) {
        col2Nodes.push({
          id: 'out_savings',
          name: 'Épargne constituée',
          amount: summary.net_savings,
          color: '#059669',
          icon: '🏦'
        })
      }
      if (col2Nodes.length === 0) {
        col2Nodes.push({ id: 'out_empty', name: 'Dépenses', amount: 1, color: '#64748B', icon: '📦' })
      }

      const colCols = [col0Nodes, col1Nodes, col2Nodes]
      const colX = [padX, width / 2 - nodeWidth / 2, width - padX - nodeWidth]

      colCols.forEach((items, cIdx) => {
        const totalColVal = items.reduce((sum, item) => sum + item.amount, 0) || 1
        const n = items.length
        const gap = Math.min(16, Math.max(4, (height - 2 * padY - n * 18) / Math.max(1, n - 1)))
        const availH = height - 2 * padY - (n - 1) * gap

        const rawH = items.map(item => Math.max(16, (item.amount / totalColVal) * availH))
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
      const rightNodes = nodeList.filter(n => n.col === 2)

      leftNodes.forEach(left => {
        linkList.push({
          id: `${left.id}->hub`,
          source: left,
          target: hubNode,
          value: left.amount,
          color: left.color
        })
      })

      rightNodes.forEach(right => {
        linkList.push({
          id: `hub->${right.id}`,
          source: hubNode,
          target: right,
          value: right.amount,
          color: right.color
        })
      })
    }

    return { nodes: nodeList, links: linkList }
  }, [data, viewMode, width, height])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>🌊 Diagramme de Flux (Sankey)</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Visualisez instantanément la répartition de vos revenus vers chaque catégorie de dépense
          </p>
        </div>

        <div className="flex items-center bg-gray-100 p-1 rounded-xl text-xs font-medium">
          <button
            onClick={() => setViewMode('2col')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              viewMode === '2col'
                ? 'bg-white text-gray-900 shadow-sm font-semibold'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Vue Directe (Entrées ➔ Sorties)
          </button>
          <button
            onClick={() => setViewMode('3col')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              viewMode === '3col'
                ? 'bg-white text-gray-900 shadow-sm font-semibold'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Vue 3 Niveaux (Sources ➔ Hub)
          </button>
        </div>
      </div>

      {/* Sankey SVG Container */}
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[700px] select-none">
          <defs>
            {links.map(link => (
              <linearGradient key={link.id} id={`grad-${link.id.replace(/[^a-zA-Z0-9]/g, '_')}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={link.source.color} stopOpacity="0.8" />
                <stop offset="100%" stopColor={link.target.color} stopOpacity="0.8" />
              </linearGradient>
            ))}
          </defs>

          {/* Links */}
          {links.map(link => {
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

            const pathD = `
              M ${x1} ${yS1}
              C ${mx} ${yS1}, ${mx} ${yT1}, ${x2} ${yT1}
              L ${x2} ${yT2}
              C ${mx} ${yT2}, ${mx} ${yS2}, ${x1} ${yS2}
              Z
            `

            const isHovered =
              hoveredLinkId === link.id ||
              hoveredNodeId === sNode.id ||
              hoveredNodeId === tNode.id

            const anyHovered = hoveredNodeId !== null || hoveredLinkId !== null
            const opacity = anyHovered ? (isHovered ? 0.85 : 0.1) : 0.45

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
            const isHovered = hoveredNodeId === node.id
            const anyHovered = hoveredNodeId !== null || hoveredLinkId !== null
            const isDimmed = anyHovered && !isHovered && !links.some(l => (l.source.id === node.id || l.target.id === node.id) && (hoveredLinkId === l.id || hoveredNodeId === l.source.id || hoveredNodeId === l.target.id))

            const isLeft = node.col === 0
            const isRight = node.col === (viewMode === '2col' ? 1 : 2)

            return (
              <g
                key={node.id}
                className="cursor-pointer transition-transform duration-200"
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => {
                  if (node.rawId && onSelectCategory) {
                    onSelectCategory(node.name, node.rawId)
                  }
                }}
              >
                {/* Node Rectangle */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={nodeWidth}
                  height={Math.max(6, node.h)}
                  rx={6}
                  fill={node.color}
                  opacity={isDimmed ? 0.25 : 1}
                  className="transition-all duration-200 drop-shadow-sm"
                />

                {/* Left Labels */}
                {isLeft && (
                  <text
                    x={node.x - 12}
                    y={node.y + node.h / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className={`text-xs transition-opacity duration-200 font-medium ${isDimmed ? 'opacity-30 text-gray-400' : 'text-gray-800 font-semibold'}`}
                  >
                    <tspan>{node.icon} {node.name}</tspan>
                    <tspan x={node.x - 12} dy="14" className="fill-gray-500 font-normal text-[11px]">
                      {fmt(node.amount)} ({node.percentage}%)
                    </tspan>
                  </text>
                )}

                {/* Right Labels */}
                {isRight && (
                  <text
                    x={node.x + nodeWidth + 12}
                    y={node.y + node.h / 2}
                    textAnchor="start"
                    dominantBaseline="middle"
                    className={`text-xs transition-opacity duration-200 font-medium ${isDimmed ? 'opacity-30 text-gray-400' : 'text-gray-800 font-semibold'}`}
                  >
                    <tspan>{node.icon} {node.name}</tspan>
                    <tspan x={node.x + nodeWidth + 12} dy="14" className="fill-gray-500 font-normal text-[11px]">
                      {fmt(node.amount)} ({node.percentage}%)
                    </tspan>
                  </text>
                )}

                {/* Center Hub Label */}
                {!isLeft && !isRight && (
                  <text
                    x={node.x + nodeWidth / 2}
                    y={node.y - 12}
                    textAnchor="middle"
                    className="text-xs font-bold fill-gray-700"
                  >
                    {node.icon} {node.name} ({fmt(node.amount)})
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between text-xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Astuce : Survolez une catégorie ou un flux pour isoler son parcours
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span> Cliquez sur une catégorie pour voir le détail des transactions
        </span>
      </div>
    </div>
  )
}
