// README に載せる画面の画像を撮る。公開と同じ設定のビルドを配信した状態（npm run build → npm run preview）で
// `npm run screenshots` を実行する。Edge（なければ Chrome）を画面なしで起動し、Chrome DevTools Protocol で操作する。
// 押す地点と利用者を決めて毎回同じ手順で撮るので、アプリを直したら同じ画像を撮り直せる。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Browser, sleep, type Page } from './cdp.ts'

const BASE = process.argv[2] ?? 'http://localhost:5204/'
const OUT = 'docs/images'

/** src/App.tsx の INITIAL と同じ */
const INITIAL = { cx: -300, cy: 0, mpp: 1.2 }
/** e2e.ts と同じ地点（経路の点そのもの） */
const OTEMACHI: [number, number] = [-595.15, 252.63]
const SOUTH: [number, number] = [-139.99, -195.57]
const MARUNOUCHI: [number, number] = [-379.91, -74.06]
const STEP_GOAL: [number, number] = [-471.66, 146.98]

/** 地理院タイルが読み終わって、描き直しが済むのを待つ */
async function settle(cdp: Page) {
  for (let i = 0; i < 50; i++) {
    const n = await cdp.run<number>(`return performance.getEntriesByType('resource').length`)
    await sleep(200)
    if (n === (await cdp.run<number>(`return performance.getEntriesByType('resource').length`))) break
  }
  await sleep(400)
}

/** 最初の表示のまま 2 点を押す（目的地を押すと地図が引くことがあるので、押す位置は先に両方求める） */
async function route(cdp: Page, from: [number, number], to: [number, number]) {
  const r = await cdp.run<{ left: number; top: number; width: number; height: number }>(`
    const r = document.querySelector('canvas.map').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  `)
  const at = ([x, y]: [number, number]) => ({ x: r.left + r.width / 2 + (x - INITIAL.cx) / INITIAL.mpp, y: r.top + r.height / 2 - (y - INITIAL.cy) / INITIAL.mpp })
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
    // 1. 大手町 → 東京駅の南側。車椅子向けは最短より 415m 長い
    await open()
    await route(cdp, OTEMACHI, SOUTH)
    await shoot(cdp, 'wheelchair.png')
    // 2. 同じ 2 点のベビーカー向け（9m の遠回りで済む）
    await chooseProfile(cdp, 'ベビーカー')
    await shoot(cdp, 'stroller.png')

    // 3. 車椅子で行けない例（目的地の直前に段差）
    await open()
    await route(cdp, MARUNOUCHI, STEP_GOAL)
    await shoot(cdp, 'blocked.png')

    // 4. スマホ
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await open()
    await route(cdp, MARUNOUCHI, SOUTH)
    await shoot(cdp, 'mobile.png')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
