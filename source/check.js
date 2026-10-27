// 実画面の確認（Chrome headless / CDP）。実行: node source/check.js <出力フォルダ>
// 見本のデータ・ファイル選択（Shift_JIS）・貼り付け、375px/880px/1000pxの矩形、ライト/ダーク、棒を押したときの表示、月の切り替え、
// 列の選び直し、XSS、画像の書き出し、端末に残るもの、外への通信
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'check-out');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8782, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
let ng = 0;
const ok = (name, cond, info) => { if (!cond) ng++; console.log((cond ? 'OK ' : 'NG ') + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const measure = `(()=>{const out={sw:document.documentElement.scrollWidth,iw:innerWidth,over:[],small:[],vover:[]};
  document.querySelectorAll('main *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.right>innerWidth+0.5)out.over.push(e.tagName+'.'+(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className))});
  document.querySelectorAll('main button, main select, main .filebtn, main summary, main label.chk').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&(r.height<43.5||r.width<43.5))out.small.push((e.textContent||e.tagName).slice(0,14)+':'+Math.round(r.width)+'x'+Math.round(r.height))});
  document.querySelectorAll('.card .v').forEach(v=>{if(v.scrollWidth>v.clientWidth+0.5)out.vover.push(v.textContent)});
  out.over=[...new Set(out.over)].slice(0,8);out.small=out.small.slice(0,8);return out})()`;
const click = t => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(t)});if(!b)throw new Error('no button '+${JSON.stringify(t)});b.click();return true})()`;
const cards = `[...document.querySelectorAll('.card')].map(c=>[...c.children].map(x=>x.textContent))`;

(async () => {
  const b = await launch(9432);
  const reqs = [];
  b.on(m => { if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url); });
  await b.send('Network.enable');
  await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });
  const errs = [];
  b.on(m => { if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description)); });

  // 1) 空の画面 375px
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  await b.ev(`localStorage.clear();sessionStorage.clear()`); await b.open(ORIGIN, 375, 900, 2, true, 'light');
  let m = await b.ev(measure); ok('empty 375 no overflow', m.sw <= 375 && !m.over.length, m);
  ok('empty 375 targets>=44', !m.small.length, m.small);
  ok('board empty', await b.ev(`document.getElementById('board').children.length`) === 0);
  await b.ev(`document.querySelector('details.paste').open=true;` + click('貼った表を読む')); await b.sleep(100);
  ok('paste empty error', /貼り付けられていません/.test(await b.ev(`document.querySelector('.errors').innerText`)));

  // 2) 見本のデータ 375px
  await b.ev(click('見本のデータで試す')); await b.sleep(400);
  m = await b.ev(measure); ok('sample 375 no overflow', m.sw <= 375 && !m.over.length, m); ok('sample 375 targets', !m.small.length, m.small); ok('sample 375 values fit', !m.vover.length, m.vover);
  const c1 = await b.ev(cards);
  ok('cards', c1.length === 4 && /^[\d,]+円$/.test(c1[0][1]) && /先月の1〜27日と比べて/.test(c1[1][0]) && /^＋[\d,]+円$/.test(c1[1][1]) && /10月\d+日（土）/.test(c1[3][2]), c1);
  ok('month title', await b.ev(`document.getElementById('h-month').textContent`) === '2026年10月1〜27日（データのある日まで）');
  ok('status', /見本のデータ.*を読みました（[\d,]+行）/.test(await b.ev(`document.querySelector('.status').textContent`)));
  ok('cols summary', await b.ev(`document.querySelector('details.cols summary').textContent`) === '使っている列: 日付: 売上日時／金額: 税込金額／品目: 商品名');
  ok('31 bars', await b.ev(`document.querySelectorAll('svg.chart rect.bar').length`) === 31);
  ok('prev line', await b.ev(`!!document.querySelector('svg.chart polyline.prev')`));
  ok('wk marks', await b.ev(`document.querySelectorAll('svg.chart circle.wk').length`) === 10, await b.ev(`document.querySelectorAll('svg.chart circle.wk').length`)); // 10月: 土日9日＋スポーツの日
  const tip0 = await b.ev(`document.querySelector('.tip-line').textContent`);
  ok('tip best', /^10月\d+日（土） [\d,]+円／先月\d+日 /.test(tip0), tip0);
  await b.ev(`document.querySelectorAll('svg.chart rect.hit')[11].dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  const tip12 = await b.ev(`document.querySelector('.tip-line').textContent`);
  ok('tip tap 12', /^10月12日（月・祝） 売上なし／先月12日 [\d,]+円$/.test(tip12), tip12); // 見本は月曜定休（祝日も）
  ok('sel bar moved', await b.ev(`[...document.querySelectorAll('svg.chart rect.bar')].findIndex(r=>r.classList.contains('sel'))`) === 11);
  await b.ev(`document.querySelectorAll('svg.chart rect.hit')[4].dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  ok('tip monday closed', /^10月5日（月） 売上なし／先月5日/.test(await b.ev(`document.querySelector('.tip-line').textContent`)));
  ok('weekday rows', JSON.stringify(await b.ev(`[...document.querySelectorAll('#board .hbars:not(.items) li .lb')].map(x=>x.firstChild.textContent)`)) === JSON.stringify(['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜']));
  ok('weekday monday none', /売上なし/.test(await b.ev(`document.querySelector('#board .hbars li').textContent`)));
  const items = await b.ev(`[...document.querySelectorAll('.hbars.items li')].map(li=>li.textContent)`);
  ok('top5', items.length === 5 && /^1\. /.test(items[0]) && /個$/.test(items[0]), items);
  ok('table rows 27', await b.ev(`document.querySelectorAll('table.data tbody tr').length`) === 27);
  ok('svg aria-hidden', await b.ev(`document.querySelector('svg.chart').getAttribute('aria-hidden')`) === 'true');
  await b.shot(path.join(OUT, 'sample-375.png'), { x: 0, y: 0, width: 375, height: await b.ev(`document.documentElement.scrollHeight`) });

  // 3) 月の切り替え（9月＝先月のデータなし・月全体）
  await b.ev(click('◀ 前の月')); await b.sleep(200);
  const c9 = await b.ev(cards);
  ok('sept', await b.ev(`document.getElementById('h-month').textContent`) === '2026年9月1か月分' && c9[1][2] === '先月のデータがありません' && c9[1][1] === '—', c9);
  ok('sept nav', await b.ev(`[document.querySelector('[data-nav=prev]').disabled,document.querySelector('[data-nav=next]').disabled,document.activeElement.dataset.nav]`).then(x => JSON.stringify(x)) === '[true,false,"next"]');
  ok('sept no prev line', await b.ev(`!document.querySelector('svg.chart polyline.prev')`));
  await b.ev(click('次の月 ▶')); await b.sleep(200);

  // 4) 880px・1000px・ダーク
  for (const [w, scheme] of [[880, 'light'], [1000, 'dark'], [375, 'dark'], [320, 'light']]) {
    await b.open(ORIGIN, w, 900, 2, w < 600, scheme);
    await b.ev(click('見本のデータで試す')); await b.sleep(400);
    m = await b.ev(measure); ok(`sample ${w} ${scheme} no overflow`, m.sw <= w && !m.over.length, m); ok(`sample ${w} ${scheme} values fit`, !m.vover.length, m.vover);
    if (w >= 880) ok(`cards 4 in a row ${w}`, await b.ev(`(()=>{const c=[...document.querySelectorAll('.card')].map(x=>Math.round(x.getBoundingClientRect().top));return new Set(c).size===1})()`));
    await b.shot(path.join(OUT, `sample-${w}-${scheme}.png`), { x: 0, y: 0, width: w, height: Math.min(4000, await b.ev(`document.documentElement.scrollHeight`)) });
  }
  const darkBar = await b.ev(`getComputedStyle(document.querySelector('svg.chart rect.bar')).fill`);
  ok('dark ok', !!darkBar, darkBar);

  // 5) ファイル選択（Shift_JIS）
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  const sjis = Buffer.from([0x93, 0xfa, 0x95, 0x74, 0x2c, 0x8f, 0xa4, 0x95, 0x69, 0x2c, 0x8b, 0xe0, 0x8a, 0x7a, 0x0d, 0x0a,
    0x32, 0x30, 0x32, 0x36, 0x2f, 0x31, 0x30, 0x2f, 0x30, 0x31, 0x2c, 0x83, 0x4a, 0x83, 0x74, 0x83, 0x46, 0x83, 0x89, 0x83, 0x65, 0x2c, 0x35, 0x35, 0x30, 0x0d, 0x0a,
    0x32, 0x30, 0x32, 0x36, 0x2f, 0x31, 0x30, 0x2f, 0x30, 0x32, 0x2c, 0x8d, 0x67, 0x92, 0x83, 0x2c, 0x35, 0x30, 0x30, 0x0d, 0x0a]);
  const sjisFile = path.join(OUT, 'sjis-test.csv'); fs.writeFileSync(sjisFile, sjis);
  await b.pick('input[type=file]', sjisFile);
  ok('sjis status', /ファイル「sjis-test.csv」を読みました（2行・文字コード Shift_JIS）/.test(await b.ev(`document.querySelector('.status').textContent`)), await b.ev(`document.querySelector('.status').textContent`));
  ok('sjis total', (await b.ev(cards))[0][1] === '1,050円');
  ok('sjis items', JSON.stringify(await b.ev(`[...document.querySelectorAll('.hbars.items li .lb')].map(x=>x.textContent)`)) === JSON.stringify(['1. カフェラテ', '2. 紅茶']));

  // 6) 列の選び直しと保存（見出しの文字だけが残る）
  await b.ev(`document.querySelector('details.paste').open=true;document.getElementById('paste').value='日付\\t件数\\t売上\\n2026/10/01\\t3\\t1000\\n2026/10/02\\t2\\t2000';` + click('貼った表を読む')); await b.sleep(200);
  ok('paste tsv', (await b.ev(cards))[0][1] === '3,000円');
  await b.ev(`(()=>{const s=document.getElementById('col-amount');s.value='1';s.dispatchEvent(new Event('change'))})()`); await b.sleep(200);
  ok('reselect amount', (await b.ev(cards))[0][1] === '5円');
  await b.ev(click('貼った表を読む')); await b.sleep(200);
  ok('remembered cols', (await b.ev(cards))[0][1] === '5円');
  const store = await b.ev(`JSON.stringify({l:Object.assign({},localStorage),s:Object.assign({},sessionStorage)})`);
  const keys = JSON.parse(JSON.parse(store).l['sales-month-board-cols-v1']).map(e => e.k);
  ok('storage only heads', !/2026|1000|2000|カフェ|紅茶/.test(store) && Object.keys(JSON.parse(store).s).length === 0 && keys.includes('日付\u001f件数\u001f売上'), keys);

  // 7) 列を推測できない（1列だけ）
  await b.ev(`document.getElementById('paste').value='2026/10/01\\n2026/10/02';` + click('貼った表を読む')); await b.sleep(200);
  ok('need cols', /日付と金額の列を選んでください/.test(await b.ev(`document.querySelector('.status').textContent`)) && await b.ev(`document.querySelector('details.cols').open`));

  // 8) 読めない行・マイナス・祝日の範囲外
  await b.ev(`document.getElementById('paste').value='日付,金額\\n2028/01/03,1000\\n2028/01/04,△200\\n2028/01/05,abc\\n';` + click('貼った表を読む')); await b.sleep(200);
  const warns = await b.ev(`[...document.querySelectorAll('.warn')].map(x=>x.textContent)`);
  ok('warns', warns.length === 3 && /2028年の祝日/.test(warns[0]) && /読めなかった行: 1行/.test(warns[1]) && /マイナスの金額の行が1行/.test(warns[2]), warns);

  // 9) XSS
  const x = '<img src=x onerror=window.__x=1>', y = '\\"><script>window.__x=2</script>', z = '</svg><script>window.__x=3</script>';
  await b.ev(`document.getElementById('paste').value=${JSON.stringify('日付,' + x + ',金額\n2026/10/01,' + x + ',100\n2026/10/02,"' + y.replace(/\\/g, '') + '",200\n2026/10/03,' + z + ',300\n')};` + click('貼った表を読む')); await b.sleep(200);
  await b.ev(`(()=>{const s=document.getElementById('col-item');s.value='1';s.dispatchEvent(new Event('change'))})()`); await b.sleep(200);
  ok('xss none', await b.ev(`window.__x===undefined && !document.querySelector('#board img, #app script, #board script')`));
  ok('xss text shown', (await b.ev(`document.querySelector('.hbars.items').textContent`)).includes('<img src=x'));
  const png = await b.ev(`(()=>{const c=SBUI.renderPng();return [c.width,c.height,c.toDataURL().length>5000]})()`);
  ok('png xss draws', JSON.stringify(png) === '[1080,1350,true]' && await b.ev(`window.__x===undefined`), png);

  // 10) 画像で保存（PC: ダウンロード）
  await b.open(ORIGIN, 1000, 900, 1, false, 'light');
  await b.ev(click('見本のデータで試す')); await b.sleep(300);
  await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true }).catch(() => { });
  await b.ev(click('画像で保存')); await b.sleep(1200);
  ok('saved msg', /sales-2026-10\.png/.test(await b.ev(`document.querySelector('.saved').textContent`)));
  const dataUrl = await b.ev(`SBUI.renderPng().toDataURL('image/png')`);
  fs.writeFileSync(path.join(OUT, 'export-sales-2026-10.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  // iOS（共有シートが無いとき）は長押しの画像を出す
  await b.ev(`Object.defineProperty(navigator,'userAgent',{get:()=>'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'});navigator.canShare=undefined;` + click('画像で保存')); await b.sleep(300);
  ok('ios long-press fallback', await b.ev(`!!document.querySelector('.saved img') && /長押し/.test(document.querySelector('.saved').textContent)`));
  // iOS（共有シートあり）は navigator.share に File を渡す
  await b.ev(`window.__share=null;navigator.canShare=()=>true;navigator.share=(d)=>{window.__share=[d.files.length,d.files[0].name,d.files[0].type,d.files[0].size];return Promise.resolve()};` + click('画像で保存')); await b.sleep(300);
  const sh = await b.ev(`window.__share`);
  ok('ios share file', sh && sh[0] === 1 && sh[1] === 'sales-2026-10.png' && sh[2] === 'image/png' && sh[3] > 5000, sh);

  // 11) 外への通信（ページ自体以外に無い）
  const ext = reqs.filter(u => !u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:'));
  ok('no external requests', ext.length === 0, ext.slice(0, 5));
  ok('no js errors', errs.length === 0, errs.slice(0, 3));
  b.close(); srv.close();
  console.log(ng ? 'FAIL ' + ng : 'ALL PASS');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
