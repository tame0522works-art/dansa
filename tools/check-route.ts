// 探索とコスト表を、手で作った小さなネットワークと実データの両方で確かめる。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Kind, Slope, Step, Struct, UNKNOWN, Width, type Network } from '../src/data/types.ts'
import { buildGraph, edgeCost, findBlockers, findRoute, type Profile } from '../src/route.ts'

interface L {
  a: number
  b: number
  m: number
  kind?: number
  step?: number
  slope?: number
  width?: number
}

function tiny(nodeCount: number, ls: L[]): Network {
  return {
    attribution: '',
    source: { page: '', spec: '', fetchedAt: '' },
    origin: { lat: 0, lon: 0 },
    nodes: Array(nodeCount * 2).fill(0),
    floors: Array(nodeCount).fill(0),
    links: {
      from: ls.map((l) => l.a),
      to: ls.map((l) => l.b),
      length: ls.map((l) => l.m * 10),
      struct: ls.map(() => Struct.Separated),
      kind: ls.map((l) => l.kind ?? Kind.None),
      width: ls.map((l) => l.width ?? Width.Over3m),
      slope: ls.map((l) => l.slope ?? Slope.Gentle),
      step: ls.map((l) => l.step ?? Step.Low),
    },
  }
}

const path = (net: Network, p: Profile, a: number, b: number) => findRoute(buildGraph(net), p, a, b)?.nodes ?? null

// 0 → 1 は階段で 20m、遠回りの 0 → 2 → 1 は 100m
{
  const net = tiny(3, [{ a: 0, b: 1, m: 20, kind: Kind.Stairs }, { a: 0, b: 2, m: 50 }, { a: 2, b: 1, m: 50 }])
  assert.deepEqual(path(net, 'shortest', 0, 1), [0, 1])
  assert.deepEqual(path(net, 'stroller', 0, 1), [0, 2, 1])
  assert.deepEqual(path(net, 'wheelchair', 0, 1), [0, 2, 1])
  // スーツケースは階段を 150m 相当とみなす。20 + 150 > 100 なので遠回りする
  assert.deepEqual(path(net, 'suitcase', 0, 1), [0, 2, 1])
}

// 遠回りが 300m なら、スーツケースは階段を使う（20 + 150 < 300）
{
  const net = tiny(3, [{ a: 0, b: 1, m: 20, kind: Kind.Stairs }, { a: 0, b: 2, m: 150 }, { a: 2, b: 1, m: 150 }])
  assert.deepEqual(path(net, 'suitcase', 0, 1), [0, 1])
  assert.deepEqual(path(net, 'stroller', 0, 1), [0, 2, 1])
}

// 勾配の向き。経路 0 → 1 は「起点より終点が高い」急坂。逆向きに通ると下り坂になる
{
  const up = tiny(2, [{ a: 0, b: 1, m: 40, slope: Slope.SteepUp }])
  assert.equal(path(up, 'wheelchair', 0, 1), null, '車椅子は急な上り坂を通れない')
  assert.deepEqual(path(up, 'wheelchair', 1, 0), [1, 0], '同じ坂を下る向きなら通れる')
  assert.equal(edgeCost(up, 'stroller', 0, true), 80)
  assert.equal(edgeCost(up, 'stroller', 0, false), 60)
  // 終点のほうが低い坂は、起点から通ると下り
  const down = tiny(2, [{ a: 0, b: 1, m: 40, slope: Slope.SteepDown }])
  assert.deepEqual(path(down, 'wheelchair', 0, 1), [0, 1])
  assert.equal(path(down, 'wheelchair', 1, 0), null)
}

// 段差・幅
{
  const net = tiny(2, [{ a: 0, b: 1, m: 10, step: Step.High }])
  assert.equal(edgeCost(net, 'stroller', 0, true), 70)
  assert.equal(edgeCost(net, 'wheelchair', 0, true), Infinity)
  const narrow = tiny(2, [{ a: 0, b: 1, m: 10, width: Width.Under1m }])
  assert.equal(edgeCost(narrow, 'wheelchair', 0, true), Infinity)
  assert.equal(edgeCost(narrow, 'stroller', 0, true), 15)
}

// 不明は通れるが上乗せする（車椅子でも Infinity にしない）
{
  const net = tiny(2, [{ a: 0, b: 1, m: 10, step: UNKNOWN }])
  assert.equal(edgeCost(net, 'wheelchair', 0, true), 60)
  assert.equal(edgeCost(net, 'shortest', 0, true), 10)
}

// 到達できない理由。0 - 1 - 2 - 3 の一本道で、1 → 2 が階段
{
  const net = tiny(4, [{ a: 0, b: 1, m: 10 }, { a: 1, b: 2, m: 5, kind: Kind.Stairs }, { a: 2, b: 3, m: 10 }])
  const g = buildGraph(net)
  assert.equal(findRoute(g, 'wheelchair', 0, 3), null)
  const r = findBlockers(g, 'wheelchair', 0, 3)
  assert.deepEqual(r?.blockers, [{ link: 1, forward: true }])
  // 階段が 2 か所の道と 1 か所の道があれば、少ないほうを原因として示す（距離が長くても）
  const two = tiny(4, [
    { a: 0, b: 1, m: 5, kind: Kind.Stairs },
    { a: 1, b: 3, m: 5, kind: Kind.Stairs },
    { a: 0, b: 2, m: 500 },
    { a: 2, b: 3, m: 5, kind: Kind.Stairs },
  ])
  assert.deepEqual(findBlockers(buildGraph(two), 'wheelchair', 0, 3)?.blockers, [{ link: 3, forward: true }])
  // つながっていなければ null
  const apart = tiny(3, [{ a: 0, b: 1, m: 10 }])
  assert.equal(findBlockers(buildGraph(apart), 'wheelchair', 0, 2), null)
}

// 実データ：ダイクストラ法の結果を、すべての辺を緩和し続ける素朴な方法（ベルマン–フォード法）と比べる
const net: Network = JSON.parse(readFileSync(new URL('../src/data/network.json', import.meta.url), 'utf8'))
const g = buildGraph(net)
const n = net.floors.length

function bellmanFord(profile: Profile, from: number): Float64Array {
  const d = new Float64Array(n).fill(Infinity)
  d[from] = 0
  for (let changed = true; changed; ) {
    changed = false
    for (let i = 0; i < net.links.from.length; i++) {
      const a = net.links.from[i]
      const b = net.links.to[i]
      const fw = d[a] + edgeCost(net, profile, i, true)
      if (fw < d[b] - 1e-9) {
        d[b] = fw
        changed = true
      }
      const bw = d[b] + edgeCost(net, profile, i, false)
      if (bw < d[a] - 1e-9) {
        d[a] = bw
        changed = true
      }
    }
  }
  return d
}

// 再現できるように、乱数の種を固定する
let seed = 20261021
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31)
const profiles: Profile[] = ['shortest', 'stroller', 'wheelchair', 'suitcase']
let compared = 0
for (let k = 0; k < 3; k++) {
  const from = Math.floor(rand() * n)
  for (const p of profiles) {
    const truth = bellmanFord(p, from)
    for (let j = 0; j < 40; j++) {
      const to = Math.floor(rand() * n)
      const r = findRoute(g, p, from, to)
      if (truth[to] === Infinity) assert.equal(r, null, `${p} ${from}→${to} は到達できないはず`)
      else {
        assert.ok(r && Math.abs(r.cost - truth[to]) < 1e-6, `${p} ${from}→${to}: ${r?.cost} ≠ ${truth[to]}`)
        // 返した道を自分でたどり直して、コストと長さが合うか
        let c = 0
        let len = 0
        for (const { link, forward } of r.links) {
          c += edgeCost(net, p, link, forward)
          len += net.links.length[link] / 10
        }
        assert.ok(Math.abs(c - r.cost) < 1e-6 && Math.abs(len - r.length) < 1e-6)
        assert.equal(r.nodes[0], from)
        assert.equal(r.nodes.at(-1), to)
      }
      compared++
    }
  }
}

// 実データでの到達できる割合と速さ（目安として表示する。値そのものは確かめない）
const pairs = Array.from({ length: 300 }, () => [Math.floor(rand() * n), Math.floor(rand() * n)])
for (const p of profiles) {
  const t0 = performance.now()
  const ok = pairs.filter(([a, b]) => findRoute(g, p, a, b)).length
  const ms = (performance.now() - t0) / pairs.length
  console.log(`${p.padEnd(10)} 到達 ${ok}/${pairs.length}  1回 ${ms.toFixed(2)}ms`)
}
console.log(`check:route OK（手作りの例 + 実データ ${compared} 組をベルマン–フォード法と照合）`)
