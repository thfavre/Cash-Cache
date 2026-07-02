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
  const [viewMode, setViewMode] = useState<'finary' | '2col' | '3col'>('finary')
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null)

  const width = 1100
  const height = 660
  const padY = 32
  const padX = 180
  const nodeWidth = 14

  const { nodes, links } = useMemo(() => {
    const { summary, inflows, outflows } = data
    const maxVal = Math.max(summary.income, summary.expenses, 1)

    const nodeList: Node[] = []
    const linkList: Link[] = []

    if (viewMode === 'finary') {
      // Finary 3-Level Hierarchy: Income -> Categories -> Subitems/Merchants
      const col0Nodes: { id: string; name: string; amount: number; color: string; icon: string }[] = []
      const totalIn = Math.max(summary.income, summary.expenses, 1)
      col0Nodes.push({
        id: 'in_budget',
        name: 'Revenus / Budget',
        amount: totalIn,
        color: '#3B82F6',
        icon: '💰'
      })

      const col1Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string; txCount?: number }[] = []
      for (const out of outflows) {
        if (out.amount > 0) {
          col1Nodes.push({
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
        col1Nodes.push({
          id: 'cat_savings',
          name: 'Épargne & Restant',
          amount: summary.net_savings,
          color: '#10B981',
          icon: '🏦'
        })
      }
      if (col1Nodes.length === 0) {
        col1Nodes.push({ id: 'cat_empty', name: 'Dépenses', amount: 1, color: '#94A3B8', icon: '❓' })
      }

      const col2Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string }[] = []
      for (const out of outflows) {
        if (out.amount > 0 && out.subitems && out.subitems.length > 0) {
          for (let i = 0; i < out.subitems.length; i++) {
            const sub = out.subitems[i]
            col2Nodes.push({
              id: `sub_${out.id}_${i}`,
              rawId: out.id,
              name: sub.name,
              amount: sub.amount,
              color: out.color || '#64748B',
              icon: out.icon || '📌'
            })
          }
        } else if (out.amount > 0) {
          col2Nodes.push({
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
        col2Nodes.push({
          id: 'sub_savings_acc',
          name: 'Accumulation Nette',
          amount: summary.net_savings,
          color: '#10B981',
          icon: '✨'
        })
      }
      if (col2Nodes.length === 0) {
        col2Nodes.push({ id: 'sub_empty', name: 'Détail', amount: 1, color: '#94A3B8', icon: '▪' })
      }

      const colCols = [col0Nodes, col1Nodes, col2Nodes]
      const colX = [padX, 540, width - padX - nodeWidth]

      colCols.forEach((items, cIdx) => {
        const totalColVal = items.reduce((sum, item) => sum + item.amount, 0) || 1
        const n = items.length
        const gap = Math.min(14, Math.max(3, (height - 2 * padY - n * 16) / Math.max(1, n - 1)))
        const availH = height - 2 * padY - (n - 1) * gap

        const rawH = items.map(item => Math.max(14, (item.amount / totalColVal) * availH))
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

      // Links Col 0 -> Col 1
      const rootNode = nodeList.find(n => n.col === 0)!
      const catNodes = nodeList.filter(n => n.col === 1)
      catNodes.forEach(cat => {
        linkList.push({
          id: `in_budget->${cat.id}`,
          source: rootNode,
          target: cat,
          value: cat.amount,
          color: cat.color
        })
      })

      // Links Col 1 -> Col 2
      const subNodes = nodeList.filter(n => n.col === 2)
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

    } else if (viewMode === '2col') {
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

      const colCols = [col0Nodes, col1Nodes]
      const colX = [padX, width - padX - nodeWidth]

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
        { id: 'hub', name: 'Flux Trésorerie', amount: maxVal, color: '#3B82F6', icon: '🌊' }
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

    return { nodes: nodeList, links: linkList }
  }, [data, viewMode, width, height])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>🌊 Diagramme de Flux Détaillé (Style Finary)</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Survolez ou cliquez sur les flux et catégories pour explorer en profondeur la destination de vos revenus
          </p>
        </div>

        <div className="flex items-center bg-gray-100 p-1 rounded-xl text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setViewMode('finary')}
            className={`px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all ${
              viewMode === 'finary'
                ? 'bg-white text-blue-700 shadow-sm font-bold'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            ✨ Détail Marchands (3 Niveaux)
          </button>
          <button
            onClick={() => setViewMode('2col')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${
              viewMode === '2col'
                ? 'bg-white text-gray-900 shadow-sm font-semibold'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Vue Directe (Entrées ➔ Sorties)
          </button>
          <button
            onClick={() => setViewMode('3col')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${
              viewMode === '3col'
                ? 'bg-white text-gray-900 shadow-sm font-semibold'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Hub Trésorerie
          </button>
        </div>
      </div>

      {/* Sankey SVG Container */}
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[850px] select-none">
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
            const maxCol = viewMode === 'finary' || viewMode === '3col' ? 2 : 1
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

                {/* Col 1 Labels (Middle categories in Finary view -> to left of vertical bar) */}
                {!isCol0 && !isLastCol && (
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

                {/* Last Column Labels (to right of vertical bar) */}
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
