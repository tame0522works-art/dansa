// raw/ の CSV を、画面に同梱する src/data/network.json へ変換する。
// 経路の形状は両端を結ぶ直線とみなす（元データの長さと両端の直線距離の比はすべて 0.9 以上。2026-10-21 確認）。
import { readFileSync, writeFileSync } from 'node:fs'
import type { Network } from '../src/data/types.ts'
import { projector } from '../src/geo.ts'
import { ATTRIBUTION, DATASET_PAGE, FETCHED_AT_PATH, FILES, SPEC } from './source.ts'

const ORIGIN = { lat: 35.68124, lon: 139.76712 }

function readCsv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const cols = head.split(',')
  // 元データの値にカンマや引用符は含まれない
  return rows.map((r) => {
    const v = r.split(',')
    if (v.length !== cols.length) throw new Error(`${path}: 列の数が合わない: ${r}`)
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]))
  })
}

function code(s: string, name: string): number {
  const n = Number(s)
  if (!Number.isInteger(n)) throw new Error(`${name} がコードでない: ${s}`)
  return n
}

function convert(linkRows: Record<string, string>[], nodeRows: Record<string, string>[], fetchedAt: string): Network {
  const project = projector(ORIGIN)
  const index = new Map<string, number>()
  const nodes: number[] = []
  const floors: number[] = []
  for (const r of nodeRows) {
    if (index.has(r.node_id)) throw new Error(`点の ID の重複: ${r.node_id}`)
    index.set(r.node_id, floors.length)
    const [x, y] = project(Number(r.lat), Number(r.lon))
    nodes.push(Math.round(x * 100), Math.round(y * 100))
    floors.push(Number(r.floor))
  }

  const links: Network['links'] = { from: [], to: [], length: [], struct: [], kind: [], width: [], slope: [], step: [] }
  for (const r of linkRows) {
    const a = index.get(r.start_id)
    const b = index.get(r.end_id)
    if (a === undefined || b === undefined) throw new Error(`経路 ${r.link_id} の端点が点の一覧にない`)
    // 一方通行の経路はない（2026-10-21 確認）。現れたら探索の作りを見直す必要があるので止める
    if (r.direction !== '1' && r.direction !== '99') throw new Error(`経路 ${r.link_id} が一方通行`)
    links.from.push(a)
    links.to.push(b)
    links.length.push(Math.round(Number(r.distance) * 10))
    links.struct.push(code(r.rt_struct, 'rt_struct'))
    links.kind.push(code(r.route_type, 'route_type'))
    links.width.push(code(r.width, 'width'))
    links.slope.push(code(r.vtcl_slope, 'vtcl_slope'))
    links.step.push(code(r.lev_diff, 'lev_diff'))
  }

  return { attribution: ATTRIBUTION, source: { page: DATASET_PAGE, spec: SPEC, fetchedAt }, origin: ORIGIN, nodes, floors, links }
}

const net = convert(readCsv(FILES.link.path), readCsv(FILES.node.path), readFileSync(FETCHED_AT_PATH, 'utf8').trim())
const json = JSON.stringify(net)
writeFileSync('src/data/network.json', json)
console.log(`点 ${net.floors.length}・経路 ${net.links.from.length}・${(json.length / 1024).toFixed(0)}KB`)
