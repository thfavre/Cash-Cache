import { useEffect, useRef } from 'react'

interface Star { x: number; y: number; r: number; baseAlpha: number; twinkleSpeed: number; twinklePhase: number }
interface ShootingStar { x: number; y: number; vx: number; vy: number; life: number }

export default function NebulaEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let stars: Star[] = []
    let shootingStars: ShootingStar[] = []

    function resize() {
      const parent = canvas!.parentElement
      canvas!.width = parent?.clientWidth ?? 0
      canvas!.height = parent?.clientHeight ?? 0
      const count = Math.floor((canvas!.width * canvas!.height) / 5000)
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * canvas!.width,
        y: Math.random() * canvas!.height,
        r: Math.random() * 1.3 + 0.3,
        baseAlpha: Math.random() * 0.5 + 0.3,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinklePhase: Math.random() * Math.PI * 2,
      }))
    }
    resize()

    const resizeObserver = new ResizeObserver(resize)
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

    let t = 0
    let raf: number

    function draw() {
      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)

      const cx1 = w * 0.3 + Math.sin(t * 0.003) * 30
      const cy1 = h * 0.35 + Math.cos(t * 0.002) * 20
      const g1 = ctx!.createRadialGradient(cx1, cy1, 0, cx1, cy1, Math.max(w, h) * 0.4)
      g1.addColorStop(0, 'rgba(190, 60, 136, 0.18)')
      g1.addColorStop(1, 'rgba(190, 60, 136, 0)')
      ctx!.fillStyle = g1
      ctx!.fillRect(0, 0, w, h)

      const cx2 = w * 0.7 + Math.cos(t * 0.0025) * 25
      const cy2 = h * 0.6 + Math.sin(t * 0.0035) * 25
      const g2 = ctx!.createRadialGradient(cx2, cy2, 0, cx2, cy2, Math.max(w, h) * 0.35)
      g2.addColorStop(0, 'rgba(56, 100, 200, 0.15)')
      g2.addColorStop(1, 'rgba(56, 100, 200, 0)')
      ctx!.fillStyle = g2
      ctx!.fillRect(0, 0, w, h)

      stars.forEach(s => {
        const alpha = Math.max(0, s.baseAlpha + Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.3)
        ctx!.beginPath()
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(255, 255, 255, ${alpha})`
        ctx!.fill()
      })

      if (shootingStars.length === 0 && Math.random() < 0.0012) {
        shootingStars.push({
          x: Math.random() * w * 0.6,
          y: 0,
          vx: 4 + Math.random() * 3,
          vy: 2 + Math.random() * 2,
          life: 1,
        })
      }
      shootingStars = shootingStars.filter(s => s.life > 0)
      shootingStars.forEach(s => {
        ctx!.beginPath()
        ctx!.moveTo(s.x, s.y)
        ctx!.lineTo(s.x - s.vx * 6, s.y - s.vy * 6)
        ctx!.strokeStyle = `rgba(255, 255, 255, ${s.life})`
        ctx!.lineWidth = 1.5
        ctx!.stroke()
        s.x += s.vx
        s.y += s.vy
        s.life -= 0.02
      })

      t += 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
}
