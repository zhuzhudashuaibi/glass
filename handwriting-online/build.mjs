import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'index.html');

const html = readFileSync(join(SRC, 'index.html'), 'utf8');
const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
const app = readFileSync(join(SRC, 'app.js'), 'utf8');
const samples = readFileSync(join(SRC, 'samples.json'), 'utf8');

for (const [name, text] of [['css', css], ['app', app], ['samples', samples]]) {
  if (text.includes('</script')) throw new Error(`${name} 含有 </script，无法安全内联`);
}

const out = html
  .replace(/<link rel="stylesheet" href="\.\/styles\.css">/, `<style>\n${css}\n</style>`)
  .replace(
    /<script src="\.\/app\.js"><\/script>/,
    `<script id="samplesData" type="application/json">${samples}</script>
<script>
${app}
</script>`
  );

if (out.includes('./styles.css') || out.includes('./app.js')) throw new Error('资源未能全部内联');

writeFileSync(OUT, out, 'utf8');
console.log('已生成', OUT, Buffer.byteLength(out, 'utf8'), 'bytes');
