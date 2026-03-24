const fs = require('fs');
let src = fs.readFileSync('DAniApi/stream-4-player.min.js','utf8');
const cut = src.indexOf('var QsWjc=');
if (cut > 0) src = src.slice(0, cut);
try {
  Function(src + '\n;globalThis.__G96 = (typeof G96!=="undefined"?G96:null);')();
  const g = globalThis.__G96;
  console.log('G96?', !!g, g ? Object.keys(g).length : 0);
  if (g) {
    const keys = Object.keys(g);
    console.log('methods', keys.join(','));
    for (const k of keys.slice(0,5)) {
      const fn = g[k];
      if (typeof fn !== 'function') continue;
      for (let i=0;i<120;i++) {
        try {
          const v = fn(i);
          if (typeof v === 'string' && /https|api|stream|get|post|cid|type|base|domain|m3u8|source|url|sub|dub|auto/i.test(v)) {
            console.log(k, i, v);
          }
        } catch {}
      }
    }
  }
} catch(e) {
  console.error('err', e && e.stack ? e.stack : e);
  process.exit(1);
}
