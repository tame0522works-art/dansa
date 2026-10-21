// 出発・到着の点を決め、最短の道と利用者向けの道を比べる。画面に出す数字と印はここで作る（描画はしない）。
import { COSTS, BLOCK, findBlockers, findRoute, obstaclesOf, type Graph, type Obstacle, type Profile, type Route } from './route.ts'

/** 押した地点からこれより遠い点には寄せない（m）。道のない所（皇居の中など）を押したときに案内する */
export const SNAP_LIMIT = 60

/** いちばん大きいまとまりに入っている点か。離れた小さなまとまりに寄せると、どこへも行けなくなるので外す */
export function mainComponent(g: Graph): Uint8Array {
  const n = g.start.length - 1
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0) continue
    const c = sizes.length
    let size = 0
    const stack = [s]
    label[s] = c
    while (stack.length) {
      const u = stack.pop()!
      size++
      for (let e = g.start[u]; e < g.start[u + 1]; e++) {
        if (label[g.head[e]] < 0) {
          label[g.head[e]] = c
          stack.push(g.head[e])
        }
      }
    }
    sizes.push(size)
  }
  const biggest = sizes.indexOf(Math.max(...sizes))
  return Uint8Array.from(label, (l) => (l === biggest ? 1 : 0))
}

/** 平面座標（m）にいちばん近い点。SNAP_LIMIT より遠ければ null */
export function nearestNode(g: Graph, inMain: Uint8Array, x: number, y: number): number | null {
  const nodes = g.net.nodes
  let best = -1
  let bestD = SNAP_LIMIT * 100
  for (let i = 0; i < inMain.length; i++) {
    if (!inMain[i]) continue
    const d = Math.hypot(nodes[2 * i] - x * 100, nodes[2 * i + 1] - y * 100)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best < 0 ? null : best
}

/** その利用者にとって、避けたい（通れない・上乗せがある・倍率が 1 を超える）障害か。不明は印を出さないので除く */
export function matters(profile: Profile, o: Obstacle): boolean {
  if (o === 'unknown') return false
  const r = COSTS[profile][o]
  return r === BLOCK || (o === 'stairs' || o === 'step' ? r > 0 : r > 1)
}

export interface Mark {
  link: number
  obstacles: Obstacle[]
}

export interface Plan {
  shortest: Route
  /** 利用者向けの道。到達できなければ null */
  route: Route | null
  /** 最短の道にあって、利用者向けの道が避けた障害 */
  avoided: Mark[]
  /** 利用者向けの道がそれでも通る障害（スーツケースが階段を使う、など） */
  passed: Mark[]
  /** 利用者向けの道のうち、段差・勾配・幅のどれかが不明な経路 */
  unknown: number[]
  /**
   * 到達できないとき、通れない箇所をいちばん少なく通る道と、その上の通れない箇所。
   * nearEnd は通れない箇所が出発地か目的地に接しているか（建物の入口の段差などで、置き直せば行けることが多い）
   */
  blocked: { route: Route; blockers: Mark[]; nearEnd: boolean } | null
}

export function plan(g: Graph, profile: Profile, from: number, to: number): Plan | null {
  const shortest = findRoute(g, 'shortest', from, to)
  if (!shortest) return null
  const route = findRoute(g, profile, from, to)
  const used = new Set(route?.links.map((l) => l.link))
  const marks = (r: Route) =>
    r.links.flatMap(({ link, forward }) => {
      const obstacles = obstaclesOf(g.net, link, forward).filter((o) => matters(profile, o))
      return obstacles.length ? [{ link, obstacles }] : []
    })
  return {
    shortest,
    route,
    avoided: marks(shortest).filter((m) => !used.has(m.link)),
    passed: route ? marks(route) : [],
    unknown: route ? route.links.filter(({ link, forward }) => obstaclesOf(g.net, link, forward).includes('unknown')).map((l) => l.link) : [],
    blocked: route ? null : blockedBy(g, profile, from, to),
  }
}

function blockedBy(g: Graph, profile: Profile, from: number, to: number): Plan['blocked'] {
  const found = findBlockers(g, profile, from, to)
  if (!found) return null
  const blockers = found.blockers.map(({ link, forward }) => ({
    link,
    obstacles: obstaclesOf(g.net, link, forward).filter((o) => o !== 'unknown' && COSTS[profile][o] === BLOCK),
  }))
  const ends = new Set([from, to])
  const nearEnd = blockers.some(({ link }) => ends.has(g.net.links.from[link]) || ends.has(g.net.links.to[link]))
  return { route: found.route, blockers, nearEnd }
}
