import { useEffect, useMemo, useState } from 'react'
import { AREAS, coverageNote, type Area } from './areas.ts'
import { linksToPath, loadArea, type AreaData } from './areaData.ts'
import MapView, { type Badge, type Overlay } from './map/MapView.tsx'
import { TILE_ORIGIN } from './map/tiles.ts'
import { nearestNode, plan, type Mark } from './plan.ts'
import type { Obstacle, Profile } from './route.ts'

type Who = Exclude<Profile, 'shortest'>

const PROFILES: { id: Who; label: string }[] = [
  { id: 'stroller', label: 'ベビーカー' },
  { id: 'wheelchair', label: '車椅子' },
  { id: 'suitcase', label: 'スーツケース' },
]

const OBSTACLE: Record<Exclude<Obstacle, 'unknown'>, { badge: string; name: string }> = {
  stairs: { badge: '階', name: '階段' },
  escalator: { badge: 'エ', name: 'エスカレーター' },
  step: { badge: '段', name: '段差' },
  steepUp: { badge: '坂', name: '急な上り坂' },
  steepDown: { badge: '坂', name: '急な下り坂' },
  narrow: { badge: '狭', name: '幅1m未満' },
}

/** 「階段2・段差1」のように数える。1つの経路に段差と坂が両方あれば、両方に数える */
function tally(marks: Mark[]): string {
  const count = new Map<string, number>()
  for (const m of marks) for (const o of m.obstacles) if (o !== 'unknown') count.set(OBSTACLE[o].name, (count.get(OBSTACLE[o].name) ?? 0) + 1)
  return [...count].map(([name, n]) => `${name}${n}`).join('・')
}

const meters = (m: number) => `${Math.round(m).toLocaleString('ja-JP')}m`

export default function App() {
  const [area, setArea] = useState<Area>(AREAS[0])
  const [data, setData] = useState<{ id: string; data: AreaData } | null>(null)
  const [profile, setProfile] = useState<Who>('wheelchair')

  useEffect(() => {
    let alive = true
    loadArea(area).then((d) => alive && setData({ id: area.id, data: d }))
    return () => {
      alive = false
    }
  }, [area])

  // 地域を切り替えた直後は、前の地域のデータを出さない
  const current = data?.id === area.id ? data.data : null

  return (
    <div className="app">
      <header className="bar">
        <h1>dansa</h1>
        <p className="lead">駅のまわりで、階段や段差を避けて歩く道</p>
        <label className="area">
          <span>地域</span>
          <select value={area.id} onChange={(e) => setArea(AREAS.find((a) => a.id === e.target.value)!)}>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      {current ? (
        // 地域を変えたら、地図の位置と出発地・目的地を最初からにする
        <Planner key={area.id} area={area} data={current} profile={profile} onProfile={setProfile} />
      ) : (
        <>
          <main className="stage">
            <p className="loading">{area.label}のデータを読み込んでいます…</p>
          </main>
          <section className="controls" aria-label="経路" />
          <footer className="credit" />
        </>
      )}
      <link rel="preconnect" href={TILE_ORIGIN} />
    </div>
  )
}

interface PlannerProps {
  area: Area
  data: AreaData
  profile: Who
  onProfile: (p: Who) => void
}

function Planner({ area, data, profile, onProfile }: PlannerProps) {
  const { net, graph, inMain } = data
  const [start, setStart] = useState<number | null>(null)
  const [goal, setGoal] = useState<number | null>(null)
  const [missed, setMissed] = useState(false)

  const nodeXY = (i: number): [number, number] => [net.nodes[2 * i] / 100, net.nodes[2 * i + 1] / 100]
  /** 経路の中ほどに置く印 */
  const badgeAt = (link: number, label: string): Badge => {
    const [ax, ay] = nodeXY(net.links.from[link])
    const [bx, by] = nodeXY(net.links.to[link])
    return { x: (ax + bx) / 2, y: (ay + by) / 2, label }
  }
  const badges = (marks: Mark[]) => marks.map(({ link, obstacles }) => badgeAt(link, OBSTACLE[obstacles[0] as Exclude<Obstacle, 'unknown'>].badge))

  const result = useMemo(() => (start !== null && goal !== null ? plan(graph, profile, start, goal) : null), [graph, profile, start, goal])
  const overlay = useMemo<Overlay | null>(() => {
    if (!result) return null
    const unknown = new Set(result.unknown)
    const links = result.route?.links.map((l) => l.link) ?? []
    return {
      shortest: linksToPath(net, result.shortest.links.map((l) => l.link)),
      route: result.route ? linksToPath(net, links.filter((l) => !unknown.has(l))) : null,
      routeUnknown: unknown.size ? linksToPath(net, unknown) : null,
      avoided: badges(result.avoided),
      passed: badges(result.passed),
      unknown: result.unknown.map((l) => badgeAt(l, '?')),
      bypass: result.blocked ? linksToPath(net, result.blocked.route.links.map((l) => l.link)) : null,
      blocked: badges(result.blocked?.blockers ?? []),
    }
  }, [result, net])

  /** 最短の道と利用者向けの道がどちらも入る範囲（m） */
  const focus = useMemo<[number, number, number, number] | null>(() => {
    if (!result) return null
    const nodes = [...result.shortest.nodes, ...(result.route?.nodes ?? result.blocked?.route.nodes ?? [])]
    const xs = nodes.map((i) => net.nodes[2 * i] / 100)
    const ys = nodes.map((i) => net.nodes[2 * i + 1] / 100)
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }, [result, net])

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
    <>
      <main className="stage">
        <MapView
          origin={net.origin}
          limits={data.limits}
          initial={data.initial}
          label={`${area.label}の歩行経路の地図`}
          network={data.network}
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
              <input type="radio" name="profile" value={p.id} checked={profile === p.id} onChange={() => onProfile(p.id)} />
              {p.label}
            </label>
          ))}
        </fieldset>
        <div className="result" aria-live="polite">
          {missed ? (
            <p className="hint">そこには歩行経路のデータがありません。道の上を押してください（建物や公園の中、範囲の外は対象外です）。</p>
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
                {result.avoided.length > 0 && <li>最短の道にある {tally(result.avoided)} を避けました。</li>}
                {result.passed.length > 0 && (
                  <li>
                    {result.avoided.length > 0 ? 'それでも ' : ''}
                    {tally(result.passed)} を通ります（遠回りするより短いと判断しました）。
                  </li>
                )}
                {result.avoided.length === 0 && result.passed.length === 0 && <li>最短の道に、{label}で避けたい箇所はありません。</li>}
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
        <p>
          {area.note && `${area.note}`}
          {coverageNote(area)}
        </p>
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
    </>
  )
}
