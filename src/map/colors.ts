// 地図（canvas）に描く色。地図の下地はライト・ダークどちらのときも明るい灰色なので、色は1組だけ持つ。
// 見分けやすさは check:contrast で確かめる（MapView と同じ値を読むため、ここに分けてある）。

/** 地図の下地の色（タイルを読む前に塗る色。灰色にした淡色地図もほぼこの明るさ） */
export const MAP_BG = '#e8e8e4'

export const COLORS = {
  network: 'rgba(43, 92, 171, 0.5)',
  shortest: '#5f6675',
  route: '#0b7a6c',
  casing: '#ffffff',
  avoided: '#c2410c',
  blocked: '#b42318',
  start: '#1f2328',
  goal: '#c2410c',
}
