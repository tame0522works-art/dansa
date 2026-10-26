// 国交省の歩行者移動支援サイトから、各地域の CSV を raw/<地域>/ に取ってくる。
// ダウンロードした時点で政府標準利用規約（第2.0版）に同意したものとみなされる（配布ページの記載）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { SOURCES, rawPath } from './source.ts'

// 利用者エージェントを付けないと 403 が返る
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (dansa; +https://github.com/tame0522works-art)' }

for (const s of SOURCES) {
  mkdirSync(`raw/${s.id}`, { recursive: true })
  for (const [url, file] of [
    [s.link, 'link.csv'],
    [s.node, 'node.csv'],
  ] as const) {
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    // 先頭に BOM が付いている地域がある（渋谷〜新宿）
    const text = (await res.text()).replace(/^﻿/, '')
    if (!text.startsWith('link_id,') && !text.startsWith('node_id,')) throw new Error(`${url}: CSV ではない応答`)
    writeFileSync(rawPath(s.id, file), text)
    console.log(`${rawPath(s.id, file)}: ${text.trim().split('\n').length - 1} 行`)
  }
  writeFileSync(rawPath(s.id, 'fetched-at.txt'), new Date().toISOString().slice(0, 10))
}
