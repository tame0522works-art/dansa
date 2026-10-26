// 元データの出どころ。取得（fetch.ts）と変換（convert.ts）・確認（check-data.ts）で同じ値を使う。
// どの地域も国交省の歩行者移動支援サイトで配られている「2018年3月版適用」のデータで、列の作りは同じ。

export const SPEC = '歩行空間ネットワークデータ等整備仕様（2018年3月版）'

const UPLOADS = 'https://www.hokoukukan.go.jp/uploads'

export interface Source {
  /** src/data/<id>.json の名前になる */
  id: string
  /** データセットの題名の括弧の中 */
  title: string
  page: string
  link: string
  node: string
  /** 平面の原点。東京駅は hikage と同じ代表点、ほかは駅のあたり */
  origin: { lat: number; lon: number }
}

export const SOURCES: Source[] = [
  {
    id: 'tokyo',
    title: '東京駅周辺',
    page: 'https://www.hokoukukan.go.jp/metadata/detail/80',
    link: `${UPLOADS}/80/232/tokyoeki_link1.csv`,
    node: `${UPLOADS}/80/232/tokyoeki_node1.csv`,
    origin: { lat: 35.68124, lon: 139.76712 },
  },
  {
    // 新宿駅周辺（ID 81）の点はすべてこの範囲に入っているので、新宿はこれで足りる（2026-10-26 確認）
    id: 'shibuya-shinjuku',
    title: '東京都渋谷区・渋谷駅、千駄ヶ谷駅周辺／東京都新宿区・新宿駅周辺',
    page: 'https://www.hokoukukan.go.jp/metadata/detail/275',
    link: `${UPLOADS}/275/475/link.csv`,
    node: `${UPLOADS}/275/475/node.csv`,
    origin: { lat: 35.6762, lon: 139.7063 },
  },
  {
    id: 'ikebukuro',
    title: '池袋駅周辺',
    page: 'https://www.hokoukukan.go.jp/metadata/detail/82',
    link: `${UPLOADS}/82/234/ikebukuro_link.csv`,
    node: `${UPLOADS}/82/234/ikebukuro_node.csv`,
    origin: { lat: 35.7295, lon: 139.7109 },
  },
  {
    id: 'ueno',
    title: '台東区上野駅周辺',
    page: 'https://www.hokoukukan.go.jp/metadata/detail/84',
    link: `${UPLOADS}/84/242/uenoeki_Link.csv`,
    node: `${UPLOADS}/84/242/uenoeki_Node.csv`,
    origin: { lat: 35.7128, lon: 139.7738 },
  },
]

export const rawPath = (id: string, file: 'link.csv' | 'node.csv' | 'fetched-at.txt') => `raw/${id}/${file}`

export const attribution = (s: Source) => `国土交通省「歩行空間ネットワークデータ（${s.title}）」（政府標準利用規約2.0）を加工して作成`
