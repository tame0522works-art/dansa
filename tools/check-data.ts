// 同梱する src/data/<地域>.json の形と、元データについて分かっていること（2026-10-21・26 確認）が保たれているかを確かめる。
// 画面の注意（src/areas.ts の地下・エレベーターの有無）がデータと食い違ったら、ここで止まる。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AREAS } from '../src/areas.ts'
import { Direction, Kind, Slope, Step, Struct, UNKNOWN, Width, type Network } from '../src/data/types.ts'
import { SOURCES, attribution } from './source.ts'

assert.deepEqual(
  AREAS.map((a) => a.id),
  SOURCES.map((s) => s.id),
  '画面の地域（src/areas.ts）と元データの地域（tools/source.ts）が合わない',
)

const codes = {
  struct: [...Object.values(Struct), UNKNOWN],
  kind: [...Object.values(Kind), UNKNOWN],
  width: [...Object.values(Width), UNKNOWN],
  slope: [...Object.values(Slope), UNKNOWN],
  step: [...Object.values(Step), UNKNOWN],
  dir: [...Object.values(Direction), UNKNOWN],
}

for (const s of SOURCES) {
  const area = AREAS.find((a) => a.id === s.id)!
  const net: Network = JSON.parse(readFileSync(new URL(`../src/data/${s.id}.json`, import.meta.url), 'utf8'))
  const n = net.floors.length
  const m = net.links.from.length
  const at = (msg: string) => `${s.id}: ${msg}`

  assert.equal(net.attribution, attribution(s))
  assert.equal(net.source.page, s.page)
  assert.deepEqual(net.origin, s.origin)
  assert.match(net.source.fetchedAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(net.nodes.length, n * 2)
  assert.ok(net.nodes.every(Number.isInteger))

  // どの地域も駅のまわり数 km。原点（駅のあたり）から 4km 以内に収まる
  for (let i = 0; i < n; i++) assert.ok(Math.hypot(net.nodes[2 * i], net.nodes[2 * i + 1]) < 400_000, at(`点 ${i} が原点から遠い`))
  // 階層は地下 1 階〜デッキまで（0.5 刻みは踊り場）
  for (const f of new Set(net.floors)) assert.ok(f >= -1 && f <= 1 && Number.isInteger(f * 2), at(`階層 ${f}`))

  for (const [k, allowed] of Object.entries(codes)) {
    const col = net.links[k as keyof typeof codes]
    assert.equal(col.length, m)
    for (const v of new Set(col)) assert.ok((allowed as number[]).includes(v), at(`${k} に未知のコード ${v}`))
  }

  // 画面の注意とデータが合っているか
  const underground = net.floors.some((f) => f < 0) || net.links.struct.includes(Struct.Underpass)
  assert.equal(underground, area.underground, at(`地下の経路が${underground ? 'ある' : 'ない'}のに、src/areas.ts の underground が ${area.underground}`))
  const elevators = net.links.kind.includes(Kind.Elevator)
  assert.equal(elevators, area.elevators, at(`エレベーターの経路が${elevators ? 'ある' : 'ない'}のに、src/areas.ts の elevators が ${area.elevators}`))

  for (let i = 0; i < m; i++) {
    const [a, b] = [net.links.from[i], net.links.to[i]]
    assert.ok(a >= 0 && a < n && b >= 0 && b < n && a !== b, at(`経路 ${i} の端点`))
    const len = net.links.length[i]
    // 長さ 0 の経路が渋谷〜新宿の施設内通路に1本ある（元データどおり）
    assert.ok(Number.isInteger(len) && len >= 0, at(`経路 ${i} の長さ`))
    // エレベーターは乗り場どうしが平面上でほぼ同じ位置なので、直線かどうかは見ない
    if (net.links.kind[i] === Kind.Elevator) continue
    // 経路は直線とみなして描くので、両端の直線距離（dm）が長さとかけ離れていないこと。
    // 長さは 0.1m 単位に丸められていて、0.2m の経路では直線距離と 2 割ずれるものがあるので、差は 0.3m までは許す
    const straight = Math.hypot(net.nodes[2 * b] - net.nodes[2 * a], net.nodes[2 * b + 1] - net.nodes[2 * a + 1]) / 10
    assert.ok(Math.abs(straight - len) <= Math.max(0.1 * len, 3), at(`経路 ${i} は直線とみなせない（直線 ${straight / 10}m、長さ ${len / 10}m）`))
  }

  // ほぼ 1 つにつながっている（東京駅は離れた小さなまとまりが 2 つ、計 25 点。ほかの地域は 1 つ）
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (let i = 0; i < m; i++) parent[find(net.links.from[i])] = find(net.links.to[i])
  const sizes = new Map<number, number>()
  for (let i = 0; i < n; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1)
  const largest = Math.max(...sizes.values())
  assert.ok(largest / n > 0.99, at(`いちばん大きいまとまりが ${largest}/${n} 点しかない`))

  const oneway = net.links.dir.filter((d) => d === Direction.Forward || d === Direction.Backward).length
  const elevatorCount = net.links.kind.filter((k) => k === Kind.Elevator).length
  console.log(`check:data ${s.id} OK（点 ${n}・経路 ${m}・まとまり ${sizes.size} 個・一方通行 ${oneway}・エレベーター ${elevatorCount}）`)
}
