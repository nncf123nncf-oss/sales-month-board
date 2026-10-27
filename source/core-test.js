// 純ロジックの検算。実行: node source/core-test.js
// index.html の <script id="core"> を取り出して読み込み、文字コード・CSVの読み方・日付と金額・列の推測・月の集計・見本のデータを確かめる
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const ctx = { module: { exports: {} }, TextEncoder, TextDecoder, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const SB = ctx.module.exports;
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log('NG', name, '\n  got ', g, '\n  want', w); }
}
const J = x => JSON.parse(JSON.stringify(x));
function load(text) {
  const t = SB.parseTable(text), hh = SB.looksLikeHeader(t.rows[0]);
  const cols = SB.guessColumns(t.rows, hh), d = SB.toRecords(t.rows, hh, cols);
  return { t, hh, cols: J(cols), d };
}
function stats(text, y, m, latest) { const L = load(text); return SB.monthStats(L.d.recs, y, m, latest); }

// ---- S1 見本のデータ: 別に書いた素朴な集計と突き合わせる ----
const TODAY = { y: 2026, m: 10, d: 28 };
const csv = SB.sampleCsv(TODAY);
const lines = csv.trim().split('\r\n').slice(1).map(l => l.split(','));
const naive = {};
lines.forEach(([dt, item, q, a]) => { const k = dt.slice(0, 10); (naive[k] = naive[k] || { sum: 0, items: {} }).sum += +a; naive[k].items[item] = (naive[k].items[item] || 0) + +a; });
const L1 = load(csv);
eq('S1 header', L1.hh, true);
eq('S1 cols', [L1.cols.date, L1.cols.amount, L1.cols.item, L1.cols.qty], [0, 3, 1, 2]);
eq('S1 bad', L1.d.bad, 0);
eq('S1 months', J(SB.months(L1.d.recs)), [[2026, 9], [2026, 10]]);
const s10 = SB.monthStats(L1.d.recs, 2026, 10, true), s9 = SB.monthStats(L1.d.recs, 2026, 9, false);
const sumMonth = (mm, upto) => Object.keys(naive).filter(k => +k.slice(5, 7) === mm && +k.slice(8) <= upto).reduce((a, k) => a + naive[k].sum, 0);
const daysMonth = (mm, upto) => Object.keys(naive).filter(k => +k.slice(5, 7) === mm && +k.slice(8) <= upto).length;
eq('S1 oct total', s10.total, sumMonth(10, 31));
eq('S1 oct partial', [s10.partial, s10.lastDay, s10.prevUpto], [true, 27, 27]);
eq('S1 oct salesDays', s10.salesDays, daysMonth(10, 31));
eq('S1 prev 1-27', s10.prevTotal, sumMonth(9, 27));
eq('S1 diff', s10.diff, sumMonth(10, 31) - sumMonth(9, 27));
eq('S1 pct', Math.round(s10.pct * 1000) / 1000, Math.round((sumMonth(10, 31) - sumMonth(9, 27)) / sumMonth(9, 27) * 100 * 1000) / 1000);
eq('S1 perDay', s10.perDay, sumMonth(10, 31) / daysMonth(10, 31));
eq('S1 prevPerDay', s10.prevPerDay, sumMonth(9, 27) / daysMonth(9, 27));
const bestK = Object.keys(naive).filter(k => k.startsWith('2026/10')).sort((a, b) => naive[b].sum - naive[a].sum || (a < b ? -1 : 1))[0];
eq('S1 best', s10.best, +bestK.slice(8));
// 曜日別
const wdN = {}; Object.keys(naive).filter(k => k.startsWith('2026/10')).forEach(k => { const w = new Date(Date.UTC(2026, 9, +k.slice(8))).getUTCDay(); (wdN[w] = wdN[w] || { t: 0, n: 0 }); wdN[w].t += naive[k].sum; wdN[w].n++; });
eq('S1 weekday', J(s10.weekdays).map(o => [o.days, o.total]), [0, 1, 2, 3, 4, 5, 6].map(w => wdN[w] ? [wdN[w].n, wdN[w].t] : [0, 0]));
eq('S1 monday closed', s10.weekdays[1].days, 0);
const itemsN = {}; Object.keys(naive).filter(k => k.startsWith('2026/10')).forEach(k => Object.entries(naive[k].items).forEach(([n, a]) => itemsN[n] = (itemsN[n] || 0) + a));
eq('S1 top5', J(s10.items).map(i => [i.name, i.total]), Object.entries(itemsN).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5));
eq('S1 qty', s10.hasQty, true);
eq('S1 sep complete', [s9.partial, s9.prevExists, s9.pct], [false, false, null]);
eq('S1 oct up ~10%', s10.pct > 3 && s10.pct < 20, true);
eq('S1 deterministic', SB.sampleCsv(TODAY) === csv, true);
const janCsv = SB.sampleCsv({ y: 2027, m: 1, d: 1 });
const janLines = janCsv.trim().split(/\r\n/);
eq('S1 sample on 1st', [janLines[1].slice(0, 7), janLines[janLines.length - 1].slice(0, 10)], ['2026/11', '2026/12/31']);
console.log('見本: 10月合計', SB.yen(s10.total), '先月1〜27日', SB.yen(s10.prevTotal), SB.signed(s10.diff), SB.pctText(s10.pct), '1日あたり', SB.yen(s10.perDay), '一番', SB.dayLabel(2026, 10, s10.best), SB.yen(s10.bestAmt));

// ---- S2 文字コード ----
const body = '日付,商品,金額\r\n2026/10/01,カフェラテ,550\r\n2026/10/02,紅茶,500\r\n';
const utf8 = Buffer.from(body, 'utf8'), bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), utf8]);
// Shift_JIS のバイト列（Node標準ではエンコードできないので、デコード結果が一致することで確かめる）
const sjisHex = '93fa957402e48f6f2c8fa4956902e48f6f2c8be08a7a0d0a323032362f31302f30312c834a83748346838983658142c35350300d0a';
const sjis = Buffer.from([
  0x93, 0xfa, 0x95, 0x74, 0x2c, 0x8f, 0xa4, 0x95, 0x69, 0x2c, 0x8b, 0xe0, 0x8a, 0x7a, 0x0d, 0x0a, // 日付,商品,金額
  0x32, 0x30, 0x32, 0x36, 0x2f, 0x31, 0x30, 0x2f, 0x30, 0x31, 0x2c, 0x83, 0x4a, 0x83, 0x74, 0x83, 0x46, 0x83, 0x89, 0x83, 0x65, 0x2c, 0x35, 0x35, 0x30, 0x0d, 0x0a, // 2026/10/01,カフェラテ,550
  0x32, 0x30, 0x32, 0x36, 0x2f, 0x31, 0x30, 0x2f, 0x30, 0x32, 0x2c, 0x8d, 0x67, 0x92, 0x83, 0x2c, 0x35, 0x30, 0x30, 0x0d, 0x0a // 2026/10/02,紅茶,500
]);
void sjisHex;
eq('S2 utf8', SB.decodeBytes(new Uint8Array(utf8)), { text: body, encoding: 'UTF-8' });
eq('S2 bom', SB.decodeBytes(new Uint8Array(bom)), { text: body, encoding: 'UTF-8' });
eq('S2 sjis', SB.decodeBytes(new Uint8Array(sjis)), { text: body, encoding: 'Shift_JIS' });
const tsv = body.replace(/,/g, '\t');
eq('S2 tsv same', J(stats(tsv, 2026, 10, true)).total, J(stats(body, 2026, 10, true)).total);
eq('S2 tsv delim', SB.detectDelim(tsv), '\t');
eq('S2 total', stats(body, 2026, 10, true).total, 1050);

// ---- S3 日付 ----
const D = s => J(SB.parseDate(s));
eq('S3 slash', D('2026/10/01'), { y: 2026, m: 10, d: 1 });
eq('S3 hyphen', D('2026-10-1'), { y: 2026, m: 10, d: 1 });
eq('S3 dot', D('2026.10.01'), { y: 2026, m: 10, d: 1 });
eq('S3 kanji', D('2026年10月1日'), { y: 2026, m: 10, d: 1 });
eq('S3 kanji time', D('2026年10月1日 13時24分'), { y: 2026, m: 10, d: 1 });
eq('S3 8digits', D('20261001'), { y: 2026, m: 10, d: 1 });
eq('S3 time', D('2026/10/01 13:24'), { y: 2026, m: 10, d: 1 });
eq('S3 iso', D('2026-10-01T13:24:00'), { y: 2026, m: 10, d: 1 });
eq('S3 fullwidth', D('２０２６／１０／０１'), { y: 2026, m: 10, d: 1 });
eq('S3 spaces', D('  2026/10/01  '), { y: 2026, m: 10, d: 1 });
['10/01/2026', '令和8年10月1日', '', '2026/13/01', '2026/02/30', '2026/00/10', 'abc', '2026/10', '202610011', '2026/10/01abc'].forEach(s => eq('S3 bad ' + s, D(s), null));
eq('S3 leap', D('2028/02/29'), { y: 2028, m: 2, d: 29 });
eq('S3 not leap', D('2026/02/29'), null);

// ---- S4 金額 ----
const A = s => SB.parseAmount(s);
[['1200', 1200], ['1,200', 1200], ['¥1,200', 1200], ['￥1,200', 1200], ['1,200円', 1200], ['１，２００', 1200], ['-500', -500], ['−500', -500], ['－500', -500],
 ['△500', -500], ['▲1,500', -1500], ['(500)', -500], ['（500）', -500], ['12.5', 12.5], ['0', 0], [' 300 ', 300], ['+300', 300], ['-¥500', -500], ['¥ 1,200', 1200], ['1200 円', 1200]
].forEach(([s, v]) => eq('S4 ' + s, A(s), v));
['abc', '', '1.2.3', '12,34', '1,2345', '¥', '円', '-', '1 2', '1e5', 'Infinity', '0x10'].forEach(s => eq('S4 bad ' + s, A(s), null));

// ---- S5 CSVの難所 ----
const P = s => J(SB.parseTable(s).rows);
eq('S5 quoted comma', P('a,"b,c",d\n'), [['a', 'b,c', 'd']]);
eq('S5 quoted newline', P('a,"b\nc",d\r\ne,f,g'), [['a', 'b\nc', 'd'], ['e', 'f', 'g']]);
eq('S5 dbl quote', P('"say ""hi""",2\n'), [['say "hi"', '2']]);
eq('S5 trailing blank', P('a,b\n\n\r\n,\n'), [['a', 'b']]);
eq('S5 no final newline', P('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
eq('S5 short row', load('日付,金額\n2026/10/01,100\n2026/10/02\n').d.bad, 1);
eq('S5 header only', load('日付,金額\n').d.recs.length, 0);
eq('S5 quoted amount', stats('日付,金額\n2026/10/01,"1,200"\n', 2026, 10, true).total, 1200);
eq('S5 one col', load('2026/10/01\n2026/10/02\n').cols.amount, -1);
eq('S5 empty', SB.parseTable('').rows.length, 0);
eq('S5 cr only', P('a,b\rc,d\r'), [['a', 'b'], ['c', 'd']]);

// ---- S6 列の推測 ----
let g = load('date,item,qty,amount\n2026-10-01,Tea,1,500\n2026-10-02,Cake,2,1240\n').cols;
eq('S6 english', [g.date, g.amount, g.item, g.qty], [0, 3, 1, 2]);
g = load('2026/10/01,ラテ,550\n2026/10/02,紅茶,500\n');
eq('S6 no header', [g.hh, g.cols.date, g.cols.amount, g.cols.item], [false, 0, 2, -1]);
eq('S6 no header total', SB.monthStats(g.d.recs, 2026, 10, true).total, 1050);
g = load('伝票番号,日付,小計,税込合計\n1001,2026/10/01,500,550\n1002,2026/10/01,1000,1100\n').cols;
eq('S6 two amount cands', [g.date, g.amount], [1, 3]);
g = load('No,売上日,金額\n1,2026/10/01,500\n2,2026/10/02,800\n').cols;
eq('S6 skip No', g.amount, 2);
g = load('日付,数量,税込金額\n2026/10/01,3,1500\n').cols;
eq('S6 qty not amount', [g.amount, g.qty], [2, 1]);
const noItem = stats('日付,金額\n2026/10/01,500\n', 2026, 10, true);
eq('S6 no item col', noItem.items, null);
g = load('受付日,お客様コード,電話番号,金額\n2026/10/01,00123,0312345678,5000\n').cols;
eq('S6 code/phone skipped', g.amount, 3);
g = load('x,y,z\n2026/10/01,12,5000\n2026/10/02,13,4800\n').cols;
eq('S6 no keyword → larger mean', [g.date, g.amount], [0, 2]);

g = load(['日付,金額', '2026/10/03,1000', '2026/10/04,△200', '2026/10/05,abc'].join('\n')).cols;
eq('S6 keyword with some unreadable', [g.date, g.amount], [0, 1]);
g = load(['x,y', '2026/10/03,1000', '2026/10/04,abc', '2026/10/05,abc'].join('\n')).cols;
eq('S6 no keyword mostly unreadable', g.amount, -1);

// レビュー①で見つかった取り違え（見出しの言葉の点数づけの穴）
const amtOf = rows => load(rows.join('\n')).cols;
g = amtOf(['日付,商品,税込単価,数量,金額', '2026/10/01,ラテ,550,2,1100', '2026/10/02,紅茶,500,1,500']);
eq('S6 unit price', g.amount, 4);
g = amtOf(['Date,Subtotal,Discount Amount,Total', '2026-10-01,1200,200,1000', '2026-10-02,800,0,800']);
eq('S6 subtotal/discount', g.amount, 3);
g = amtOf(['日付,金額,お預り金額', '2026/10/01,550,1000', '2026/10/02,500,500']);
eq('S6 received', g.amount, 1);
g = amtOf(['日付,合計件数,売上', '2026/10/01,12,15000', '2026/10/02,9,11000']);
eq('S6 count', g.amount, 2);
g = amtOf(['2026/10/01,10023456,カフェラテ,550', '2026/10/02,10023457,紅茶,500']);
eq('S6 no header slip no', [g.amount, g.sure], [3, false]);
g = amtOf(['日付,電話,金額', '2026/10/01,09012345678,550', '2026/10/02,0312345678,500']);
eq('S6 phone', g.amount, 2);
g = amtOf(['Date,Total Paid', '2026-10-01,1000']);
eq('S6 total paid', [g.amount, g.sure], [1, true]);
g = amtOf(['date,Grand Total,Tax', '2026-10-01,1100,100']);
eq('S6 grand total', g.amount, 1);
// 日付のあとに曜日
eq('S3 weekday paren', [D('2026/10/01(水)'), D('2026/10/01（水）'), D('20261001(水)')], [{ y: 2026, m: 10, d: 1 }, { y: 2026, m: 10, d: 1 }, { y: 2026, m: 10, d: 1 }]);
eq('S6 weekday paren cols', amtOf(['日付,金額', '2026/10/01(水),550', '2026/10/02(木),500']).date, 0);
// 先頭の題名の行
let pp = SB.prepare(SB.parseTable('売上一覧,期間 2026/10/01～2026/10/31\n\n日付,商品,金額\n2026/10/01,ラテ,550\n').rows);
eq('S5 title rows', [pp.skipped, pp.hasHeader, pp.rows[0]], [1, true, ['日付', '商品', '金額']]);
pp = SB.prepare(SB.parseTable('R8/10/01,山田,550\n2026/10/02,紅茶,500\n').rows);
eq('S5 first row unreadable date', [pp.skipped, pp.hasHeader], [1, false]);
pp = SB.prepare(SB.parseTable('2026/10/01,ラテ,550\n').rows);
eq('S5 no header', [pp.skipped, pp.hasHeader], [0, false]);
// 閉じていない引用符
const uq = SB.parseTable('日付,商品,金額\n2026/10/01,"お試し,550\n2026/10/02,紅茶,500\n');
eq('S5 unclosed', [uq.unclosed, uq.rows.length, uq.rows[2]], [true, 3, ['2026/10/02', '紅茶', '500']]);
// 品目名が Object の名前
const proto = stats('日付,商品,金額\n2026/10/01,constructor,100\n2026/10/01,toString,200\n2026/10/01,__proto__,300\n2026/10/01,ラテ,50\n', 2026, 10, true);
eq('S6 proto names', J(proto.items).map(i => i.name), ['__proto__', 'toString', 'constructor', 'ラテ']);

// ---- S7 月の扱い ----
const mk = rows => '日付,金額\n' + rows.map(r => r.join(',')).join('\n') + '\n';
let s = stats(mk([['2026/09/01', 100], ['2026/09/30', 300], ['2026/10/01', 200], ['2026/10/31', 400]]), 2026, 10, true);
eq('S7 complete month', [s.partial, s.total, s.prevTotal, s.diff, Math.round(s.pct * 10) / 10], [false, 600, 400, 200, 50]);
s = stats(mk([['2026/09/05', 100], ['2026/09/20', 900], ['2026/10/03', 300]]), 2026, 10, true);
eq('S7 partial upto 3', [s.partial, s.lastDay, s.prevUpto, s.prevTotal, s.pct], [true, 3, 3, 0, null]);
eq('S7 prev zero text', [s.prevExists, s.pct], [true, null]);
s = stats(mk([['2026/10/03', 300]]), 2026, 10, true);
eq('S7 no prev', [s.prevExists, s.pct, s.diff], [false, null, 300]);
s = stats(mk([['2027/02/10', 100], ['2027/02/28', 100], ['2027/03/30', 500]]), 2027, 3, true);
eq('S7 feb shorter', [s.partial, s.lastDay, s.prevUpto, s.prevTotal], [true, 30, 28, 200]);
s = stats(mk([['2026/12/05', 1000], ['2026/12/15', 500], ['2027/01/10', 700]]), 2027, 1, true);
eq('S7 year boundary', [s.prevY, s.prevM, s.prevUpto, s.prevTotal], [2026, 12, 10, 1000]);
s = stats(mk([['2026/09/01', 100], ['2026/09/20', 100], ['2026/10/01', 50]]), 2026, 9, false);
eq('S7 past month not partial', [s.partial, s.upto], [false, 30]);
s = stats(mk([['2026/10/02', 100], ['2026/10/02', 50]]), 2026, 10, true);
eq('S7 single', [s.total, s.salesDays, s.best, s.bestAmt], [150, 1, 2, 150]);

// 前の月のデータが途中から始まる（レビュー①）
const st7 = (rows, y, m, opt) => { const L = load(mk(rows)); return SB.monthStats(L.d.recs, y, m, opt); };
const rows15 = []; for (let d = 15; d <= 30; d++) rows15.push(['2026/09/' + d, 1000]); for (let d = 1; d <= 27; d++) rows15.push(['2026/10/' + String(d).padStart(2, '0'), 1000]);
s = st7(rows15, 2026, 10, true);
eq('S7 prev starts 15', [s.cmp, s.prevFrom, s.pct], ['start', 15, null]);
s = st7([['2026/09/10', 500], ['2026/10/03', 1000]], 2026, 10, true);
eq('S7 prev starts 10, upto 3', [s.cmp, s.prevFrom], ['start', 10]);
s = st7([['2026/09/01', 0], ['2026/09/10', 500], ['2026/10/03', 1000]], 2026, 10, true);
eq('S7 prev from day1 zero range', [s.cmp, s.prevTotal], ['zero', 0]);
s = st7([['2026/09/01', -500], ['2026/10/01', 1000]], 2026, 10, true);
eq('S7 prev negative', [s.cmp, s.pct], ['neg', null]);
// 末日が定休日の締まった月（端末の今日で判定）
const nov = []; for (let d = 1; d <= 29; d++) nov.push(['2026/11/' + String(d).padStart(2, '0'), 100]); nov.unshift(['2026/10/01', 100], ['2026/10/31', 100]);
s = st7(nov, 2026, 11, { latest: true, today: { y: 2026, m: 12 } });
eq('S7 closed month ends on holiday', [s.partial, s.prevUpto], [false, 31]);
s = st7(nov, 2026, 11, { latest: true, today: { y: 2026, m: 11 } });
eq('S7 current month still partial', [s.partial, s.prevUpto], [true, 29]);
s = st7(nov, 2026, 11, { latest: true, today: { y: 2026, m: 11 }, truncated: true });
eq('S7 truncated not partial', s.partial, false);
// 全部マイナスの月
s = st7([['2026/10/01', -100], ['2026/10/02', -50]], 2026, 10, true);
eq('S7 best none when negative', [s.best, s.bestAmt], [0, 0]);

// ---- S8 マイナス ----
let L8 = load(mk([['2026/10/01', 1000], ['2026/10/01', '△200'], ['2026/10/02', -100]]));
eq('S8 neg count', L8.d.neg, 2);
eq('S8 neg total', SB.monthStats(L8.d.recs, 2026, 10, true).total, 700);

// ---- S10 上限 ----
const big = '日付,金額\n' + Array.from({ length: SB.MAX_ROWS + 1 }, (_, i) => '2026/10/01,1').join('\n');
const L10 = load(big);
eq('S10 truncated', [L10.d.truncated, L10.d.recs.length], [true, SB.MAX_ROWS]);

// ---- 表示 ----
eq('fmt yen', SB.yen(412800), '412,800円');
eq('fmt yen round', SB.yen(12.5), '13円');
eq('fmt signed', [SB.signed(38200), SB.signed(-3000), SB.signed(0.2)], ['＋38,200円', '−3,000円', '±0円']);
eq('fmt pct', [SB.pctText(10.24), SB.pctText(-3.06), SB.pctText(0.01), SB.pctText(null)], ['＋10.2%', '−3.1%', '±0%', '']);
eq('fmt axis', [SB.axisYen(0), SB.axisYen(5000), SB.axisYen(20000), SB.axisYen(125000), SB.axisYen(150000000), SB.axisYen(100000000)], ['0', '5,000', '2万', '12.5万', '1.5億', '1億']);
eq('fmt nice', [SB.niceScale(0), SB.niceScale(38080), SB.niceScale(87000), SB.niceScale(9000), SB.niceScale(40000)].map(o => [o.top, o.step, o.n]), [[1000, 250, 4], [40000, 10000, 4], [100000, 25000, 4], [10000, 2500, 4], [40000, 10000, 4]]);
eq('prevRuns', J(SB.prevRuns({ has: [false, true, true, false, true, false, true, true, true] }, 8)), [[1, 2], [4], [6, 7, 8]]);
eq('dayLabel holiday', SB.dayLabel(2026, 10, 12), '10月12日（月・祝）');
eq('dayLabel', SB.dayLabel(2026, 10, 27), '10月27日（火）');
eq('holiday out of range', SB.isHoliday(2028, 1, 1), null);
eq('holidays 2026 kokumin', SB.isHoliday(2026, 9, 22), true);
eq('holidays 2027 furikae', SB.isHoliday(2027, 3, 22), true);
// 祝日表の振替が日曜の翌日になっているか（祝日が日曜なら、その後の最初の平日が祝日）
[2025, 2026, 2027].forEach(y => { for (let m = 1; m <= 12; m++) for (let d = 1; d <= SB.daysIn(y, m); d++) {
  if (SB.isHoliday(y, m, d) && SB.weekday(y, m, d) === 0) { let n = new Date(Date.UTC(y, m - 1, d + 1)); while (SB.isHoliday(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate())) n = new Date(n.getTime() + 864e5); n = new Date(n.getTime() - 864e5); const nn = new Date(n.getTime() + 864e5); eq('furikae ' + y + '-' + m + '-' + d, SB.isHoliday(nn.getUTCFullYear(), nn.getUTCMonth() + 1, nn.getUTCDate()) === false && SB.weekday(nn.getUTCFullYear(), nn.getUTCMonth() + 1, nn.getUTCDate()) !== 0, true); } } });

// ---- 列の選び方の保存（見出しだけ） ----
const mem = { s: {}, getItem(k) { return this.s[k] || null; }, setItem(k, v) { this.s[k] = v; } };
SB.saveCols(mem, ['日付', '金額'], { date: 0, amount: 1, item: -1, qty: -1, width: 2 });
eq('cols saved', J(SB.loadCols(mem, ['日付', '金額'])), { date: 0, amount: 1, item: -1, qty: -1 });
eq('cols other head', SB.loadCols(mem, ['日付', '売上']), null);
eq('cols stored as hash', /^[0-9a-f]{8}-2$/.test(JSON.parse(mem.s[SB.COLS_KEY])[0].k), true);
eq('cols no readable head', /日付|金額/.test(mem.s[SB.COLS_KEY]), false);
mem.s['sales-month-board-cols-v1'] = '[{"k":"x","c":{}}]'; mem.removeItem = function (k) { delete this.s[k]; };
SB.saveCols(mem, ['日付', '金額'], { date: 0, amount: 1, item: -1, qty: -1 });
eq('old key removed', mem.s['sales-month-board-cols-v1'], undefined);
mem.s[SB.COLS_KEY] = '{broken'; eq('cols broken', SB.loadCols(mem, ['日付', '金額']), null);
mem.s = {}; for (let i = 0; i < 12; i++) SB.saveCols(mem, ['h' + i], { date: 0, amount: 1, item: -1, qty: -1 });
eq('cols max 10', JSON.parse(mem.s[SB.COLS_KEY]).length, 10);

// ---- iOS判定（実在のUA文字列） ----
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
};
eq('ios iphone safari', SB.isIOS(UA.iphoneSafari, 5), true);
eq('ios iphone chrome', SB.isIOS(UA.iphoneChrome, 5), true);
eq('ios ipad (mac UA + touch)', SB.isIOS(UA.ipadOS, 5), true);
eq('ios mac', SB.isIOS(UA.mac, 0), false);
eq('ios android', SB.isIOS(UA.android, 5), false);
eq('ios win', SB.isIOS(UA.win, 0), false);

console.log(fail ? 'FAIL' : 'ALL PASS', pass + '件OK', fail + '件NG');
process.exit(fail ? 1 : 0);
