// Resizes the two sign-in page photos for the brand panel (AuthShell).
// Dev-only: sharp is a devDependency and nothing here runs in the browser.
//
//   npm run photos
//
// Reads public/images/login.jpg and signup.jpg (the full-size originals) and
// writes <name>-800 and <name>-1600 as WebP and JPG next to them. Each output
// must stay under 200 KB (NFR-01); the script fails if one does not. The photo
// sits under an 85-90% (login) or 75% (sign-up) gradient, so fine detail is
// lost anyway and the quality can be low.
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = fileURLToPath(new URL('../public/images/', import.meta.url));
const PHOTOS = ['login', 'signup'];
const WIDTHS = [800, 1600];
const LIMIT = 200 * 1024;
const FORMATS = {
  webp: (img) => img.webp({ quality: 58, effort: 6 }),
  jpg: (img) => img.jpeg({ quality: 62, mozjpeg: true, progressive: true }),
};

let failed = false;
for (const name of PHOTOS) {
  for (const width of WIDTHS) {
    for (const [ext, encode] of Object.entries(FORMATS)) {
      const out = `${dir}${name}-${width}.${ext}`;
      const info = await encode(sharp(`${dir}${name}.jpg`).rotate().resize({ width })).toFile(out);
      const kb = statSync(out).size / 1024;
      const over = kb * 1024 > LIMIT;
      failed ||= over;
      console.log(`${over ? 'OVER ' : 'ok   '}${name}-${width}.${ext}  ${info.width}x${info.height}  ${kb.toFixed(0)} KB`);
    }
  }
}
if (failed) process.exit(1);
