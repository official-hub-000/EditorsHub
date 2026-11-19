/*
 * Proof that the English-only build still runs, and that no Indonesian is left on screen.
 *
 * Loads the real built page in jsdom, lets it boot, then reads back the text that would
 * actually be painted plus the shape labels that the Add sheet renders from JS data.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';

const PAGE = 'app/src/main/assets/www/index.html';
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { const m = String(e.message || e); if (!/getContext|Not implemented|matchMedia|CanvasRenderingContext2D/.test(m)) errs.push(m.slice(0, 180)); });

const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'),
  { url: 'https://local.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
await new Promise(r => setTimeout(r, 1200));

/*
 * jsdom does not fetch external <script src> by default, so the native-shell modules are not
 * loaded by parsing the page. On the device they are plain local files in appassets, so load
 * them here the same way - otherwise every check that depends on a module silently passes
 * against an empty namespace.
 */
const buildSrc = fs.readFileSync('tools/build-web-assets.mjs', 'utf8');
const modules = [...buildSrc.matchAll(/\.\/(amz-[^"]+)" defer/g)].map(m => m[1]);
let loaded = 0;
for (const m of modules) {
  const f = 'native-shell/' + m;
  if (!fs.existsSync(f)) { console.log('  MISSING MODULE ' + f); continue; }
  try { w.eval(fs.readFileSync(f, 'utf8')); loaded++; }
  catch (e) { console.log('  MODULE THREW ' + m + ': ' + e.message); }
}
console.log('  modules loaded: ' + loaded + '/' + modules.length);

let fail = 0;
const ok = (n, c, e = '') => { if (!c) { fail++; console.log('  FAIL ' + n + (e ? ' :: ' + e : '')); } else console.log('  ok   ' + n); };

// 1. the document is alive
ok('page booted', !!w.document.body);
ok('no new runtime errors', errs.length === 0, errs.slice(0, 2).join(' | '));

// 2. visible text is English
const IDWORDS = new Set(('dan atau tidak dengan untuk dari pada yang akan bisa harus sudah belum semua baru tutup buka cari pilih ' +
  'hapus tambah simpan batal lanjut kembali unggah unduh berkas proyek lapisan bentuk warna garis teks ukuran waktu ' +
  'kecepatan latar belakang geser putar kunci tampilkan sembunyikan pengaturan memuat gagal menunggu selesai kamera efek ' +
  'gambar suara durasi potong salin tempel atur ubah nilai sejajarkan akhir awal mahkota busur petir silang bintang belah ' +
  'ketupat panah tetesan kapsul lencana perisai awan matahari api keping salju bunga daun gembok lonceng kaca pembesar ' +
  'jempol pesawat roket amplop kontrol susun berurutan kategori').split(/\s+/));

const body = w.document.body.cloneNode(true);
body.querySelectorAll('script,style').forEach(n => n.remove());
const text = body.textContent || '';
const words = text.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
const idHits = new Set(words.filter(x => IDWORDS.has(x)));
ok('no Indonesian words in rendered text', idHits.size === 0, [...idHits].join(', '));

// 3. shape labels the Add sheet builds from data
const SHAPE_IDS = ['rect','roundrect','ellipse','triangle','star','polygon','arrow','diamond','plus','heart',
  'pie','crescent','penta','drop','ring','pill','star4','star5','star6','star8','burst','bubble','line',
  'wideline','doublearrow','chevron','arc','multifoil','hexagon','octagon','trapezoid','badge','shield',
  'cloud','sun','lightning','flame','snowflake','flower','leaf','checkmark','xmark','question','exclamation',
  'tag','bookmark','flag','pin','lock','key','callout_round','callout_cloud','banner1','banner2','ribbon',
  'crown','bell','music','camera_shape','play','pause','search','thumbsup','paperplane','rocket','airplane',
  'envelope','amlogo'];
const html = fs.readFileSync(PAGE, 'utf8');
const mapStart = html.indexOf("rect:'Box'");
const mapEnd = html.indexOf("amlogo:'", mapStart);
const map = html.slice(mapStart, mapEnd + 30);
const idLabels = [...map.matchAll(/([A-Za-z_0-9]+):\s*'([^']*)'/g)]
  .map(m => [m[1], m[2]])
  .filter(([, v]) => IDWORDS.size && (v.toLowerCase().match(/[a-zà-ÿ]+/g) || []).some(x => IDWORDS.has(x)));
ok('no Indonesian shape labels', idLabels.length === 0, idLabels.slice(0, 5).map(x => x.join('=')).join(', '));

// 4. nothing offers a language choice
ok('language button hidden', w.getComputedStyle(w.document.getElementById('homeLanguageBtn')).display === 'none');
ok('language modal not reachable', (() => { const b = w.document.getElementById('homeLanguageBtn'); let opened = false;
  try { b.onclick && b.onclick(); } catch (e) {} const m = w.document.getElementById('languageModal');
  return !m || w.getComputedStyle(m).display === 'none'; })());

// 5. the module is gone
ok('language module removed', typeof w.omsAmzLanguages === 'undefined');

// 6. the shape pipeline still works
ok('shapes still produce geometry', (() => {
  const S = w.omsAmzShapes; if (!S || !S.applyVectorPath) return false;
  let good = 0;
  for (const id of Object.keys(S.SHAPES)) {
    const l = { w: 100, h: 100, shape: id };
    if (S.applyVectorPath(l, id) && l.vectorNodes.length >= 3) good++;
  }
  return good === Object.keys(S.SHAPES).length;
})());

console.log(fail ? '\n  ' + fail + ' FAILED' : '\n  all checks passed');
process.exit(fail ? 1 : 0);
