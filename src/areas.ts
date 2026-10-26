// 画面で選べる地域。データ（src/data/<id>.json）のほかに、画面に出す注意と最初に見せる場所を持つ。
// underground と elevators はデータの中身と食い違うと注意の文が嘘になるので、check:data で突き合わせる。

export interface Area {
  id: string
  label: string
  /** 最初に地図の中央に置く地点 */
  center: { lat: number; lon: number }
  /** 地下の経路（地下通路・地下の階）があるか。どの地域も、あっても一部だけ */
  underground: boolean
  /** エレベーターの経路があるか */
  elevators: boolean
  /** 調査の年度。配布ページに書かれていない地域は持たない */
  surveyed?: string
  /** その地域だけの注意（範囲の欠けなど） */
  note?: string
}

export const AREAS: Area[] = [
  {
    id: 'tokyo',
    label: '東京駅・丸の内',
    // 原点（東京駅の代表点、線路の中ほど）の 300m 西、丸の内側
    center: { lat: 35.68124, lon: 139.76381 },
    underground: false,
    elevators: false,
    // 配布ページの説明（平成29年度・平成30年度の整備分を統合）
    surveyed: '2017〜2018年度',
  },
  {
    id: 'shibuya-shinjuku',
    label: '渋谷〜新宿',
    center: { lat: 35.6896, lon: 139.7006 },
    underground: true,
    elevators: true,
    note: '新宿駅・千駄ヶ谷駅・国立競技場・表参道・渋谷駅を結ぶ範囲です。',
  },
  {
    id: 'ikebukuro',
    label: '池袋',
    center: { lat: 35.7295, lon: 139.7109 },
    underground: true,
    elevators: false,
    // ベビーカーで通れる経路だけでつなぐと東（987 点）と西（877 点）に分かれ、境の 12 本はすべて階段（2026-10-26 確認）
    note: '池袋駅の構内は含みません。データ上、駅の東側と西側は階段（歩道橋・地下道など）でしかつながっていないため、ベビーカーや車椅子では東西をまたぐ道が出ません。',
  },
  {
    id: 'ueno',
    label: '上野',
    center: { lat: 35.7128, lon: 139.7738 },
    underground: false,
    elevators: true,
    note: '上野駅の東側（浅草口・入谷口の側）は範囲外です。',
  },
]

/** 画面の下に出す、データの範囲についての注記。狭い画面で地図を圧迫しないよう短くする */
export function coverageNote(a: Area): string {
  const lacks = [!a.underground && '地下通路', !a.elevators && 'エレベーター'].filter(Boolean).join('・')
  const partial = [a.underground && '地下通路', a.elevators && 'エレベーター'].filter(Boolean).join('・')
  const scope = [lacks && `${lacks}は含みません`, partial && `${partial}は一部だけです`].filter(Boolean).join('。')
  const when = a.surveyed ? `調査は${a.surveyed}で` : '調査の年度は公表されておらず'
  return `地上の歩道が中心です。${scope}。${when}、いまと違う所があります。`
}
