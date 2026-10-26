// 画面操作のテスト。公開と同じ設定でビルドしたもの（CSP 入り）をローカルで配信し、画面なしの Chrome に
// 本物のマウス・タッチ・キーの入力を送って、経路の探索と表示・利用者の切り替え・通信の制限を確かめる。
// `npm run e2e` で実行する（先に dist-e2e へビルドしてから、このスクリプトが配信とブラウザを立ち上げる）。
// 地図の下地は地理院タイルを読むので、インターネットにつながっている必要がある（経路の判定はタイルに頼らない）。
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AREAS } from '../src/areas.ts'
import { projector } from '../src/geo.ts'
import { Browser, sleep, type Page, type Viewport } from './cdp.ts'
import { SOURCES } from './source.ts'

const PORT = 4203
const BASE = `http://127.0.0.1:${PORT}/`
const DESKTOP: Viewport = { width: 1280, height: 860 }
const PHONE: Viewport = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true }
const FAILURES = 'e2e-failures'

/** 地域の最初の表示（src/areaData.ts と同じ）: 画面中央が src/areas.ts の center、1px 1.2m */
function initialView(id: string) {
  const area = AREAS.find((a) => a.id === id)!
  const origin = SOURCES.find((s) => s.id === id)!.origin
  const [cx, cy] = projector(origin)(area.center.lat, area.center.lon)
  return { cx, cy, mpp: 1.2 }
}
// 押す地点は経路の点そのもの（src/data/<地域>.json の点の番号を添える）
/** 東京駅: 大手町（点 1717）。東京駅の南側（点 2470）まで、最短 836m・車椅子向け 857m */
const OTEMACHI: [number, number] = [-595.15, 252.63]
const SOUTH: [number, number] = [-139.99, -195.57]
/** 丸の内の歩道（点 1881）。目的地（点 3535）の直前に 2cm を超える段差があり、車椅子では行けない */
const MARUNOUCHI: [number, number] = [-379.91, -74.06]
const STEP_GOAL: [number, number] = [-471.66, 146.98]
/** 皇居の中。いちばん近い経路の点まで 78m あり、寄せる上限（60m）を超える */
const PALACE: [number, number] = [-1000, 0]
/** 渋谷〜新宿: 西新宿（点 5606）から新宿駅の東（点 6222）まで。最短 879m、車椅子向けは急な坂を避けて 1,239m */
const NISHI_SHINJUKU: [number, number] = [-1050.59, 1602.66]
const SHINJUKU_EAST: [number, number] = [-437.25, 1490.4]
/** 池袋: 西口側（点 396）から東口側（点 1130）まで。最短 937m。ベビーカーは階段 3 か所を越えないと行けない */
const IKEBUKURO_WEST: [number, number] = [-328.66, 19.96]
const IKEBUKURO_EAST: [number, number] = [277.07, -196.78]

class Ui {
  readonly page: Page
  /** いま見ている地域の最初の表示。押す位置はここから求める */
  view = initialView('tokyo')
  constructor(page: Page) {
    this.page = page
  }

  /** ヘッダーの「地域」を切り替えて、その地域の地図が出るまで待つ */
  async selectArea(id: string) {
    await this.page.run(`
      const s = document.querySelector('.area select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(id)});
      s.dispatchEvent(new Event('change', { bubbles: true }));
    `)
    const name = `${AREAS.find((a) => a.id === id)!.label}の歩行経路の地図`
    await this.page.waitFor(`document.querySelector('canvas.map')?.getAttribute('aria-label') === ${JSON.stringify(name)} && document.querySelector('canvas.map').width > 0`, name)
    this.view = initialView(id)
    await sleep(300)
  }

  async open() {
    await this.page.goto(BASE)
    await this.page.waitFor(`document.querySelector('canvas.map') && document.querySelector('canvas.map').width > 0`, '地図の表示')
    await sleep(300)
  }

  /** 次の描画が終わるのを待つ（地図は requestAnimationFrame か 100ms 後の setTimeout で描く） */
  async drawn() {
    await sleep(250)
  }

  /** 平面座標（m）の地点が、最初の表示で画面のどこに来るか（ページの CSS px） */
  async screenOf([x, y]: [number, number]) {
    const r = await this.page.run<{ left: number; top: number; width: number; height: number }>(`
      const r = document.querySelector('canvas.map').getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    `)
    const v = this.view
    return { x: r.left + r.width / 2 + (x - v.cx) / v.mpp, y: r.top + r.height / 2 - (y - v.cy) / v.mpp }
  }

  async click(x: number, y: number) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    }
    await this.drawn()
  }

  /** 最初の表示のまま、出発地と目的地を順に押す（目的地を押すと地図が引くことがあるので、押す位置は先に両方求める） */
  async route(from: [number, number], to: [number, number]) {
    const a = await this.screenOf(from)
    const b = await this.screenOf(to)
    await this.click(a.x, a.y)
    await this.click(b.x, b.y)
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    await this.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 10; i++) {
      await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10, button: 'left', buttons: 1 })
    }
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 })
    await this.drawn()
  }

  /** キーを1回押す。key は KeyboardEvent.key、code は物理キー、vk は Windows の仮想キーコード */
  async press(key: string, code: string, vk: number) {
    const base = { key, code, windowsVirtualKeyCode: vk }
    await this.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    if (key.length === 1) await this.page.send('Input.dispatchKeyEvent', { type: 'char', text: key, ...base })
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await this.drawn()
  }

  async tap(x: number, y: number) {
    await this.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await this.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await this.drawn()
  }

  async chooseProfile(label: string) {
    const p = await this.page.run<{ x: number; y: number }>(`
      const l = [...document.querySelectorAll('.profiles label')].find(l => l.innerText.trim() === ${JSON.stringify(label)});
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `)
    await this.click(p.x, p.y)
  }

  /** 要素の文字。要約の欄は横並び（flex）で innerText だと要素ごとに改行が入るので、textContent の空白をまとめて比べる */
  text(selector: string) {
    return this.page.run<string>(`return (document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/s+/g, ' ').trim()`)
  }

  /** 地図の canvas のうち、色 [r, g, b] に近い（各成分の差が tol 以内の）画素の数 */
  countColor([r, g, b]: [number, number, number], tol = 12) {
    return this.page.run<number>(`
      const c = document.querySelector('canvas.map');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ${r}) <= ${tol} && Math.abs(d[i + 1] - ${g}) <= ${tol} && Math.abs(d[i + 2] - ${b}) <= ${tol}) n++;
      return n;
    `)
  }

  /** canvas の中身の要約（動かしたかどうかを見るため） */
  canvasHash() {
    return this.page.run<number>(`
      const c = document.querySelector('canvas.map');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 1009) h = (h * 31 + d[i]) | 0;
      return h;
    `)
  }
}

/** 利用者向けの道の色（src/map/MapView.tsx の COLORS.route = #0b7a6c） */
const ROUTE_RGB: [number, number, number] = [11, 122, 108]
/** 通れない箇所の印の色（COLORS.blocked = #b42318） */
const BLOCKED_RGB: [number, number, number] = [180, 35, 24]

interface Scenario {
  name: string
  viewport?: Viewport
  run: (ui: Ui) => Promise<void>
}

const scenarios: Scenario[] = [
  {
    name: '開くと地図・経路の網・注記と出典が出る',
    async run(ui) {
      await ui.open()
      assert.equal(await ui.page.run(`return document.title`), 'dansa')
      await ui.page.waitFor(`performance.getEntriesByType('resource').some(e => e.name.startsWith('https://cyberjapandata.gsi.go.jp/xyz/pale/'))`, '地理院タイルの読み込み')
      assert.match(await ui.text('.result'), /出発地を選んで/)
      const credit = await ui.text('.credit')
      assert.match(credit, /地下通路・エレベーターは含みません/)
      assert.match(credit, /2017〜2018年度/)
      assert.match(credit, /地理院タイル/)
      assert.match(credit, /歩行空間ネットワークデータ（東京駅周辺）.*加工して作成/)
      const links = await ui.page.run<string[]>(`return [...document.querySelectorAll('.credit a')].map(a => a.href)`)
      assert.ok(links.includes('https://maps.gsi.go.jp/development/ichiran.html'))
      assert.ok(links.includes('https://www.hokoukukan.go.jp/metadata/detail/80'))
      // 道を選ぶ前は、利用者向けの道の色は地図にない
      assert.equal(await ui.countColor(ROUTE_RGB, 6), 0)
    },
  },
  {
    name: '東京駅: 2点を押すと最短と車椅子向けの道が出て、利用者を切り替えると引き直す',
    async run(ui) {
      await ui.open()
      await ui.route(OTEMACHI, SOUTH)
      // check:route と同じ探索なので、長さも同じになる
      const summary = await ui.text('.summary')
      assert.match(summary, /車椅子向け 857m（最短より \+22m）/)
      assert.match(summary, /最短 836m/)
      assert.match(await ui.text('.notes'), /を避けました/)
      assert.ok((await ui.countColor(ROUTE_RGB, 6)) > 500, '利用者向けの道が描かれていない')
      await ui.chooseProfile('ベビーカー')
      assert.match(await ui.text('.summary'), /ベビーカー向け 845m（最短より \+9m）/)
      await ui.chooseProfile('スーツケース')
      assert.match(await ui.text('.summary'), /スーツケース向け 843m/)
      // 入れ替えても長さは変わらない（どの経路も両方向に通れる。坂の向きで道が変わることはある）
      await ui.page.run(`[...document.querySelectorAll('.actions button')].find(b => b.innerText.includes('入れ替える')).click()`)
      await ui.drawn()
      assert.match(await ui.text('.summary'), /最短 836m/)
    },
  },
  {
    name: '車椅子で行けないときは、越えられない箇所と、置き直しの案内を出す',
    async run(ui) {
      await ui.open()
      await ui.route(MARUNOUCHI, STEP_GOAL)
      assert.match(await ui.text('.summary'), /車椅子で通れる道が見つかりません（最短は 340m）/)
      const notes = await ui.text('.notes')
      assert.match(notes, /赤い印の 段差1 を越えられれば、破線の道（340m）で行けます/)
      assert.match(notes, /出発地か目的地のすぐそば/)
      // 目的地のピンは地点の上に浮かせているので、目的地の直前の段差の印（赤）は隠れない
      assert.ok((await ui.countColor(BLOCKED_RGB, 6)) > 100, '通れない箇所の印が見えない')
      // ベビーカーなら段差は通れる（上乗せはある）
      await ui.chooseProfile('ベビーカー')
      assert.match(await ui.text('.summary'), /ベビーカー向け 340m/)
      assert.equal(await ui.countColor(BLOCKED_RGB, 6), 0)
    },
  },
  {
    name: '道のない所を押すと案内し、やり直すと最初に戻る',
    async run(ui) {
      await ui.open()
      const p = await ui.screenOf(PALACE)
      await ui.click(p.x, p.y)
      assert.match(await ui.text('.result'), /歩行経路のデータがありません/)
      await ui.route(OTEMACHI, SOUTH)
      assert.match(await ui.text('.summary'), /車椅子向け/)
      await ui.page.run(`[...document.querySelectorAll('.actions button')].find(b => b.innerText.includes('やり直す')).click()`)
      await ui.drawn()
      assert.match(await ui.text('.result'), /出発地を選んで/)
      assert.equal(await ui.countColor(ROUTE_RGB, 6), 0)
    },
  },
  {
    name: 'ドラッグで動かした地図は、押した判定にならない',
    async run(ui) {
      await ui.open()
      const before = await ui.canvasHash()
      const p = await ui.screenOf(MARUNOUCHI)
      await ui.drag(p, { x: p.x + 120, y: p.y + 60 })
      assert.notEqual(await ui.canvasHash(), before, '地図が動いていない')
      assert.match(await ui.text('.result'), /出発地を選んで/, 'ドラッグで地点が選ばれた')
      const h = await ui.canvasHash()
      await ui.page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -300 })
      await ui.drawn()
      assert.notEqual(await ui.canvasHash(), h, 'ホイールで寄らない')
    },
  },
  {
    name: 'キーボード: Tab で地域の選択、地図の順に移り、Enter で中央の地点を出発地にできる',
    async run(ui) {
      await ui.open()
      // 先頭はヘッダーの地域の選択。もう一度 Tab で地図
      await ui.press('Tab', 'Tab', 9)
      assert.ok(await ui.page.run<boolean>(`return document.activeElement === document.querySelector('.area select')`), 'Tab で地域の選択に移らない')
      await ui.press('Tab', 'Tab', 9)
      const focus = await ui.page.run<{ map: boolean; help: string }>(`
        const m = document.querySelector('canvas.map');
        return { map: document.activeElement === m && m.matches(':focus-visible'), help: getComputedStyle(document.querySelector('.map-keys')).display };
      `)
      assert.ok(focus.map, 'Tab で地図が選ばれない')
      assert.equal(focus.help, 'block', '操作の案内が出ない')
      // 中央 (-300, 0) から 37m の所に経路の点がある
      await ui.press('Enter', 'Enter', 13)
      assert.match(await ui.text('.result'), /次に目的地を押して/)
      // 利用者は矢印キーで選べる（ラジオボタン）
      await ui.page.run(`document.querySelector('.profiles input:checked').focus()`)
      await ui.press('ArrowRight', 'ArrowRight', 39)
      assert.equal(await ui.page.run(`return document.querySelector('.profiles input:checked').value`), 'suitcase')
    },
  },
  {
    name: '地域を切り替えると、地図・注意・出典がその地域のものになり、出発地は選び直しになる',
    async run(ui) {
      await ui.open()
      const p = await ui.screenOf(MARUNOUCHI)
      await ui.click(p.x, p.y)
      assert.match(await ui.text('.result'), /次に目的地を押して/)
      await ui.chooseProfile('ベビーカー')
      await ui.selectArea('ikebukuro')
      assert.match(await ui.text('.result'), /出発地を選んで/)
      const credit = await ui.text('.credit')
      assert.match(credit, /駅の東側と西側は階段/)
      assert.match(credit, /エレベーターは含みません。地下通路は一部だけです/)
      assert.match(credit, /歩行空間ネットワークデータ（池袋駅周辺）.*加工して作成/)
      const links = await ui.page.run<string[]>(`return [...document.querySelectorAll('.credit a')].map(a => a.href)`)
      assert.ok(links.includes('https://www.hokoukukan.go.jp/metadata/detail/82'))
      // 利用者の選択は地域をまたいで残る
      assert.equal(await ui.page.run(`return document.querySelector('.profiles input:checked').value`), 'stroller')
      await ui.selectArea('ueno')
      assert.match(await ui.text('.credit'), /上野駅の東側（浅草口・入谷口の側）は範囲外/)
    },
  },
  {
    name: '渋谷〜新宿: 車椅子は急な坂を避けて遠回りし、避けきれない坂は通ると示す',
    async run(ui) {
      await ui.open()
      await ui.selectArea('shibuya-shinjuku')
      await ui.route(NISHI_SHINJUKU, SHINJUKU_EAST)
      assert.match(await ui.text('.summary'), /車椅子向け 1,239m（最短より \+360m）最短 879m/)
      assert.match(await ui.text('.notes'), /それでも .*急な上り坂\d+.* を通ります/)
      await ui.chooseProfile('スーツケース')
      assert.match(await ui.text('.summary'), /スーツケース向け 885m/)
    },
  },
  {
    name: '池袋: 東西をまたぐ道はベビーカーでは階段を越えないと行けず、スーツケースなら出る',
    async run(ui) {
      await ui.open()
      await ui.chooseProfile('ベビーカー')
      await ui.selectArea('ikebukuro')
      await ui.route(IKEBUKURO_WEST, IKEBUKURO_EAST)
      assert.match(await ui.text('.summary'), /ベビーカーで通れる道が見つかりません（最短は 937m）/)
      assert.match(await ui.text('.notes'), /赤い印の 階段3 を越えられれば、破線の道（974m）で行けます/)
      assert.ok((await ui.countColor(BLOCKED_RGB, 6)) > 100, '通れない箇所の印が見えない')
      await ui.chooseProfile('スーツケース')
      assert.match(await ui.text('.summary'), /スーツケース向け \d/)
    },
  },
  {
    name: '公開版の CSP: 通信は拒否し、地理院タイルの画像だけ読める',
    async run(ui) {
      await ui.open()
      const csp = await ui.page.run<string>(`return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`)
      assert.match(csp, /connect-src 'none'/)
      assert.match(csp, /img-src 'self' https:\/\/cyberjapandata\.gsi\.go\.jp/)
      const blocked = await ui.page.run<boolean>(`
        try { await fetch('https://cyberjapandata.gsi.go.jp/xyz/pale/18/232846/103226.png'); return false } catch { return true }
      `)
      assert.ok(blocked, 'fetch が通ってしまう')
      const violations = await ui.page.run<string[]>(`return window.__csp`)
      assert.deepEqual(violations, ['connect-src https://cyberjapandata.gsi.go.jp/xyz/pale/18/232846/103226.png'])
    },
  },
  {
    name: 'スマホ: 指で2点を押せて、利用者の選択肢が1行に収まり、横にはみ出さない',
    viewport: PHONE,
    async run(ui) {
      await ui.open()
      const a = await ui.screenOf(MARUNOUCHI)
      const b = await ui.screenOf(SOUTH)
      await ui.tap(a.x, a.y)
      await ui.tap(b.x, b.y)
      assert.match(await ui.text('.summary'), /車椅子向け \d/)
      const layout = await ui.page.run<{ scrollW: number; innerW: number; mapH: number; rows: number }>(`
        const tops = new Set([...document.querySelectorAll('.profiles label')].map(l => Math.round(l.getBoundingClientRect().top)));
        return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, mapH: document.querySelector('canvas.map').getBoundingClientRect().height, rows: tops.size };
      `)
      assert.equal(layout.scrollW, layout.innerW, '横にはみ出している')
      assert.equal(layout.rows, 1, '利用者の選択肢が折り返している')
      assert.ok(layout.mapH > 380, `地図の高さ ${layout.mapH}px`)
    },
  },
]

let server: ChildProcess | null = null

async function startServer() {
  // vite の preview で dist-e2e を配信する（npx を介さず、どの OS でも同じ起動のしかたにする）
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) return
    await sleep(100)
  }
  await stopServer()
  throw new Error('テスト用のサーバーが起動しませんでした')
}

async function stopServer() {
  if (!server) return
  const s = server
  server = null
  const exited = new Promise((r) => s.once('exit', r))
  s.kill()
  await exited
}

async function main() {
  const only = process.argv[2]
  await startServer()
  const browser = await Browser.launch(9345)
  let failed = 0
  try {
    for (const s of scenarios.filter((s) => !only || s.name.includes(only))) {
      const page = await browser.newPage(s.viewport ?? DESKTOP)
      // ページの中で起きた CSP 違反を記録しておく（意図して起こすもの以外は起きないはず）
      await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));`,
      })
      const ui = new Ui(page)
      const t0 = Date.now()
      try {
        await s.run(ui)
        if (!s.name.startsWith('公開版の CSP')) assert.deepEqual(await page.run(`return window.__csp`), [], 'CSP 違反が起きた')
        console.log(`  ✓ ${s.name}（${((Date.now() - t0) / 1000).toFixed(1)}秒）`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${s.name}\n      ${e instanceof Error ? e.message : String(e)}`)
        mkdirSync(FAILURES, { recursive: true })
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => ({ data: '' }))
        if (data) writeFileSync(join(FAILURES, `${scenarios.indexOf(s) + 1}.png`), Buffer.from(data, 'base64'))
      } finally {
        await page.send('Page.close').catch(() => {})
      }
    }
  } finally {
    await browser.close()
    await stopServer()
  }
  if (failed > 0) {
    console.log(`\n${failed} 件失敗しました（失敗時の画面: ${FAILURES}/）`)
    process.exit(1)
  }
  console.log('\ne2e OK')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
