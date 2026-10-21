import { useMemo, useState } from 'react'
import data from './data/network.json'
import type { Network } from './data/types.ts'
import MapView, { type Badge, type Overlay } from './map/MapView.tsx'
import { TILE_ORIGIN } from './map/tiles.ts'
import type { Limits, View } from './map/view.ts'
import { mainComponent, nearestNode, plan, type Mark } from './plan.ts'
import { buildGraph, type Obstacle, type Profile } from './route.ts'

const net = data as Network
const graph = buildGraph(net)
const inMain = mainComponent(graph)

const PROFILES: { id: Exclude<Profile, 'shortest'>; label: string }[] = [
  { id: 'stroller', label: 'ベビーカー' },
  { id: 'wheelchair', label: '車椅子' },
  { id: 'suitcase', label: 'スーツケース' },
]

const OBSTACLE: Record<Exclude<Obstacle, 'unknown'>, { badge: string; name: string }> = {
  stairs: { badge: '階', name: '階段' },
  step: { badge: '段', name: '段差' },
  steepUp: { badge: '坂', name: '急な上り坂' },
  steepDown: { badge: '坂', name: '急な下り坂' },
  narrow: { badge: '狭', name: '幅1m未満' },
}

/** 経路の番号の並びを、平面座標（cm）の線分の Path2D にする（SVG の文字列にまとめると速い） */
function linksToPath(links: Iterable<number>): Path2D {
  const { from, to } = net.links
  const p = net.nodes
  let s = ''
  for (const i of links) s += `M${p[2 * from[i]]} ${p[2 * from[i] + 1]}L${p[2 * to[i]]} ${p[2 * to[i] + 1]}`
  return new Path2D(s)
}

const networkPath = linksToPath(net.links.from.keys())

/** 点のある範囲（m）。地図の中心はここから外へ出さない */
const LIMITS: Limits = (() => {
  const xs = net.nodes.filter((_, i) => i % 2 === 0)
  const ys = net.nodes.filter((_, i) => i % 2 === 1)
  return { area: [Math.min(...xs) / 100, Math.min(...ys) / 100, Math.max(...xs) / 100, Math.max(...ys) / 100], minMpp: 0.15, maxMpp: 5 }
})()

/** 最初は原点（東京駅の代表点）の 300m 西、丸の内側を 1px 1.2m で見せる */
const INITIAL: View = { cx: -300, cy: 0, mpp: 1.2 }

const nodeXY = (i: number): [number, number] => [net.nodes[2 * i] / 100, net.nodes[2 * i + 1] / 100]

/** 経路の中ほどに置く印 */
function badgeAt(link: number, label: string): Badge {
  const [ax, ay] = nodeXY(net.links.from[link])
  const [bx, by] = nodeXY(net.links.to[link])
  return { x: (ax + bx) / 2, y: (ay + by) / 2, label }
}

function badges(marks: Mark[]): Badge[] {
  return marks.map(({ link, obstacles }) => badgeAt(link, OBSTACLE[obstacles[0] as Exclude<Obstacle, 'unknown'>].badge))
}

/** 「階段2・段差1」のように数える。1つの経路に段差と坂が両方あれば、両方に数える */
function tally(marks: Mark[]): string {
  const count = new Map<string, number>()
  for (const m of marks) for (const o of m.obstacles) if (o !== 'unknown') count.set(OBSTACLE[o].name, (count.get(OBSTACLE[o].name) ?? 0) + 1)
  return [...count].map(([name, n]) => `${name}${n}`).join('・')
}

const meters = (m: number) => `${Math.round(m).toLocaleString('ja-JP')}m`

export default function App() {
  const [profile, setProfile] = useState<Exclude<Profile, 'shortest'>>('wheelchair')
  const [start, setStart] = useState<number | null>(null)
  const [goal, setGoal] = useState<number | null>(null)
  const [missed, setMissed] = useState(false)

  const result = useMemo(() => (start !== null && goal !== null ? plan(graph, profile, start, goal) : null), [profile, start, goal])
  const overlay = useMemo<Overlay | null>(() => {
    if (!result) return null
    const unknown = new Set(result.unknown)
    const links = result.route?.links.map((l) => l.link) ?? []
    return {
      shortest: linksToPath(result.shortest.links.map((l) => l.link)),
      route: result.route ? linksToPath(links.filter((l) => !unknown.has(l))) : null,
      routeUnknown: unknown.size ? linksToPath(unknown) : null,
      avoided: badges(result.avoided),
      passed: badges(result.passed),
      unknown: result.unknown.map((l) => badgeAt(l, '?')),
      bypass: result.blocked ? linksToPath(result.blocked.route.links.map((l) => l.link)) : null,
      blocked: badges(result.blocked?.blockers ?? []),
    }
  }, [result])

  /** 最短の道と利用者向けの道がどちらも入る範囲（m） */
  const focus = useMemo<[number, number, number, number] | null>(() => {
    if (!result) return null
    const nodes = [...result.shortest.nodes, ...(result.route?.nodes ?? result.blocked?.route.nodes ?? [])]
    const xs = nodes.map((i) => net.nodes[2 * i] / 100)
    const ys = nodes.map((i) => net.nodes[2 * i + 1] / 100)
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }, [result])

  function pick(x: number, y: number) {
    const node = nearestNode(graph, inMain, x, y)
    setMissed(node === null)
    if (node === null) return
    if (start === null || goal !== null) {
      setStart(node)
      setGoal(null)
    } else setGoal(node)
  }

  const label = PROFILES.find((p) => p.id === profile)!.label

  return (
    <div className="app">
      <header className="bar">
        <h1>dansa</h1>
        <p className="lead">東京駅・丸の内で、階段や段差を避けて歩く道</p>
      </header>
      <main className="stage">
        <MapView
          origin={net.origin}
          limits={LIMITS}
          initial={INITIAL}
          network={networkPath}
          overlay={overlay}
          start={start === null ? null : nodeXY(start)}
          goal={goal === null ? null : nodeXY(goal)}
          focus={focus}
          onPick={pick}
        />
      </main>
      <section className="controls" aria-label="経路">
        <fieldset className="profiles">
          <legend>だれの道を探すか</legend>
          {PROFILES.map((p) => (
            <label key={p.id}>
              <input type="radio" name="profile" value={p.id} checked={profile === p.id} onChange={() => setProfile(p.id)} />
              {p.label}
            </label>
          ))}
        </fieldset>
        <div className="result" aria-live="polite">
          {missed ? (
            <p className="hint">そこには歩行経路のデータがありません。道の上を押してください（地下・建物の中・皇居の中は対象外です）。</p>
          ) : start === null ? (
            <p className="hint">地図を押して出発地を選んでください。</p>
          ) : goal === null ? (
            <p className="hint">次に目的地を押してください。</p>
          ) : result?.route ? (
            <>
              <p className="summary">
                <span className="swatch route" aria-hidden="true" />
                {label}向け <strong>{meters(result.route.length)}</strong>
                {result.route.length - result.shortest.length >= 1 ? `（最短より +${meters(result.route.length - result.shortest.length)}）` : '（最短と同じ長さ）'}
                {/* 色の見本と「最短 …m」が別の行に分かれないよう、ひとまとまりにする */}
                <span className="pair">
                  <span className="swatch shortest" aria-hidden="true" />
                  最短 {meters(result.shortest.length)}
                </span>
              </p>
              <ul className="notes">
                {result.avoided.length > 0 ? <li>最短の道にある {tally(result.avoided)} を避けました。</li> : <li>最短の道に、{label}で避けたい箇所はありません。</li>}
                {result.passed.length > 0 && <li>それでも {tally(result.passed)} を通ります（遠回りするより短いと判断しました）。</li>}
                {result.unknown.length > 0 && <li>「?」の {result.unknown.length} 区間（点線）は、段差・勾配・幅のどれかが調べられていません。</li>}
              </ul>
            </>
          ) : result ? (
            <>
              <p className="summary">
                {label}で通れる道が見つかりません（最短は {meters(result.shortest.length)}）。
              </p>
              <ul className="notes">
                {result.blocked && (
                  <li>
                    <span className="badge-blocked" aria-hidden="true" />
                    赤い印の {tally(result.blocked.blockers)} を越えられれば、破線の道（{meters(result.blocked.route.length)}）で行けます。
                  </li>
                )}
                {result.blocked?.nearEnd && <li>越えられない箇所が出発地か目的地のすぐそばにあります（建物の入口の段差など）。近くの別の道に置き直すと見つかることがあります。</li>}
              </ul>
            </>
          ) : null}
        </div>
        {/* 出発地を選ぶ前から置いておく（現れたときに地図が縮んで、押す位置がずれないように） */}
        <div className="actions">
          <button
            type="button"
            disabled={start === null || goal === null}
            onClick={() => {
              setStart(goal)
              setGoal(start)
            }}
          >
            出発と到着を入れ替える
          </button>
          <button
            type="button"
            disabled={start === null}
            onClick={() => {
              setStart(null)
              setGoal(null)
              setMissed(false)
            }}
          >
            やり直す
          </button>
        </div>
      </section>
      <footer className="credit">
        <p>地上の歩道だけを扱います。地下通路・エレベーターは含みません。調査は2017〜2018年度のもので、いまの様子と違う所があります。</p>
        <p>
          出典:{' '}
          <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">
            地理院タイル（淡色地図）
          </a>
          ／
          <a href={net.source.page} target="_blank" rel="noreferrer">
            {net.attribution}
          </a>
        </p>
      </footer>
      <link rel="preconnect" href={TILE_ORIGIN} />
    </div>
  )
}
