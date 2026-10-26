// README に載せる画面の画像を撮る。公開と同じ設定のビルドを配信した状態（npm run build → npm run preview）で
// `npm run screenshots` を実行する。Edge（なければ Chrome）を画面なしで起動し、Chrome DevTools Protocol で操作する。
// 地域・押す地点・利用者を決めて毎回同じ手順で撮るので、アプリを直したら同じ画像を撮り直せる。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AREAS } from '../src/areas.ts'
import { projector } from '../src/geo.ts'
import { Browser, sleep, type Page } from './cdp.ts'
import { SOURCES } from './source.ts'

const BASE = process.argv[2] ?? 'http://localhost:5204/'
const OUT = 'docs/images'

/** e2e.ts と同じ地点（経路の点そのもの） */
const NISHI_SHINJUKU: [number, number] = [-1050.59, 1602.66]
const SHINJUKU_EAST: [number, number] = [-437.25, 1490.4]
const IKEBUKURO_WEST: [number, number] = [-328.66, 19.96]
const IKEBUKURO_EAST: [number, number] = [277.07, -196.78]
const MARUNOUCHI: [number, number] = [-379.91, -74.06]
const STEP_GOAL: [number, number] = [-471.66, 146.98]
const SOUTH: [number, number] = [-139.99, -195.57]

/** 地域の最初の表示（src/areaData.ts と同じ） */
function initialView(id: string) {
  const area = AREAS.find((a) => a.id === id)!
  const [cx, cy] = projector(SOURCES.find((s) => s.id === id)!.origin)(area.center.lat, area.center.lon)
  return { cx, cy, mpp: 1.2 }
}

/** 地理院タイルが読み終わって、描き直しが済むのを待つ */
async function settle(cdp: Page) {
  for (let i = 0; i < 50; i++) {
    const n = await cdp.run<number>(`return performance.getEntriesByType('resource').length`)
    await sleep(200)
    if (n === (await cdp.run<number>(`return performance.getEntriesByType('resource').length`))) break
  }
  await sleep(400)
}

async function selectArea(cdp: Page, id: string) {
  await cdp.run(`
    const s = document.querySelector('.area select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(id)});
    s.dispatchEvent(new Event('change', { bubbles: true }));
  `)
  const name = `${AREAS.find((a) => a.id === id)!.label}の歩行経路の地図`
  await cdp.waitFor(`document.querySelector('canvas.map')?.getAttribute('aria-label') === ${JSON.stringify(name)}`, name)
  await settle(cdp)
}

/** 最初の表示のまま 2 点を押す（目的地を押すと地図が引くことがあるので、押す位置は先に両方求める） */
async function route(cdp: Page, id: string, from: [number, number], to: [number, number]) {
  const v = initialView(id)
  const r = await cdp.run<{ left: number; top: number; width: number; height: number }>(`
    const r = document.querySelector('canvas.map').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  `)
  const at = ([x, y]: [number, number]) => ({ x: r.left + r.width / 2 + (x - v.cx) / v.mpp, y: r.top + r.height / 2 - (y - v.cy) / v.mpp })
  for (const p of [at(from), at(to)]) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    }
    await sleep(300)
  }
  await settle(cdp)
}

async function chooseProfile(cdp: Page, label: string) {
  await cdp.run(`[...document.querySelectorAll('.profiles label')].find(l => l.innerText.trim() === ${JSON.stringify(label)}).querySelector('input').click()`)
  await settle(cdp)
}

async function shoot(cdp: Page, name: string) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
  console.log(`  ${OUT}/${name}`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  // このブラウザ専用の一時プロファイルを使うので、普段のデータには触れない
  const browser = await Browser.launch()
  try {
    const cdp = await browser.newPage({ width: 1180, height: 820 })
    const open = async () => {
      await cdp.goto(BASE)
      // 同じポートで別の作品が動いていると、その画面を撮ってしまうので、dansa であることを先に確かめる
      const title = await cdp.run<string>(`return document.title`)
      if (title !== 'dansa') throw new Error(`${BASE} で動いているのは dansa ではありません（ページの題名: ${title || 'なし'}）`)
      await settle(cdp)
    }

    console.log('撮影:')
    // 1. 渋谷〜新宿: 西新宿 → 新宿駅の東。車椅子向けは急な坂を避けて最短より 360m 長い
    await open()
    await selectArea(cdp, 'shibuya-shinjuku')
    await route(cdp, 'shibuya-shinjuku', NISHI_SHINJUKU, SHINJUKU_EAST)
    await shoot(cdp, 'wheelchair.png')
    // 2. 同じ 2 点のベビーカー向け（17m の遠回りで済む）
    await chooseProfile(cdp, 'ベビーカー')
    await shoot(cdp, 'stroller.png')

    // 3. 池袋: 西口側 → 東口側。ベビーカーは階段を越えないと行けない
    await open()
    await chooseProfile(cdp, 'ベビーカー')
    await selectArea(cdp, 'ikebukuro')
    await route(cdp, 'ikebukuro', IKEBUKURO_WEST, IKEBUKURO_EAST)
    await shoot(cdp, 'ikebukuro.png')

    // 4. 東京駅: 車椅子で行けない例（目的地の直前に段差）
    await open()
    await route(cdp, 'tokyo', MARUNOUCHI, STEP_GOAL)
    await shoot(cdp, 'blocked.png')

    // 5. スマホ（東京駅。大手町はスマホの幅だと最初の表示の外なので、丸の内から）
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await open()
    await route(cdp, 'tokyo', MARUNOUCHI, SOUTH)
    await shoot(cdp, 'mobile.png')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
