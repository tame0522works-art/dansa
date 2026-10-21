// 利用者ごとのコスト表と、経路の探索（ダイクストラ法）。
//
// コストの単位は「何 m 歩くのと同じくらい避けたいか」。
// 坂や狭い道は長いほどつらいので長さに掛ける倍率、階段や段差は 1 か所ごとの上乗せ（m）で表す。
// 倍率と上乗せの値は仮置きで、当事者の声や指針で裏付けたものではない（README に明記する）。
import { Kind, Slope, Step, UNKNOWN, Width, type Network } from './data/types.ts'

export type Profile = 'shortest' | 'stroller' | 'wheelchair' | 'suitcase'

/** 通れない、を表す */
export const BLOCK = 'block'
type Rule = typeof BLOCK | number

interface CostTable {
  /** 階段・エスカレーター 1 か所の上乗せ（m） */
  stairs: Rule
  /** 2cm を超える段差 1 か所の上乗せ（m） */
  step: Rule
  /** 5% を超える上り坂の倍率（長さに掛ける） */
  steepUp: Rule
  /** 5% を超える下り坂の倍率 */
  steepDown: Rule
  /** 幅 1m 未満の倍率 */
  narrow: Rule
  /** 段差・勾配・幅・種別のどれかが不明な経路 1 か所の上乗せ（m）。不明は通れる扱いにして、画面で点線にする */
  unknown: number
}

export const COSTS: Record<Profile, CostTable> = {
  shortest: { stairs: 0, step: 0, steepUp: 1, steepDown: 1, narrow: 1, unknown: 0 },
  stroller: { stairs: BLOCK, step: 60, steepUp: 2, steepDown: 1.5, narrow: 1.5, unknown: 50 },
  wheelchair: { stairs: BLOCK, step: BLOCK, steepUp: BLOCK, steepDown: 2, narrow: BLOCK, unknown: 50 },
  suitcase: { stairs: 150, step: 20, steepUp: 1.3, steepDown: 1.1, narrow: 1.2, unknown: 50 },
}

/** 経路を 1 方向に通るときに引っかかるもの */
export type Obstacle = 'stairs' | 'step' | 'steepUp' | 'steepDown' | 'narrow' | 'unknown'

export interface Graph {
  net: Network
  /** 点ごとの隣接（CSR）。start[i]〜start[i+1] が点 i から出る半辺 */
  start: Int32Array
  /** 半辺の行き先の点 */
  head: Int32Array
  /** 半辺のもとの経路の番号 */
  link: Int32Array
  /** 半辺が経路の起点 → 終点の向きか */
  forward: Uint8Array
}

export function buildGraph(net: Network): Graph {
  const n = net.floors.length
  const { from, to } = net.links
  const degree = new Int32Array(n + 1)
  for (let i = 0; i < from.length; i++) {
    degree[from[i] + 1]++
    degree[to[i] + 1]++
  }
  for (let i = 0; i < n; i++) degree[i + 1] += degree[i]
  const start = degree.slice()
  const fill = degree.slice(0, n)
  const m = from.length * 2
  const head = new Int32Array(m)
  const link = new Int32Array(m)
  const forward = new Uint8Array(m)
  for (let i = 0; i < from.length; i++) {
    let e = fill[from[i]]++
    head[e] = to[i]
    link[e] = i
    forward[e] = 1
    e = fill[to[i]]++
    head[e] = from[i]
    link[e] = i
  }
  return { net, start, head, link, forward }
}

/** 経路 i を forward の向きに通るときの障害 */
export function obstaclesOf(net: Network, i: number, forward: boolean): Obstacle[] {
  const { kind, step, slope, width } = net.links
  const out: Obstacle[] = []
  if (kind[i] === Kind.Stairs || kind[i] === Kind.Escalator) out.push('stairs')
  if (step[i] === Step.High) out.push('step')
  if (slope[i] === Slope.SteepUp || slope[i] === Slope.SteepDown) {
    // コードは起点 → 終点で見た上り下りなので、逆向きに通るときは入れ替わる
    const up = (slope[i] === Slope.SteepUp) === forward
    out.push(up ? 'steepUp' : 'steepDown')
  }
  if (width[i] === Width.Under1m) out.push('narrow')
  if ([kind[i], step[i], slope[i], width[i]].includes(UNKNOWN)) out.push('unknown')
  return out
}

/**
 * 経路 i を forward の向きに通るコスト（m 相当）。通れなければ Infinity。
 * blockedAs を渡すと、通れない障害をその上乗せ（m）で通れることにする（到達できない理由を探すのに使う）。
 */
export function edgeCost(net: Network, profile: Profile, i: number, forward: boolean, blockedAs?: number): number {
  const t = COSTS[profile]
  const len = net.links.length[i] / 10
  let factor = 1
  let add = 0
  for (const o of obstaclesOf(net, i, forward)) {
    const r: Rule = t[o]
    if (r === BLOCK) {
      if (blockedAs === undefined) return Infinity
      add += blockedAs
    } else if (o === 'stairs' || o === 'step' || o === 'unknown') add += r
    else factor = Math.max(factor, r)
  }
  return len * factor + add
}

export interface Route {
  /** 通る点の番号（出発 → 到着） */
  nodes: number[]
  /** 通る経路の番号と向き */
  links: { link: number; forward: boolean }[]
  /** 実際に歩く長さ（m） */
  length: number
  cost: number
}

/** 2 分ヒープ（コストの小さい順に点を取り出す） */
class Heap {
  private keys: number[] = []
  private items: number[] = []
  get size() {
    return this.items.length
  }
  push(key: number, item: number) {
    const { keys, items } = this
    let i = items.length
    keys.push(key)
    items.push(item)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      items[i] = items[p]
      i = p
    }
    keys[i] = key
    items[i] = item
  }
  pop(): [number, number] {
    const { keys, items } = this
    const top: [number, number] = [keys[0], items[0]]
    const key = keys.pop()!
    const item = items.pop()!
    const n = items.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && keys[c + 1] < keys[c]) c++
        if (keys[c] >= key) break
        keys[i] = keys[c]
        items[i] = items[c]
        i = c
      }
      keys[i] = key
      items[i] = item
    }
    return top
  }
}

/** from から to への最小コストの道。たどり着けなければ null */
export function findRoute(g: Graph, profile: Profile, from: number, to: number, blockedAs?: number): Route | null {
  const n = g.start.length - 1
  const dist = new Float64Array(n).fill(Infinity)
  const via = new Int32Array(n).fill(-1) // その点に入ってきた半辺
  const heap = new Heap()
  dist[from] = 0
  heap.push(0, from)
  while (heap.size > 0) {
    const [d, u] = heap.pop()
    if (d > dist[u]) continue
    if (u === to) break
    for (let e = g.start[u]; e < g.start[u + 1]; e++) {
      const c = edgeCost(g.net, profile, g.link[e], g.forward[e] === 1, blockedAs)
      const nd = d + c
      if (nd < dist[g.head[e]]) {
        dist[g.head[e]] = nd
        via[g.head[e]] = e
        heap.push(nd, g.head[e])
      }
    }
  }
  if (dist[to] === Infinity) return null

  const nodes = [to]
  const links: Route['links'] = []
  // 長さは dm の整数で足してから m に直す（0.1 を小数で足すと、足す順番で 835.5 が 835.4999… になり、表示の丸めが向きで変わる）
  let dm = 0
  for (let v = to; v !== from; ) {
    const e = via[v]
    const i = g.link[e]
    const forward = g.forward[e] === 1
    links.push({ link: i, forward })
    dm += g.net.links.length[i]
    v = forward ? g.net.links.from[i] : g.net.links.to[i]
    nodes.push(v)
  }
  return { nodes: nodes.reverse(), links: links.reverse(), length: dm / 10, cost: dist[to] }
}

/**
 * 到達できないとき、どこが行く手をふさいでいるかを返す。
 * 通れない障害を「1 か所 100km 歩くのと同じ」として探すと、ふさいでいる箇所をいちばん少なく通る道が見つかる。
 * その道の上で通れない経路が、利用者に示す原因になる。そもそもネットワークがつながっていなければ null。
 */
const BLOCKED_AS = 100_000

export function findBlockers(g: Graph, profile: Profile, from: number, to: number) {
  const route = findRoute(g, profile, from, to, BLOCKED_AS)
  if (!route) return null
  const blockers = route.links.filter(({ link, forward }) => edgeCost(g.net, profile, link, forward) === Infinity)
  return { route, blockers }
}
