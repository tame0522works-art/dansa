// 同梱する src/data/network.json の形と、元データについて分かっていること（2026-10-21 確認）が保たれているかを確かめる。
// 取り直したデータで前提が崩れたら、ここで止まる。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Kind, Slope, Step, Struct, UNKNOWN, Width, type Network } from '../src/data/types.ts'
import { ATTRIBUTION, DATASET_PAGE } from './source.ts'

const net: Network = JSON.parse(readFileSync(new URL('../src/data/network.json', import.meta.url), 'utf8'))
const n = net.floors.length
const m = net.links.from.length

assert.equal(net.attribution, ATTRIBUTION)
assert.equal(net.source.page, DATASET_PAGE)
assert.match(net.source.fetchedAt, /^\d{4}-\d{2}-\d{2}$/)
assert.equal(net.nodes.length, n * 2)
assert.ok(net.nodes.every(Number.isInteger))

// 範囲は日比谷公園の南西〜神保町の北、皇居の西〜八重洲の東。原点から 3km 以内に収まる
for (let i = 0; i < n; i++) {
  const [x, y] = [net.nodes[2 * i], net.nodes[2 * i + 1]]
  assert.ok(Math.hypot(x, y) < 300_000, `点 ${i} が原点から遠い`)
}

// 地下は含まない。階層は地上（0）・踊り場（0.5）・デッキ（1）だけ
assert.deepEqual([...new Set(net.floors)].sort(), [0, 0.5, 1])

const codes = {
  struct: [...Object.values(Struct), UNKNOWN],
  kind: [...Object.values(Kind), UNKNOWN],
  width: [...Object.values(Width), UNKNOWN],
  slope: [...Object.values(Slope), UNKNOWN],
  step: [...Object.values(Step), UNKNOWN],
}
for (const [k, allowed] of Object.entries(codes)) {
  const col = net.links[k as keyof typeof codes]
  assert.equal(col.length, m)
  for (const v of new Set(col)) assert.ok((allowed as number[]).includes(v), `${k} に未知のコード ${v}`)
}
assert.equal(net.links.struct.filter((s) => s === Struct.Underpass).length, 0, '地下通路が現れた。画面の注記を見直す')
assert.equal(net.links.kind.filter((s) => s === Kind.Elevator).length, 0, 'エレベーターの経路が現れた。画面の注記を見直す')

for (let i = 0; i < m; i++) {
  const [a, b] = [net.links.from[i], net.links.to[i]]
  assert.ok(a >= 0 && a < n && b >= 0 && b < n && a !== b, `経路 ${i} の端点`)
  assert.ok(Number.isInteger(net.links.length[i]) && net.links.length[i] > 0, `経路 ${i} の長さ`)
  // 経路は直線とみなして描くので、両端の直線距離（dm）が長さとかけ離れていないこと。
  // 長さは 0.1m 単位に丸められていて、0.2m の経路では直線距離と 2 割ずれるものがあるので、差は 0.3m までは許す
  const straight = Math.hypot(net.nodes[2 * b] - net.nodes[2 * a], net.nodes[2 * b + 1] - net.nodes[2 * a + 1]) / 10
  const len = net.links.length[i]
  assert.ok(Math.abs(straight - len) <= Math.max(0.1 * len, 3), `経路 ${i} は直線とみなせない（直線 ${straight / 10}m、長さ ${len / 10}m）`)
}

// ほぼ 1 つにつながっている（離れた小さなまとまりは 2 つ、計 25 点）
const parent = Array.from({ length: n }, (_, i) => i)
const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
for (let i = 0; i < m; i++) parent[find(net.links.from[i])] = find(net.links.to[i])
const sizes = new Map<number, number>()
for (let i = 0; i < n; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1)
const largest = Math.max(...sizes.values())
assert.ok(largest / n > 0.99, `いちばん大きいまとまりが ${largest}/${n} 点しかない`)

console.log(`check:data OK（点 ${n}・経路 ${m}・まとまり ${sizes.size} 個、最大 ${largest} 点）`)
