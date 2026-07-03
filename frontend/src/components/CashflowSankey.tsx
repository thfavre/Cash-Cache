import React, { useMemo, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { CashflowData } from '../api'

interface DrillDownFilter {
  merchant?: string
  merchants?: string[]
  label?: string
  isCredit?: boolean
}

interface Props {
  data: CashflowData
  onSelectCategory?: (categoryName: string, categoryId?: number, filter?: DrillDownFilter) => void
}

interface Node {
  id: string
  rawId?: number
  name: string
  amount: number
  color: string
  icon: string
  txCount?: number
  merchant?: string
  detail?: { name: string; amount: number }[]
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

const daysInMonth = (monthStr: string) => {
  const [y, m] = monthStr.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

const trunc = (str: string, n: number) => {
  if (!str) return ''
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

export default function CashflowSankey({ data, onSelectCategory }: Props) {
  const [chartHeight, setChartHeight] = useState<number>(1000)
  const [zoom, setZoom] = useState<number>(100)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null)
  const [avgMode, setAvgMode] = useState<'total' | 'year' | 'month' | 'day' | 'minute'>('total')

  const divisor = useMemo(() => {
    if (avgMode === 'total') return 1
    const monthCount = data.monthly_trend.length
    if (monthCount === 0) return 1
    if (avgMode === 'month') return monthCount
    const dayCount = data.monthly_trend.reduce((s, m) => s + daysInMonth(m.month), 0) || 1
    if (avgMode === 'year') return dayCount / 365.25
    if (avgMode === 'day') return dayCount
    return dayCount * 1440 // minute
  }, [avgMode, data.monthly_trend])

  const fmtAmt = (n: number) => fmt(n / divisor)

  const { nodes, links, width, height, nodeWidth } = useMemo(() => {
    const { summary, inflows, outflows } = data

    // Calculate actual total inflows and outflows
    const totalIncome = summary.income
    const totalOutflows = outflows.reduce((sum, out) => sum + out.amount, 0)

    const hasDeficit = totalOutflows > totalIncome
    const deficitAmount = hasDeficit ? (totalOutflows - totalIncome) : 0
    const surplusAmount = !hasDeficit ? (totalIncome - totalOutflows) : 0

    // maxVal is the total flow volume traversing the hub
    const maxVal = Math.max(totalIncome + deficitAmount, totalOutflows, 1)

    const width = 1450
    let height = 800
    let padY = 40
    const padX = 40
    const nodeWidth = 14

    const nodeList: Node[] = []
    const linkList: Link[] = []

    // Column 0: Sources of Income / Inflows
    const col0Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string }[] = []
    inflows.forEach((inf, i) => {
      if (inf.amount > 0) {
        col0Nodes.push({
          id: `in_${i}`,
          rawId: inf.id ?? undefined,
          name: inf.name,
          amount: inf.amount,
          color: inf.color || '#10B981',
          icon: inf.icon || ''
        })
      }
    })
    if (deficitAmount > 0.01) {
      col0Nodes.push({
        id: 'in_deficit',
        name: 'Puisage sur réserves',
        amount: deficitAmount,
        color: '#EF4444',
        icon: ''
      })
    }
    if (col0Nodes.length === 0) {
      col0Nodes.push({
        id: 'in_budget',
        name: 'Revenus perçus',
        amount: maxVal,
        color: '#10B981',
        icon: ''
      })
    }

    // Column 1: Intermediate Hub Layer (All money in goes here!)
    const col1Nodes = [
      { id: 'hub_budget', name: 'Budget', amount: maxVal, color: '#F97316', icon: '' }
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
          icon: out.icon || '',
          txCount: out.tx_count
        })
      }
    }
    if (surplusAmount > 0.01) {
      col2Nodes.push({
        id: 'cat_savings',
        name: 'Solde Net restant',
        amount: surplusAmount,
        color: '#10B981',
        icon: ''
      })
    }
    if (col2Nodes.length === 0) {
      col2Nodes.push({ id: 'cat_empty', name: 'Dépenses', amount: 1, color: '#94A3B8', icon: '' })
    }

    // Column 3: Subitems / Merchants
    const col3Nodes: { id: string; rawId?: number; name: string; amount: number; color: string; icon: string; merchant?: string; detail?: { name: string; amount: number }[] }[] = []
    for (const out of outflows) {
      if (out.amount > 0 && out.subitems && out.subitems.length > 0) {
        for (let i = 0; i < out.subitems.length; i++) {
          const sub = out.subitems[i]
          const isAggregate = sub.name.startsWith('Autres ')
          col3Nodes.push({
            id: `sub_${out.id}_${i}`,
            rawId: out.id,
            name: sub.name,
            amount: sub.amount,
            color: out.color || '#64748B',
            icon: out.icon || '📌',
            merchant: isAggregate ? undefined : sub.name,
            detail: sub.detail
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
    if (surplusAmount > 0.01) {
      col3Nodes.push({
        id: 'sub_savings_acc',
        name: 'Solde Net restant',
        amount: surplusAmount,
        color: '#10B981',
        icon: '✨'
      })
    }
    if (col3Nodes.length === 0) {
      col3Nodes.push({ id: 'sub_empty', name: 'Détail', amount: 1, color: '#94A3B8', icon: '▪' })
    }

    const colCols = [col0Nodes, col1Nodes, col2Nodes, col3Nodes]
    const maxNodes = Math.max(col0Nodes.length, col1Nodes.length, col2Nodes.length, col3Nodes.length)
    height = chartHeight
    
    // Smoothly interpolate padding, min gap, and min node height based on height to eliminate dead zones
    padY = Math.max(15, Math.min(40, Math.round((height / 1000) * 40)))
    const minGap = Math.max(2, Math.min(8, Math.round((height / 1000) * 8)))
    const minNodeH = Math.max(2, Math.min(4, Math.round((height / 1000) * 4)))
    
    const colX = [60, 420, 780, 1100]

    // Calculate a uniform gap and a single global yScale based on maxNodes
    const gap = Math.min(20, Math.max(minGap, (height - 2 * padY - maxNodes * (minNodeH + 4)) / Math.max(1, maxNodes - 1)))
    const yScale = Math.max(0.01, (height - 2 * padY - (maxNodes - 1) * gap) / maxVal)

    colCols.forEach((items, cIdx) => {
      const totalColHeight = items.reduce((sum, item) => sum + Math.max(minNodeH, item.amount * yScale), 0) + (items.length - 1) * gap
      let currY = padY + Math.max(0, (height - 2 * padY - totalColHeight) / 2)

      items.forEach((item) => {
        // Height is scaled globally. We use a dynamic minimum height of 2px (small) or 4px (normal).
        const h = Math.max(minNodeH, item.amount * yScale)
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

    // Auto-expand height if nodes overflow due to minimum height constraints
    let maxY = height
    nodeList.forEach(n => {
      if (n.y + n.h + padY > maxY) {
        maxY = n.y + n.h + padY
      }
    })
    height = maxY

    // Second pass: Re-align columns vertically based on the final height to ensure centering
    for (let c = 0; c < 4; c++) {
      const colNodes = nodeList.filter(n => n.col === c)
      if (colNodes.length > 0) {
        const totalColHeight = colNodes.reduce((sum, n) => sum + n.h, 0) + (colNodes.length - 1) * gap
        const newStartY = padY + Math.max(0, (height - 2 * padY - totalColHeight) / 2)
        const shiftY = newStartY - colNodes[0].y
        if (Math.abs(shiftY) > 0.01) {
          colNodes.forEach(n => {
            n.y += shiftY
            n.currSourceY += shiftY
            n.currTargetY += shiftY
          })
        }
      }
    }

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
  }, [data, chartHeight])


  const handleNodeClick = (node: Node) => {
    if (node.rawId === undefined || !onSelectCategory) return
    if (node.col === 0) {
      onSelectCategory(node.name, node.rawId, { isCredit: true })
      return
    }
    const catNode = nodes.find(n => n.col === 2 && n.rawId === node.rawId)
    const catName = catNode ? catNode.name : node.name
    if (node.col !== 3) {
      onSelectCategory(catName, node.rawId)
    } else if (node.detail && node.detail.length > 0) {
      onSelectCategory(catName, node.rawId, { merchants: node.detail.map(d => d.name), label: node.name })
    } else {
      onSelectCategory(catName, node.rawId, node.merchant ? { merchant: node.merchant } : undefined)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>Diagramme de Flux Détaillé</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Survolez ou cliquez sur les sources, catégories ou marchands pour explorer le parcours complet de vos revenus
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 bg-gray-50 border border-gray-150 px-4 py-2 rounded-xl text-xs font-medium shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-semibold">Valeurs :</span>
            <div className="bg-gray-200/70 p-0.5 rounded-lg flex items-center text-[11px]">
              {([['total', 'Total'], ['year', 'Par an'], ['month', 'Par mois'], ['day', 'Par jour'], ['minute', 'Par minute']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setAvgMode(id)}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    avgMode === id ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-4 w-px bg-gray-200 hidden sm:block"></div>

          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-semibold">Hauteur :</span>
            <input
              type="range"
              min="300"
              max="2000"
              step="50"
              value={chartHeight}
              onChange={(e) => setChartHeight(Number(e.target.value))}
              className="w-28 sm:w-32 accent-blue-600 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-gray-900 font-extrabold w-12 text-right">{chartHeight}px</span>
          </div>

          <div className="h-4 w-px bg-gray-200 hidden sm:block"></div>

          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-semibold">Zoom :</span>
            <input
              type="range"
              min="50"
              max="150"
              step="5"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-28 sm:w-32 accent-blue-600 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-gray-900 font-extrabold w-10 text-right">{zoom}%</span>
          </div>
        </div>
      </div>

      {/* Sankey SVG Container */}
      <div className="relative w-full overflow-x-auto flex justify-center">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: `${zoom}%`,
            minWidth: `${Math.round(1250 * (zoom / 100))}px`,
            maxWidth: 'none',
            height: 'auto'
          }}
          className="select-none"
        >
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
                onClick={() => handleNodeClick(tNode.col === 1 ? sNode : tNode)}
              >
                <title>{`${sNode.name} ➔ ${tNode.name} : ${fmtAmt(link.value)}`}</title>
              </path>
            )
          })}

          {/* Node Bars */}
          {nodes.map(node => {
            const isDirectOrLinkHovered = hoveredNodeId === node.id || links.some(l => (l.source.id === node.id || l.target.id === node.id) && hoveredLinkId === l.id)
            const isConnectedHovered = hoveredNodeId !== null && links.some(l => (l.source.id === hoveredNodeId && l.target.id === node.id) || (l.target.id === hoveredNodeId && l.source.id === node.id))
            const isHighlighted = isDirectOrLinkHovered || isConnectedHovered
            const anyHovered = hoveredNodeId !== null || hoveredLinkId !== null
            const isDimmed = anyHovered && !isHighlighted

            return (
              <g
                key={`bar-${node.id}`}
                className="cursor-pointer transition-transform duration-200"
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => handleNodeClick(node)}
              >
                {/* Node Pill Bar */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={nodeWidth}
                  height={Math.max(6, node.h)}
                  rx={5}
                  fill={node.color}
                  opacity={isDimmed ? 0.2 : 1}
                  className="transition-all duration-200 drop-shadow-sm"
                >
                  {node.detail && node.detail.length > 0 && (
                    <title>
                      {`${node.name} : ${fmtAmt(node.amount)}\n` +
                        node.detail.map(d => `• ${d.name} : ${fmtAmt(d.amount)}`).join('\n')}
                    </title>
                  )}
                </rect>
              </g>
            )
          })}

          {/* Node Labels (Drawn last to guarantee they sit on top of all ribbons and bars) */}
          {nodes.map(node => {
            const isDirectOrLinkHovered = hoveredNodeId === node.id || links.some(l => (l.source.id === node.id || l.target.id === node.id) && hoveredLinkId === l.id)
            const isConnectedHovered = hoveredNodeId !== null && links.some(l => (l.source.id === hoveredNodeId && l.target.id === node.id) || (l.target.id === hoveredNodeId && l.source.id === node.id))
            const isHighlighted = isDirectOrLinkHovered || isConnectedHovered
            const anyHovered = hoveredNodeId !== null || hoveredLinkId !== null
            const isDimmed = anyHovered && !isHighlighted

            const isCol0 = node.col === 0
            const isCol1 = node.col === 1
            const isCol2 = node.col === 2
            const maxCol = 3
            const isLastCol = node.col === maxCol

            return (
              <g
                key={`label-${node.id}`}
                className="cursor-pointer transition-transform duration-200"
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => handleNodeClick(node)}
              >
                {/* Col 0 Labels (to right of bar, inside the first ribbon) */}
                {isCol0 && (
                  <text
                    x={node.x + nodeWidth + 12}
                    y={node.y + node.h / 2}
                    textAnchor="start"
                    dominantBaseline="middle"
                    className={`transition-all duration-200 ${
                      isHighlighted
                        ? 'text-[16px] font-black fill-blue-700 drop-shadow-sm'
                        : isDimmed
                        ? 'text-[13px] opacity-30 fill-gray-400 font-semibold'
                        : 'text-[13px] fill-gray-800 font-semibold'
                    }`}
                  >
                    <title>{node.name}: {fmtAmt(node.amount)}</title>
                    {node.icon ? `${node.icon} ` : ''}{trunc(node.name, 22)}: {fmtAmt(node.amount)}
                  </text>
                )}

                {/* Col 1 Label (Intermediate Budget - to left of bar, inside the ribbon) */}
                {isCol1 && (
                  <text
                    x={node.x - 12}
                    y={node.y + node.h / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className={`transition-all duration-200 ${
                      isHighlighted
                        ? 'text-[16px] font-black fill-blue-700 drop-shadow-sm'
                        : isDimmed
                        ? 'text-[13px] opacity-30 fill-gray-400 font-semibold'
                        : 'text-[13px] fill-gray-800 font-semibold'
                    }`}
                  >
                    <title>{node.name}: {fmtAmt(node.amount)}</title>
                    {trunc(node.name, 22)}: {fmtAmt(node.amount)}
                  </text>
                )}

                {/* Col 2 Labels (Categories - to left of bar) */}
                {isCol2 && (
                  <text
                    x={node.x - 10}
                    y={node.y + node.h / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className={`transition-all duration-200 ${
                      isHighlighted
                        ? 'text-[16px] font-black fill-blue-700 drop-shadow-sm'
                        : isDimmed
                        ? 'text-[13px] opacity-30 fill-gray-400 font-semibold'
                        : 'text-[13px] fill-gray-800 font-semibold'
                    }`}
                  >
                    <title>{node.name}: {fmtAmt(node.amount)}</title>
                    {trunc(node.name, 22)}: {fmtAmt(node.amount)}
                  </text>
                )}

                {/* Last Column Labels (Details - placed cleanly to the right of the vertical bar) */}
                {isLastCol && (
                  <text
                    x={node.x + nodeWidth + 10}
                    y={node.y + node.h / 2}
                    textAnchor="start"
                    dominantBaseline="middle"
                    className={`transition-all duration-200 ${
                      isHighlighted
                        ? 'text-[15px] font-black fill-blue-700 drop-shadow-sm'
                        : isDimmed
                        ? 'text-[12px] opacity-30 fill-gray-400 font-medium'
                        : 'text-[12px] fill-gray-800 font-medium'
                    }`}
                  >
                    <title>{node.name}: {fmtAmt(node.amount)}</title>
                    {trunc(node.name, 22)}: {fmtAmt(node.amount)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
        <Lightbulb className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <span>Astuce : Survolez un flux pour isoler son parcours ou cliquez sur une catégorie pour voir ses transactions.</span>
      </div>
    </div>
  )
}
