// 地域のデータを、選ばれたときに読み込んで、探索と描画に要る形にする。
// データは JS の別ファイルとしてビルドされ、アプリと同じ場所から読む（CSP の script-src 'self' の範囲で、通信の制限は変わらない）。
import type { Area } from './areas.ts'
import type { Network } from './data/types.ts'
import { projector } from './geo.ts'
import type { Limits, View } from './map/view.ts'
import { mainComponent } from './plan.ts'
import { buildGraph, type Graph } from './route.ts'

const files = import.meta.glob<Network>('./data/*.json', { import: 'default' })

export interface AreaData {
  net: Network
  graph: Graph
  /** いちばん大きいまとまりに入っている点か（寄せる先をここに限る） */
  inMain: Uint8Array
  network: Path2D
  limits: Limits
  initial: View
}

/** 経路の番号の並びを、平面座標（cm）の線分の Path2D にする（SVG の文字列にまとめると速い） */
export function linksToPath(net: Network, links: Iterable<number>): Path2D {
  const { from, to } = net.links
  const p = net.nodes
  let s = ''
  for (const i of links) s += `M${p[2 * from[i]]} ${p[2 * from[i] + 1]}L${p[2 * to[i]]} ${p[2 * to[i] + 1]}`
  return new Path2D(s)
}

const cache = new Map<string, Promise<AreaData>>()

export function loadArea(area: Area): Promise<AreaData> {
  let p = cache.get(area.id)
  if (!p) {
    const file = files[`./data/${area.id}.json`]
    if (!file) throw new Error(`地域 ${area.id} のデータがない`)
    p = file().then((net) => {
      const graph = buildGraph(net)
      const xs = net.nodes.filter((_, i) => i % 2 === 0)
      const ys = net.nodes.filter((_, i) => i % 2 === 1)
      // 地図の中心は点のある範囲から外へ出さない
      const limits: Limits = { area: [Math.min(...xs) / 100, Math.min(...ys) / 100, Math.max(...xs) / 100, Math.max(...ys) / 100], minMpp: 0.15, maxMpp: 6 }
      const [cx, cy] = projector(net.origin)(area.center.lat, area.center.lon)
      return { net, graph, inMain: mainComponent(graph), network: linksToPath(net, net.links.from.keys()), limits, initial: { cx, cy, mpp: 1.2 } }
    })
    cache.set(area.id, p)
  }
  return p
}
