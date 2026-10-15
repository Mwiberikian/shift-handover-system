// Extracts the text pdfkit wrote into a PDF (standard fonts only): inflates
// each content stream and decodes the hex strings in its TJ arrays. One line
// per TJ operator. Good enough to assert what a generated PDF says.
const zlib = require('zlib');

function pdfText(buffer) {
  const src = buffer.toString('latin1');
  const lines = [];
  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    let content;
    try {
      content = zlib.inflateSync(Buffer.from(src.slice(start, end), 'latin1')).toString('latin1');
    } catch {
      continue; // not a Flate stream (fonts, images)
    }
    for (const [, array] of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lines.push([...array.matchAll(/<([0-9a-fA-F]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''));
    }
  }
  return lines.join('\n');
}

const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

module.exports = { pdfText, pageCount };
