// Chỉ là lớp chuyển đổi văn bản: ký hiệu nước đi do thư viện @pikafish-js/rules sinh ra
// (toChineseNotation), ở đây chỉ đổi sang tiếng Việt và chuẩn hóa để so khớp.
import { toChineseNotation, type Move, type Position } from '@pikafish-js/rules';

const CN_NUM: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' };
const TO_VI: Record<string, string> = {
  车: 'Xe', 马: 'Mã', 炮: 'Pháo', 相: 'Tượng', 象: 'Tượng', 仕: 'Sĩ', 士: 'Sĩ', 帅: 'Tướng', 将: 'Tướng', 兵: 'Tốt', 卒: 'Tốt',
  进: 'tiến', 退: 'thoái', 平: 'bình', 前: 'trước', 后: 'sau', 中: 'giữa',
};

export function chinese(pos: Position, move: Move): string { return toChineseNotation(pos, move); }

export function vietnamese(pos: Position, move: Move): string {
  const cn = toChineseNotation(pos, move);
  const out: string[] = [];
  for (const ch of cn) out.push(CN_NUM[ch] ?? TO_VI[ch] ?? ch);
  // "Pháo 2 bình 5": tách từ bằng khoảng trắng
  return out.join(' ').replace(/\s+([+#])/g, '$1').trim();
}

const TRAD: Record<string, string> = { 俥: '车', 車: '车', 傌: '马', 馬: '马', 砲: '炮', 帥: '帅', 將: '将', 進: '进', 後: '后' };
const SAME: Record<string, string> = { 象: '相', 士: '仕', 将: '帅', 卒: '兵' };
const FW = '０１２３４５６７８９';

/** Chuẩn hóa một nước đi (Trung/Việt đã đổi sang chữ Hán) về dạng so khớp được. */
export function canon(s: string): string {
  let out = '';
  for (const raw of s) {
    let ch = TRAD[raw] ?? raw;
    ch = SAME[ch] ?? ch;
    if (CN_NUM[ch]) ch = CN_NUM[ch];
    const fw = FW.indexOf(ch);
    if (fw >= 0) ch = String(fw);
    if (/\s|[+#!?.,;]/.test(ch)) continue;
    out += ch;
  }
  return out;
}

const VI_WORDS: [RegExp, string][] = [
  [/tướng|soái|tuớng/gi, '帅'], [/tượng|tương/gi, '相'], [/pháo|phao|pháo/gi, '炮'], [/sĩ|sỹ/gi, '仕'],
  [/tốt|chốt|binh/gi, '兵'], [/(?<![\p{L}])(?:mã|ma)(?![\p{L}])/giu, '马'], [/(?<![\p{L}])xe(?![\p{L}])/giu, '车'],
  [/tiến|tới/gi, '进'], [/thoái|lùi|lui/gi, '退'], [/bình|ngang/gi, '平'],
  [/trước|tiền/gi, '前'], [/(?<![\p{L}])sau(?![\p{L}])|hậu/giu, '后'], [/giữa/gi, '中'],
];
const WXF_PIECE: Record<string, string> = { R: '车', H: '马', N: '马', E: '相', B: '相', A: '仕', K: '帅', C: '炮', P: '兵' };
const WXF_ACT: Record<string, string> = { '+': '进', '-': '退', '=': '平', '.': '平' };

/** Đổi tiếng Việt và WXF sang chữ Hán để rồi tách nước đi. */
export function toHan(text: string): string {
  let t = text.normalize('NFC');
  for (const [re, ch] of VI_WORDS) t = t.replace(re, ch);
  // WXF: C2=5, +C=5, H8+7
  t = t.replace(/([+-]?)([RHNEBAKCP])([1-9]?)([+\-=.])([1-9])/g, (_m, pos, p, f, a, d) =>
    (pos === '+' ? '前' : pos === '-' ? '后' : '') + WXF_PIECE[p] + f + WXF_ACT[a] + d);
  return t.replace(/\s+/g, '');
}

const PIECES = '车马炮相象仕士帅将兵卒俥傌砲帥將車馬';
const NUM = '一二三四五六七八九1-9０-９';
const RE_HAN = new RegExp(`([前中后後一二三四五]?)([${PIECES}])([${NUM}]?)([进進退平])([${NUM}])`, 'g');

export function extractHanMoves(text: string): string[] {
  const t = toHan(text);
  return [...t.matchAll(RE_HAN)].map((m) => m[0]);
}
