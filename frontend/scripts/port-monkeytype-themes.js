// Regenerates the Monkeytype-sourced theme blocks in src/index.css and
// src/theme/themes.ts. Usage:
//   curl -sL https://raw.githubusercontent.com/monkeytypegame/monkeytype/master/frontend/src/ts/constants/themes.ts -o /tmp/mt_themes.ts
//   node scripts/port-monkeytype-themes.js /tmp/mt_themes.ts /tmp/out
// then manually splice /tmp/out/generated-themes.css and
// generated-themes-registry.txt into index.css / themes.ts (replacing the
// blocks between the "generated from Monkeytype" markers).
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(process.argv[2], 'utf8')

// Extract the `themes` object body
const start = src.indexOf('export const themes')
const braceStart = src.indexOf('{', start)
let depth = 0, end = -1
for (let i = braceStart; i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
}
const body = src.slice(braceStart + 1, end)

// Split into per-theme chunks by matching `key: {` ... `},`
const entryRe = /"?([A-Za-z0-9_]+)"?:\s*\{([^{}]*)\},?/g
const themes = {}
let m
while ((m = entryRe.exec(body))) {
  const name = m[1]
  const fieldsStr = m[2]
  const fields = {}
  const fieldRe = /(\w+):\s*"(#[0-9a-fA-F]{3,8})"/g
  let fm
  while ((fm = fieldRe.exec(fieldsStr))) fields[fm[1]] = fm[2]
  if (fields.bg && fields.main && fields.sub && fields.subAlt && fields.text) {
    themes[name] = fields
  }
}

console.error(`Parsed ${Object.keys(themes).length} themes`)

function hexToRgb(hex) {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  const n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}
function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB)
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function buildTheme(t) {
  const { bg, main, sub, subAlt, text } = t
  // Gray ramp: bg -> sub (50..400), sub -> text (400..900)
  const gray = {}
  const seg1 = [0, 0.25, 0.5, 0.75, 1] // 50,100,200,300,400
  const seg1Keys = [50, 100, 200, 300, 400]
  seg1Keys.forEach((k, i) => { gray[k] = mix(bg, sub, seg1[i]) })
  const seg2 = [0, 0.2, 0.4, 0.6, 0.8, 1] // 400,500,600,700,800,900
  const seg2Keys = [400, 500, 600, 700, 800, 900]
  seg2Keys.forEach((k, i) => { gray[k] = mix(sub, text, seg2[i]) })

  // Blue (accent) ramp anchored on `main`
  const blue = {}
  blue[50] = mix(bg, main, 0.12)
  blue[100] = mix(bg, main, 0.20)
  blue[200] = mix(bg, main, 0.32)
  blue[300] = mix(main, '#ffffff', 0.35)
  blue[400] = mix(main, '#ffffff', 0.20)
  blue[500] = mix(main, '#ffffff', 0.08)
  blue[600] = main
  blue[700] = mix(main, '#000000', 0.18)
  blue[800] = mix(main, '#000000', 0.35)

  const isLight = luminance(bg) > 0.5
  const black = isLight ? mix(bg, '#000000', 0.9) : mix(bg, '#000000', 0.35)

  return {
    colorScheme: isLight ? 'light' : 'dark',
    white: subAlt,
    black,
    gray,
    blue,
  }
}

const cssBlocks = []
const registryEntries = []

for (const [id, fields] of Object.entries(themes)) {
  const built = buildTheme(fields)
  const displayName = id.replace(/_/g, ' ')
  const lines = []
  lines.push(`:root[data-theme='${id}'] {`)
  lines.push(`  color-scheme: ${built.colorScheme};`)
  lines.push(`  --color-white: ${built.white};`)
  lines.push(`  --color-black: ${built.black};`)
  for (const k of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    lines.push(`  --gray-${k}: ${built.gray[k]};`)
  }
  for (const k of [50, 100, 200, 300, 400, 500, 600, 700, 800]) {
    lines.push(`  --blue-${k}: ${built.blue[k]};`)
  }
  lines.push(`}`)
  cssBlocks.push(lines.join('\n'))

  registryEntries.push(
    `  { id: '${id}', name: '${displayName}', bg: '${built.gray[50]}', colors: ['${built.blue[600]}', '${built.gray[900]}', '${built.gray[100]}'] },`
  )
}

const outDir = process.argv[3]
fs.writeFileSync(path.join(outDir, 'generated-themes.css'), cssBlocks.join('\n\n') + '\n')
fs.writeFileSync(path.join(outDir, 'generated-themes-registry.txt'), registryEntries.join('\n') + '\n')
console.error(`Wrote ${Object.keys(themes).length} theme blocks`)
