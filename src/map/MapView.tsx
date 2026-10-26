// 地図。地理院タイル・歩行経路の網・最短の道・利用者向けの道・印の順に1枚の canvas に描く。
// 経路は平面座標（cm）の Path2D のまま、canvas の変換行列で画面に合わせるので、動かしたときに作り直さない。
// 操作（ドラッグ・ホイール・2本指・キーボード）は hikage の地図と同じ。
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { projector, unprojector, type Origin } from '../geo.ts'
import { COLORS, MAP_BG } from './colors.ts'
import { TILE_SIZE, tileLatLon, tileUrl, tileXY, tileZoomFor } from './tiles.ts'
import { clampView, panBy, toLocal, toScreen, zoomAt, type Limits, type Size, type View } from './view.ts'

/** 地図に置く文字入りの丸。位置は平面座標（m） */
export interface Badge {
  x: number
  y: number
  label: string
}

export interface Overlay {
  shortest: Path2D
  /** 利用者向けの道のうち、段差・勾配・幅が分かっている経路（実線） */
  route: Path2D | null
  /** 利用者向けの道のうち、どれかが不明な経路（点線） */
  routeUnknown: Path2D | null
  /** 最短の道にあって避けた障害 */
  avoided: Badge[]
  /** 利用者向けの道がそれでも通る障害 */
  passed: Badge[]
  /** 利用者向けの道のうち不明な経路。どれも数 m と短く点線の切れ目が見えないので、印も置く */
  unknown: Badge[]
  /** 到達できないとき、通れない箇所をいちばん少なく通る道（破線） */
  bypass: Path2D | null
  /** その道の上の通れない箇所 */
  blocked: Badge[]
}

interface Props {
  origin: Origin
  limits: Limits
  initial: View
  /** 地図の読み上げ名 */
  label: string
  network: Path2D
  overlay: Overlay | null
  start: [number, number] | null
  goal: [number, number] | null
  /** 見せたい範囲（平面座標 m の [minX, minY, maxX, maxY]）。画面からはみ出していれば、入るように地図を動かす */
  focus: [number, number, number, number] | null
  /** 地図を（動かさずに）押したとき、その地点の平面座標（m）を渡す */
  onPick: (x: number, y: number) => void
}

/** 押してから離すまでにこれより動いたら、押したのではなく動かしたとみなす（CSS px） */
const TAP_SLOP = 6
/** キーボードで操作するとき、矢印キー1回で動かす量（CSS px）。Shift を押しながらなら4倍 */
const KEY_STEP = 40
/**
 * 地図は経路の下地なので、色を抜いて薄くする（淡色地図の線路の赤や黄色が経路の色と紛れないように）。
 * hikage より一段薄くするのは、歩行経路の網（細い線）を地図の道路の線と見分けられるようにするため
 */
const TILE_FILTER = 'grayscale(1) brightness(1.12) contrast(0.55)'

/** 出発地・目的地のピンの丸を、地点からどれだけ上に浮かせるか（CSS px） */
const PIN_HEIGHT = 26
/** 見せたい範囲を合わせるとき、画面の縁からとる余白（CSS px）。上はピンの丸（地点の 26px 上、半径 13px）が掛からないよう広くとる */
const FIT_PADDING = 32
const FIT_PADDING_TOP = PIN_HEIGHT + 20

export default function MapView({ origin, limits, initial, label, network, overlay, start, goal, focus, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<View>(initial)
  const sizeRef = useRef<Size>({ width: 0, height: 0 })
  const tilesRef = useRef(new Map<string, HTMLImageElement>())
  const drawRef = useRef<() => void>(() => {})
  const pendingRef = useRef(false)
  const limitsRef = useRef(limits)
  limitsRef.current = limits
  /** キーボードで地図を選んでいる間は、中央に十字を描く（Enter で選ぶ地点） */
  const focusedRef = useRef(false)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const project = useMemo(() => projector(origin), [origin])
  const unproject = useMemo(() => unprojector(origin), [origin])

  drawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { width, height } = sizeRef.current
    const dpr = window.devicePixelRatio || 1
    const v = viewRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = MAP_BG
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 1. 地理院タイル。画面の四隅を含むタイルを並べ、各タイルの角を平面座標に直して置く
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const z = tileZoomFor(v.mpp, origin.lat, dpr)
    const [nwLat, nwLon] = unproject(...toLocal(v, sizeRef.current, 0, 0))
    const [seLat, seLon] = unproject(...toLocal(v, sizeRef.current, width, height))
    const [x0, y0] = tileXY(nwLat, nwLon, z).map(Math.floor)
    const [x1, y1] = tileXY(seLat, seLon, z).map(Math.floor)
    ctx.filter = TILE_FILTER
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const img = tile(z, tx, ty)
        if (!img.complete || img.naturalWidth === 0) continue
        const [la, lo] = tileLatLon(tx, ty, z)
        const [lb, lob] = tileLatLon(tx + 1, ty + 1, z)
        const [ax, ay] = toScreen(v, sizeRef.current, ...project(la, lo))
        const [bx, by] = toScreen(v, sizeRef.current, ...project(lb, lob))
        // 隣のタイルとの間に髪の毛ほどの隙間が出ないよう、端を整数に丸める
        const l = Math.floor(ax), t = Math.floor(ay)
        ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE, l, t, Math.ceil(bx) - l, Math.ceil(by) - t)
      }
    }
    ctx.filter = 'none'

    // 2. 経路。平面座標（cm）→ 画面（デバイス px）。線の太さは画面の px で決めたいので 1/k を掛ける
    const k = dpr / (100 * v.mpp)
    ctx.setTransform(k, 0, 0, -k, dpr * (width / 2 - v.cx / v.mpp), dpr * (height / 2 + v.cy / v.mpp))
    const px = (n: number) => n / k
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = COLORS.network
    ctx.lineWidth = px(2)
    ctx.stroke(network)
    if (overlay) {
      ctx.strokeStyle = COLORS.shortest
      ctx.lineWidth = px(6)
      ctx.stroke(overlay.shortest)
      // 利用者向けの道は白い縁で囲み、最短の道と重なっても見分けられるようにする
      for (const [path, dash] of [
        [overlay.route, []],
        [overlay.routeUnknown, [px(2), px(9)]],
      ] as const) {
        if (!path) continue
        ctx.setLineDash([])
        ctx.strokeStyle = COLORS.casing
        ctx.lineWidth = px(8)
        ctx.stroke(path)
        ctx.setLineDash(dash)
        ctx.strokeStyle = COLORS.route
        ctx.lineWidth = px(5)
        ctx.stroke(path)
      }
      if (overlay.bypass) {
        // 通れない箇所さえ越えれば行ける道。利用者向けの道ではないので、色をつけず細い破線にする
        ctx.setLineDash([px(8), px(6)])
        ctx.strokeStyle = COLORS.blocked
        ctx.lineWidth = px(3)
        ctx.stroke(overlay.bypass)
      }
      ctx.setLineDash([])
    }

    // 3. 印。画面（CSS px）で描く
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const badge = (b: Badge, fill: string, ink: string, edge: string) => {
      const [sx, sy] = toScreen(v, sizeRef.current, b.x, b.y)
      ctx.beginPath()
      ctx.arc(sx, sy, 10, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = edge
      ctx.stroke()
      ctx.fillStyle = ink
      ctx.font = '600 12px system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(b.label, sx, sy + 0.5)
    }
    for (const b of overlay?.avoided ?? []) badge(b, '#ffffff', COLORS.avoided, COLORS.avoided)
    for (const b of overlay?.passed ?? []) badge(b, COLORS.route, '#ffffff', '#ffffff')
    for (const b of overlay?.unknown ?? []) badge(b, '#ffffff', COLORS.shortest, COLORS.shortest)
    for (const b of overlay?.blocked ?? []) badge(b, COLORS.blocked, '#ffffff', '#ffffff')
    // 出発地・目的地はピンにして、丸を地点の上に浮かせる。地点そのものに重なる印（入口の段差や「?」）を隠さないように
    for (const [p, label, color] of [
      [start, '出', COLORS.start],
      [goal, '着', COLORS.goal],
    ] as const) {
      if (!p) continue
      const [sx, sy] = toScreen(v, sizeRef.current, p[0], p[1])
      const hy = sy - PIN_HEIGHT
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx - 6, hy + 8)
      ctx.arc(sx, hy, 13, Math.PI * 0.75, Math.PI * 0.25)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = '700 13px system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, sx, hy + 0.5)
    }

    if (focusedRef.current) {
      // 白で縁取った濃い十字。地図・経路のどの色の上でも見えるように
      const cx = width / 2
      const cy = height / 2
      ctx.beginPath()
      ctx.moveTo(cx - 14, cy)
      ctx.lineTo(cx + 14, cy)
      ctx.moveTo(cx, cy - 14)
      ctx.lineTo(cx, cy + 14)
      ctx.lineWidth = 5
      ctx.strokeStyle = '#fff'
      ctx.stroke()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#1f2328'
      ctx.stroke()
    }
  }

  /** 矢印キーで動かし、+ と - で寄せ引きし、Enter かスペースで画面中央の地点を選ぶ */
  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    const step = KEY_STEP * (e.shiftKey ? 4 : 1)
    const size = sizeRef.current
    const l = limitsRef.current
    const v = viewRef.current
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (e.key in moves) viewRef.current = panBy(v, ...moves[e.key], l)
    else if (e.key === '+' || e.key === '=') viewRef.current = zoomAt(v, size, size.width / 2, size.height / 2, 1 / 1.25, l)
    else if (e.key === '-') viewRef.current = zoomAt(v, size, size.width / 2, size.height / 2, 1.25, l)
    else if (e.key === 'Enter' || e.key === ' ') onPickRef.current(v.cx, v.cy)
    else return
    e.preventDefault()
    requestDraw()
  }

  function tile(z: number, x: number, y: number): HTMLImageElement {
    const key = `${z}/${x}/${y}`
    let img = tilesRef.current.get(key)
    if (!img) {
      img = new Image()
      // 地理院タイルは CORS を許可している。anonymous で読めば資格情報を送らず、canvas も汚染されないので、描いた結果を読み出して確かめられる
      img.crossOrigin = 'anonymous'
      img.onload = requestDraw
      img.src = tileUrl(z, x, y)
      tilesRef.current.set(key, img)
    }
    return img
  }

  function requestDraw() {
    if (pendingRef.current) return
    pendingRef.current = true
    const run = () => {
      if (!pendingRef.current) return
      pendingRef.current = false
      drawRef.current()
    }
    requestAnimationFrame(run)
    // 画面が隠れていると requestAnimationFrame が呼ばれないので、少し待って描く
    setTimeout(run, 100)
  }

  useEffect(() => {
    requestDraw()
  })

  useEffect(() => {
    if (!focus) return
    const v = viewRef.current
    const s = sizeRef.current
    const [ax, ay] = toLocal(v, s, FIT_PADDING, s.height - FIT_PADDING)
    const [bx, by] = toLocal(v, s, s.width - FIT_PADDING, FIT_PADDING_TOP)
    if (focus[0] >= ax && focus[1] >= ay && focus[2] <= bx && focus[3] <= by) return
    // 寄せることはしない（いま見ている縮尺より細かくはしない）。入りきらないときだけ引く
    const need = Math.max((focus[2] - focus[0]) / Math.max(1, s.width - 2 * FIT_PADDING), (focus[3] - focus[1]) / Math.max(1, s.height - FIT_PADDING - FIT_PADDING_TOP))
    const mpp = Math.max(v.mpp, need)
    // 上の余白が広いぶん、中心を少し上へずらす
    const cy = (focus[1] + focus[3]) / 2 + ((FIT_PADDING_TOP - FIT_PADDING) / 2) * mpp
    viewRef.current = clampView({ cx: (focus[0] + focus[2]) / 2, cy, mpp }, limitsRef.current)
    requestDraw()
  }, [focus])

  // 大きさの追従と、ドラッグ・ホイール・2本指での操作
  useEffect(() => {
    const canvas = canvasRef.current!
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      sizeRef.current = { width: r.width, height: r.height }
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      drawRef.current()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const pointers = new Map<number, { x: number; y: number }>()
    // 1本指で押して、ほとんど動かさずに離したら「地点を押した」
    let tap: { id: number; x: number; y: number } | null = null
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // すでに離されたポインターなどでは捕まえられない。捕まえられなくても操作は続ける
      }
      const p = local(e)
      pointers.set(e.pointerId, p)
      tap = pointers.size === 1 ? { id: e.pointerId, ...p } : null
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const p = local(e)
      if (tap && Math.hypot(p.x - tap.x, p.y - tap.y) > TAP_SLOP) tap = null
      if (pointers.size === 1) {
        viewRef.current = panBy(viewRef.current, p.x - prev.x, p.y - prev.y, limitsRef.current)
      } else if (pointers.size === 2) {
        // 2本指: 指の間の距離の比で寄せ引きし、指の中点の移動で動かす
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
        const before = Math.hypot(prev.x - other.x, prev.y - other.y)
        const after = Math.hypot(p.x - other.x, p.y - other.y)
        const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 }
        const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }
        let v = panBy(viewRef.current, mid.x - prevMid.x, mid.y - prevMid.y, limitsRef.current)
        if (before > 0 && after > 0) v = zoomAt(v, sizeRef.current, mid.x, mid.y, before / after, limitsRef.current)
        viewRef.current = v
      }
      pointers.set(e.pointerId, p)
      requestDraw()
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (e.type === 'pointerup' && tap?.id === e.pointerId) onPickRef.current(...toLocal(viewRef.current, sizeRef.current, tap.x, tap.y))
      tap = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      viewRef.current = zoomAt(viewRef.current, sizeRef.current, p.x, p.y, Math.exp(e.deltaY * 0.0015), limitsRef.current)
      requestDraw()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="map"
        tabIndex={0}
        aria-label={label}
        aria-describedby="map-keys"
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          // マウスや指で押して選ばれたときは十字を出さない（キーボードで来たときだけ）
          focusedRef.current = e.currentTarget.matches(':focus-visible')
          requestDraw()
        }}
        onBlur={() => {
          focusedRef.current = false
          requestDraw()
        }}
      />
      <p id="map-keys" className="map-keys">
        矢印キーで地図を動かし（Shift で大きく）、+ と − で寄せ引き、Enter で中央の十字の地点を出発地・目的地にする
      </p>
    </>
  )
}
