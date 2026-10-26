// raw/<地域>/ の CSV を、画面が読む src/data/<地域>.json へ変換する。
// 経路の形状は両端を結ぶ直線とみなす（元データの長さと両端の直線距離の差はどの地域も1割以内。check:data で確かめる）。
import { readFileSync, writeFileSync } from 'node:fs'
import type { Network } from '../src/data/types.ts'
import { projector } from '../src/geo.ts'
import { SOURCES, SPEC, attribution, rawPath, type Source } from './source.ts'

function readCsv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/)
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

function convert(s: Source): Network {
  const project = projector(s.origin)
  const index = new Map<string, number>()
  const nodes: number[] = []
  const floors: number[] = []
  for (const r of readCsv(rawPath(s.id, 'node.csv'))) {
    if (index.has(r.node_id)) throw new Error(`${s.id}: 点の ID の重複: ${r.node_id}`)
    index.set(r.node_id, floors.length)
    const [x, y] = project(Number(r.lat), Number(r.lon))
    nodes.push(Math.round(x * 100), Math.round(y * 100))
    floors.push(Number(r.floor))
  }

  const links: Network['links'] = { from: [], to: [], length: [], struct: [], kind: [], width: [], slope: [], step: [], dir: [] }
  for (const r of readCsv(rawPath(s.id, 'link.csv'))) {
    const a = index.get(r.start_id)
    const b = index.get(r.end_id)
    if (a === undefined || b === undefined) throw new Error(`${s.id}: 経路 ${r.link_id} の端点が点の一覧にない`)
    const length = Number(r.distance)
    // 仕様ではエレベーターの長さは書かなくてよいが、どの地域にも数十 cm の値が入っている。空なら 0 とする
    if (!(length >= 0)) throw new Error(`${s.id}: 経路 ${r.link_id} の長さ ${r.distance}`)
    links.from.push(a)
    links.to.push(b)
    links.length.push(Math.round(length * 10))
    links.struct.push(code(r.rt_struct, 'rt_struct'))
    links.kind.push(code(r.route_type, 'route_type'))
    links.width.push(code(r.width, 'width'))
    links.slope.push(code(r.vtcl_slope, 'vtcl_slope'))
    links.step.push(code(r.lev_diff, 'lev_diff'))
    links.dir.push(code(r.direction, 'direction'))
  }

  const fetchedAt = readFileSync(rawPath(s.id, 'fetched-at.txt'), 'utf8').trim()
  return { attribution: attribution(s), source: { page: s.page, spec: SPEC, fetchedAt }, origin: s.origin, nodes, floors, links }
}

for (const s of SOURCES) {
  const net = convert(s)
  const json = JSON.stringify(net)
  writeFileSync(`src/data/${s.id}.json`, json)
  console.log(`${s.id}: 点 ${net.floors.length}・経路 ${net.links.from.length}・${(json.length / 1024).toFixed(0)}KB`)
}
