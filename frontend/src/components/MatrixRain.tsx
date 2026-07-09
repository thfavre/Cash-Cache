import { useEffect, useRef } from 'react'

const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789'
const FONT_SIZE = 14

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let drops: number[] = []

    function resize() {
      const parent = canvas!.parentElement
      canvas!.width = parent?.clientWidth ?? 0
      canvas!.height = parent?.clientHeight ?? 0
      const columns = Math.max(1, Math.floor(canvas!.width / FONT_SIZE))
      drops = Array.from({ length: columns }, () => Math.random() * -50)
    }
    resize()

    const resizeObserver = new ResizeObserver(resize)
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

    function draw() {
      ctx!.fillStyle = 'rgba(0, 0, 0, 0.08)'
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height)
      ctx!.fillStyle = '#00ff41'
      ctx!.font = `${FONT_SIZE}px monospace`
      drops.forEach((y, i) => {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)]
        ctx!.fillText(char, i * FONT_SIZE, y * FONT_SIZE)
        drops[i] = y * FONT_SIZE > canvas!.height && Math.random() > 0.975 ? 0 : y + 1
      })
    }

    const interval = setInterval(draw, 50)
    return () => {
      clearInterval(interval)
      resizeObserver.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none opacity-80" />
}
