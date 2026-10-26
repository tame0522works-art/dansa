// 探索とコスト表を、手で作った小さなネットワークと実データの両方で確かめる。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Direction, Kind, Slope, Step, Struct, UNKNOWN, Width, type Network } from '../src/data/types.ts'
import { buildGraph, canPass, edgeCost, findBlockers, findRoute, type Profile } from '../src/route.ts'
import { SOURCES } from './source.ts'

interface L {
  a: number
  b: number
  m: number
  kind?: number
  step?: number
  slope?: number
  width?: number
  dir?: number
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
      dir: ls.map((l) => l.dir ?? Direction.Both),
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
  assert.equal(edgeCost(up, 'stroller', 0, true), 80)
  assert.equal(edgeCost(up, 'stroller', 0, false), 60)
  // 車椅子は急な上り坂を「通れるが、とても避けたい」（長さの 4 倍）。坂の多い地域で、ほぼどこへも行けなくなったため（2026-10-26）
  assert.equal(edgeCost(up, 'wheelchair', 0, true), 160)
  assert.equal(edgeCost(up, 'wheelchair', 0, false), 80)
  // 終点のほうが低い坂は、起点から通ると下り
  const down = tiny(2, [{ a: 0, b: 1, m: 40, slope: Slope.SteepDown }])
  assert.equal(edgeCost(down, 'wheelchair', 0, true), 80)
  assert.equal(edgeCost(down, 'wheelchair', 0, false), 160)
  // 上り坂 40m（160m 相当）を避ける遠回りが 150m なら遠回りし、200m なら坂を上る
  const near = tiny(3, [{ a: 0, b: 1, m: 40, slope: Slope.SteepUp }, { a: 0, b: 2, m: 75 }, { a: 2, b: 1, m: 75 }])
  assert.deepEqual(path(near, 'wheelchair', 0, 1), [0, 2, 1])
  const far = tiny(3, [{ a: 0, b: 1, m: 40, slope: Slope.SteepUp }, { a: 0, b: 2, m: 100 }, { a: 2, b: 1, m: 100 }])
  assert.deepEqual(path(far, 'wheelchair', 0, 1), [0, 1])
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

// 一方通行（エスカレーター）。0 → 1 は上りだけのエスカレーター 10m、1 → 0 は遠回りの 0 - 2 - 1 で 60m
{
  const net = tiny(3, [{ a: 0, b: 1, m: 10, kind: Kind.Escalator, dir: Direction.Forward }, { a: 0, b: 2, m: 30 }, { a: 2, b: 1, m: 30 }])
  // スーツケースはエスカレーターに乗れる（上乗せなし）。逆向きには乗れないので遠回り
  assert.deepEqual(path(net, 'suitcase', 0, 1), [0, 1])
  assert.deepEqual(path(net, 'suitcase', 1, 0), [1, 2, 0])
  assert.deepEqual(path(net, 'shortest', 1, 0), [1, 2, 0])
  // ベビーカーと車椅子は乗れない
  assert.deepEqual(path(net, 'stroller', 0, 1), [0, 2, 1])
  assert.deepEqual(path(net, 'wheelchair', 0, 1), [0, 2, 1])
  // 終点 → 起点だけ通れる向き（Backward）
  const back = tiny(2, [{ a: 0, b: 1, m: 10, dir: Direction.Backward }])
  assert.equal(path(back, 'shortest', 0, 1), null)
  assert.deepEqual(path(back, 'shortest', 1, 0), [1, 0])
  // 行けない理由を探すときも、一方通行を逆に通る道は作らない
  assert.equal(findBlockers(buildGraph(back), 'wheelchair', 0, 1), null)
  // 方向性が不明（99）なら両方向
  const unknownDir = tiny(2, [{ a: 0, b: 1, m: 10, dir: UNKNOWN }])
  assert.deepEqual(path(unknownDir, 'shortest', 1, 0), [1, 0])
}

// エレベーターは誰でも通れる（障害にしない）
{
  const net = tiny(3, [{ a: 0, b: 1, m: 1, kind: Kind.Elevator }, { a: 0, b: 2, m: 100 }, { a: 2, b: 1, m: 100 }])
  for (const p of ['stroller', 'wheelchair', 'suitcase'] as const) assert.deepEqual(path(net, p, 0, 1), [0, 1], p)
}

// 実データ：ダイクストラ法の結果を、すべての辺を緩和し続ける素朴な方法（ベルマン–フォード法）と比べる
function bellmanFord(net: Network, profile: Profile, from: number): Float64Array {
  const n = net.floors.length
  const d = new Float64Array(n).fill(Infinity)
  d[from] = 0
  for (let changed = true; changed; ) {
    changed = false
    for (let i = 0; i < net.links.from.length; i++) {
      const a = net.links.from[i]
      const b = net.links.to[i]
      const fw = canPass(net, i, true) ? d[a] + edgeCost(net, profile, i, true) : Infinity
      if (fw < d[b] - 1e-9) {
        d[b] = fw
        changed = true
      }
      const bw = canPass(net, i, false) ? d[b] + edgeCost(net, profile, i, false) : Infinity
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
console.log('到達できた組（無作為な 300 組）と 1 回の探索時間:')
for (const { id } of SOURCES) {
  const net: Network = JSON.parse(readFileSync(new URL(`../src/data/${id}.json`, import.meta.url), 'utf8'))
  const g = buildGraph(net)
  const n = net.floors.length
  const oneway = net.links.dir.some((d) => d === Direction.Forward || d === Direction.Backward)
  for (let k = 0; k < 3; k++) {
    const from = Math.floor(rand() * n)
    for (const p of profiles) {
      const truth = bellmanFord(net, p, from)
      for (let j = 0; j < 40; j++) {
        const to = Math.floor(rand() * n)
        const r = findRoute(g, p, from, to)
        if (truth[to] === Infinity) assert.equal(r, null, `${id} ${p} ${from}→${to} は到達できないはず`)
        else {
          assert.ok(r && Math.abs(r.cost - truth[to]) < 1e-6, `${id} ${p} ${from}→${to}: ${r?.cost} ≠ ${truth[to]}`)
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
          // 最短の道は向きを入れ替えても同じ長さ（長さを小数で足していたとき、足す順番で表示が 1m ずれたことがある）
          // （一方通行のある地域では、逆向きの道が別になりうるので見ない）
          if (p === 'shortest' && !oneway) assert.equal(findRoute(g, p, to, from)!.length, r.length)
        }
        compared++
      }
    }
  }

  // 実データでの到達できる割合と速さ（目安として表示する。値そのものは確かめない）
  const pairs = Array.from({ length: 300 }, () => [Math.floor(rand() * n), Math.floor(rand() * n)])
  const stats = profiles.map((p) => {
    const t0 = performance.now()
    const ok = pairs.filter(([a, b]) => findRoute(g, p, a, b)).length
    return `${p} ${ok}/${pairs.length}（${((performance.now() - t0) / pairs.length).toFixed(2)}ms）`
  })
  console.log(`  ${id}: ${stats.join('  ')}`)
}
console.log(`check:route OK（手作りの例 + 実データ ${SOURCES.length} 地域 ${compared} 組をベルマン–フォード法と照合）`)
