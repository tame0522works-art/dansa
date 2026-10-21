// 元データの出どころ。取得（fetch.ts）と変換（convert.ts）・確認（check-data.ts）で同じ値を使う。

export const DATASET_PAGE = 'https://www.hokoukukan.go.jp/metadata/detail/80'
export const SPEC = '歩行空間ネットワークデータ等整備仕様（2018年3月版）'
export const ATTRIBUTION = '国土交通省「歩行空間ネットワークデータ（東京駅周辺）」（政府標準利用規約2.0）を加工して作成'

const BASE = 'https://www.hokoukukan.go.jp/uploads/80/232'
export const FILES = {
  link: { url: `${BASE}/tokyoeki_link1.csv`, path: 'raw/link.csv' },
  node: { url: `${BASE}/tokyoeki_node1.csv`, path: 'raw/node.csv' },
} as const
export const FETCHED_AT_PATH = 'raw/fetched-at.txt'
