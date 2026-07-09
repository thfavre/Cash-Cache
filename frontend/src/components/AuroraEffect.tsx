import { useEffect, useRef } from 'react'

const BANDS = [
  { color: '34, 197, 94', speed: 0.015, amp: 40, freq: 0.008, yBase: 0.25 },
  { color: '168, 85, 247', speed: 0.011, amp: 55, freq: 0.006, yBase: 0.4 },
  { color: '16, 185, 129', speed: 0.02, amp: 30, freq: 0.01, yBase: 0.15 },
]

export default function AuroraEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    function resize() {
      const parent = canvas!.parentElement
      canvas!.width = parent?.clientWidth ?? 0
      canvas!.height = parent?.clientHeight ?? 0
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

      BANDS.forEach(band => {
        ctx!.beginPath()
        ctx!.moveTo(0, h)
        for (let x = 0; x <= w; x += 8) {
          const y = band.yBase * h
            + Math.sin(x * band.freq + t * band.speed) * band.amp
            + Math.sin(x * band.freq * 2.3 + t * band.speed * 1.7) * band.amp * 0.4
          ctx!.lineTo(x, y)
        }
        ctx!.lineTo(w, h)
        ctx!.closePath()
        const gradient = ctx!.createLinearGradient(0, 0, 0, h)
        gradient.addColorStop(0, `rgba(${band.color}, 0.35)`)
        gradient.addColorStop(1, `rgba(${band.color}, 0)`)
        ctx!.fillStyle = gradient
        ctx!.fill()
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

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none opacity-90"
      style={{ filter: 'blur(8px)' }}
    />
  )
}
