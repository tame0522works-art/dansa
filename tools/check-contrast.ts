// 色の組み合わせが見分けられるかを確かめる（WCAG のコントラスト比）。文字は 4.5 以上、文字以外の部品は 3 以上（WCAG 1.4.11）。
// 画面の部品は src/index.css の :root（ライト）と prefers-color-scheme: dark の変数から、地図に描く色は src/map/colors.ts から読む。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COLORS, MAP_BG } from '../src/map/colors.ts'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]))
}
const light = tokens(/:root\s*\{([^}]*)\}/.exec(css)![1])
const darkBlock = /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)
assert.ok(darkBlock, 'ダークモードの色が見つからない')
const dark = { ...light, ...tokens(darkBlock[1]) }

/** 相対輝度（WCAG 2） */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const failures: string[] = []
const need = (label: string, a: string, b: string, min: number) => {
  const r = ratio(a, b)
  if (r < min) failures.push(`${label}: ${r.toFixed(2)}（${min} 以上が要る。${a} / ${b}）`)
}

// 画面の部品（変数名で書く）
const PAIRS: [string, string, string, number][] = [
  ['本文の文字', 'fg', 'bg', 4.5],
  ['補足の文字（案内・注意・出典）', 'muted', 'bg', 4.5],
  ['選んだ利用者の枠と見本の線', 'route', 'bg', 3],
  ['最短の見本の線', 'shortest', 'bg', 3],
  ['通れない箇所を指す丸', 'blocked', 'bg', 3],
  ['フォーカスの枠', 'accent', 'bg', 3],
]
for (const [name, theme] of [
  ['ライト', light],
  ['ダーク', dark],
] as const) {
  for (const [label, fg, bg, min] of PAIRS) {
    assert.ok(theme[fg] && theme[bg], `${name}モードに --${fg} か --${bg} がない`)
    need(`${name}モードの${label}`, theme[fg], theme[bg], min)
  }
}

// 地図に描く色（地図の下地はどちらのモードでも明るい灰色）
const WHITE = '#ffffff'
need('地図: 利用者向けの道と下地', COLORS.route, MAP_BG, 3)
need('地図: 最短の道と下地', COLORS.shortest, MAP_BG, 3)
need('地図: 通れない箇所の破線と下地', COLORS.blocked, MAP_BG, 3)
need('地図: 避けた障害の印の文字（白地）', COLORS.avoided, WHITE, 4.5)
need('地図: それでも通る障害の印の文字', WHITE, COLORS.route, 4.5)
need('地図: 通れない箇所の印の文字', WHITE, COLORS.blocked, 4.5)
need('地図: 「?」の印の文字（白地）', COLORS.shortest, WHITE, 4.5)
need('地図: 出発地のピンの文字', WHITE, COLORS.start, 4.5)
need('地図: 目的地のピンの文字', WHITE, COLORS.goal, 4.5)

assert.deepEqual(failures, [], `コントラスト比が足りない組み合わせがあります:\n${failures.join('\n')}`)
console.log('check:contrast OK')
