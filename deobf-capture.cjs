const fs = require('fs');
let src = fs.readFileSync('DAniApi/stream-4-player.min.js', 'utf8');
const cut = src.indexOf('var QsWjc=');
if (cut > 0) src = src.slice(0, cut);
globalThis.__caps = [];
src = src.replace('eval(H0Hub)', '(globalThis.__caps.push(String(H0Hub)), eval(H0Hub))');
try {
  Function(src)();
  const caps = globalThis.__caps || [];
  console.log('ok caps', caps.length);
  caps.forEach((c, i) => {
    fs.writeFileSync(`DAniApi/cap-${i}.js`, c);
    console.log('cap', i, 'len', c.length);
  });
} catch (e) {
  console.error('err', e && e.stack ? e.stack : e);
  const caps = globalThis.__caps || [];
  console.log('caps', caps.length);
  caps.forEach((c, i) => {
    fs.writeFileSync(`DAniApi/cap-${i}.js`, c);
    console.log('cap', i, 'len', c.length);
  });
  process.exit(1);
}
