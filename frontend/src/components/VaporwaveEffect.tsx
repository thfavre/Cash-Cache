import { useEffect, useRef } from 'react'

const HORIZON_RATIO = 0.58
const GRID_LINES = 14
const GRID_SPEED = 0.005
const STAR_COUNT = 18

interface Star { x: number; y: number; r: number; phase: number }

export default function VaporwaveEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let stars: Star[] = []

    function resize() {
      const parent = canvas!.parentElement
      canvas!.width = parent?.clientWidth ?? 0
      canvas!.height = parent?.clientHeight ?? 0
      const horizonY = canvas!.height * HORIZON_RATIO
      stars = Array.from({ length: STAR_COUNT }, () => ({
        x: Math.random() * canvas!.width,
        y: Math.random() * horizonY * 0.85,
        r: Math.random() * 1.2 + 0.4,
        phase: Math.random() * Math.PI * 2,
      }))
    }
    resize()

    const resizeObserver = new ResizeObserver(resize)
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

    let offset = 0
    let t = 0
    let raf: number

    function draw() {
      const w = canvas!.width
      const h = canvas!.height
      const horizonY = h * HORIZON_RATIO
      ctx!.clearRect(0, 0, w, h)

      const sky = ctx!.createLinearGradient(0, 0, 0, horizonY)
      sky.addColorStop(0, '#1a0b2e')
      sky.addColorStop(0.6, '#3a1d5c')
      sky.addColorStop(1, '#6b2f6e')
      ctx!.fillStyle = sky
      ctx!.fillRect(0, 0, w, horizonY)

      stars.forEach(s => {
        const alpha = 0.4 + Math.sin(t * 0.02 + s.phase) * 0.3
        ctx!.beginPath()
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(255, 255, 255, ${Math.max(0, alpha)})`
        ctx!.fill()
      })

      const sunCx = w * 0.5
      const sunCy = horizonY - h * 0.05
      const sunR = h * 0.09

      ctx!.save()
      ctx!.shadowColor = 'rgba(247, 83, 139, 0.65)'
      ctx!.shadowBlur = 24
      ctx!.beginPath()
      ctx!.arc(sunCx, sunCy, sunR, 0, Math.PI * 2)
      ctx!.clip()
      const sunGrad = ctx!.createLinearGradient(0, sunCy - sunR, 0, sunCy + sunR)
      sunGrad.addColorStop(0, '#ffe29a')
      sunGrad.addColorStop(0.45, '#ff9ecb')
      sunGrad.addColorStop(1, '#b25ce0')
      ctx!.fillStyle = sunGrad
      ctx!.fillRect(sunCx - sunR, sunCy - sunR, sunR * 2, sunR * 2)
      ctx!.shadowBlur = 0
      ctx!.fillStyle = 'rgba(26, 11, 46, 0.8)'
      const bandCount = 7
      for (let i = 0; i < bandCount; i++) {
        const y = sunCy + sunR * 0.15 + i * (sunR * 0.75) / bandCount
        ctx!.fillRect(sunCx - sunR, y, sunR * 2, sunR * 0.09)
      }
      ctx!.restore()

      const ground = ctx!.createLinearGradient(0, horizonY, 0, h)
      ground.addColorStop(0, '#241247')
      ground.addColorStop(1, '#0c0620')
      ctx!.fillStyle = ground
      ctx!.fillRect(0, horizonY, w, h - horizonY)

      offset += GRID_SPEED
      const vanishX = w / 2

      ctx!.save()
      ctx!.shadowColor = 'rgba(247, 83, 139, 0.5)'
      ctx!.shadowBlur = 4
      ctx!.strokeStyle = 'rgba(247, 83, 139, 0.55)'
      ctx!.lineWidth = 1
      for (let i = 0; i < GRID_LINES; i++) {
        const p = (i + (offset % 1)) / GRID_LINES
        const y = horizonY + Math.pow(p, 2.2) * (h - horizonY)
        ctx!.globalAlpha = Math.max(0, 1 - p * 0.7)
        ctx!.beginPath()
        ctx!.moveTo(0, y)
        ctx!.lineTo(w, y)
        ctx!.stroke()
      }
      ctx!.globalAlpha = 1

      const numVert = 9
      for (let i = -numVert; i <= numVert; i++) {
        const xBottom = vanishX + i * (w / numVert)
        ctx!.globalAlpha = 0.35
        ctx!.beginPath()
        ctx!.moveTo(vanishX, horizonY)
        ctx!.lineTo(xBottom, h)
        ctx!.stroke()
      }
      ctx!.restore()

      t += 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none opacity-60" />
}
