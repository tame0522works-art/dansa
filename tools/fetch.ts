// 国交省の歩行者移動支援サイトから CSV を raw/ に取ってくる。
// ダウンロードした時点で政府標準利用規約（第2.0版）に同意したものとみなされる（配布ページの記載）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { FETCHED_AT_PATH, FILES } from './source.ts'

// 利用者エージェントを付けないと 403 が返る
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (dansa; +https://github.com/tame0522works-art)' }

mkdirSync('raw', { recursive: true })
for (const { url, path } of Object.values(FILES)) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const text = await res.text()
  if (!text.startsWith('link_id,') && !text.startsWith('node_id,')) throw new Error(`${url}: CSV ではない応答`)
  writeFileSync(path, text)
  console.log(`${path}: ${text.split('\n').length - 1} 行`)
}
writeFileSync(FETCHED_AT_PATH, new Date().toISOString().slice(0, 10))
