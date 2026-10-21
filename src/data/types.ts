// 同梱する src/data/network.json の形。経路は列ごとの配列で持つ（4,947本 × 項目数のオブジェクトを作らずに済む）。
// コードの意味は「歩行空間ネットワークデータ等整備仕様（2018年3月版）」表3.2 のとおり。99 は不明。

export const UNKNOWN = 99

/** 経路の構造（rt_struct） */
export const Struct = {
  Separated: 1, // 車道と歩道の物理的な分離あり
  NotSeparated: 2,
  Crosswalk: 3,
  UnmarkedCrossing: 4,
  Underpass: 5,
  Footbridge: 6,
  Indoor: 7, // 施設内通路
  Other: 8,
} as const

/** 経路の種別（route_type） */
export const Kind = {
  None: 1,
  MovingWalkway: 2,
  RailCrossing: 3,
  Elevator: 4,
  Escalator: 5,
  Stairs: 6,
  Slope: 7,
} as const

/** 幅員（width） */
export const Width = { Under1m: 1, Under2m: 2, Under3m: 3, Over3m: 4 } as const

/** 縦断勾配（vtcl_slope）。上り下りは「起点 → 終点」の向きで見たもの */
export const Slope = { Gentle: 1, SteepUp: 2, SteepDown: 3 } as const

/** 段差（lev_diff） */
export const Step = { Low: 1, High: 2 } as const

export interface Network {
  attribution: string
  source: { page: string; spec: string; fetchedAt: string }
  /** 平面の原点（hikage と同じ東京駅の代表点） */
  origin: { lat: number; lon: number }
  /** 点の位置。東向き・北向きの cm を [x0, y0, x1, y1, ...] で並べる */
  nodes: number[]
  /** 点の階層数（0 = 地上、1 = デッキ・歩道橋、0.5 = その間の踊り場） */
  floors: number[]
  links: {
    from: number[]
    to: number[]
    /** 長さ（dm）。元データは 0.1m 単位なので整数で正確に持てる */
    length: number[]
    struct: number[]
    kind: number[]
    width: number[]
    slope: number[]
    step: number[]
  }
}
