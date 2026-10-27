// 投稿カード用の素材を撮る（Chrome headless / CDP・DPR2）。実行: node source/shoot.js <出力フォルダ>
// 01-x-primary: 見本のデータを読んだボードの上部（月・数字のカード4つ・日ごとの棒グラフと前の月の点線）
// 02-export: 「画像で保存」で書き出す画像そのもの（Card2はこの下側＝日ごとのグラフ・曜日別・よく売れた物）
// 03-lower: ボードの下部（曜日ごとの1日平均・よく売れた物トップ5）（予備）
// 見本はすべて架空（カフェ みほん）。端末の今日を2026-10-28に固定し、9月全体と10月1〜27日の見本にする
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8794, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
const rectEv = js => `(()=>{const e=${js};const r=e.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height}})()`;
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
const pad = (a, p) => ({ x: Math.max(0, a.x - p), y: Math.max(0, a.y - p), width: a.w + p * 2, height: a.h + p * 2 });
const click = t => `[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(t)}).click()`;
// 占有率は probe_card_rows.py で測る（ここでは範囲の大きさと縦横比だけを出す）
const report = (name, c) => console.log(name, JSON.stringify({ w: Math.round(c.width), h: Math.round(c.height), ratio: +(c.width / c.height).toFixed(3) }));

(async () => {
  const b = await launch(9475);
  await b.send('Network.enable');
  await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const T=Date.UTC(2026,9,28,1,0,0);const D=Date;function F(...a){return a.length?new D(...a):new D(T)}F.now=()=>T;F.UTC=D.UTC;F.parse=D.parse;F.prototype=D.prototype;window.Date=F})()` });

  const W = +(process.env.SHOT_W || 700);
  await b.open(ORIGIN, W, 2600, 2, true, 'light');
  await b.ev(`localStorage.clear();` + click('見本のデータで試す')); await b.sleep(600);
  // 01: 月の見出しから凡例まで
  const top = union(await b.ev(rectEv(`document.querySelector('.monthbar')`)), await b.ev(rectEv(`document.querySelector('#board .legend')`)));
  const c1 = pad(top, 10); report('01-x-primary', c1);
  await b.shot(path.join(OUT, '01-x-primary.png'), c1);
  // 02: 曜日別とよく売れた物
  const low = union(await b.ev(rectEv(`document.querySelector('section[aria-labelledby=h-wd]')`)), await b.ev(rectEv(`document.querySelector('section[aria-labelledby=h-items]')`)));
  const c2 = pad(low, 8); report('03-lower-' + W, c2);
  await b.shot(path.join(OUT, '03-lower-' + W + '.png'), c2);
  // 03: 書き出す画像
  const url = await b.ev(`SBUI.renderPng().toDataURL('image/png')`);
  fs.writeFileSync(path.join(OUT, '02-export.png'), Buffer.from(url.split(',')[1], 'base64'));
  report('02-export', { width: 1080, height: 1350 });
  console.log('cards', JSON.stringify(await b.ev(`[...document.querySelectorAll('.card')].map(c=>[...c.children].map(x=>x.textContent))`)));
  b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
