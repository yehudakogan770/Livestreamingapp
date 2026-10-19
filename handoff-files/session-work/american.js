// Change "colour" to "color" in text people read: string literals, JSX text and comments
// (not names in the code, and not one-word ids like 'colour' that are saved in files).
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const MAP = {
  favourite: 'favorite', favourites: 'favorites', centre: 'center', centred: 'centered', centres: 'centers', grey: 'gray',
  catalogue: 'catalog', travelled: 'traveled', recognise: 'recognize', recognised: 'recognized', labelled: 'labeled',
  behaviour: 'behavior', cancelled: 'canceled', cancelling: 'canceling',
};
const RE = new RegExp(`(?<![A-Za-z_])(${Object.keys(MAP).join('|')})(?![A-Za-z_])`, 'gi');
const fix = (t) =>
  t.replace(RE, (m) => {
    const us = MAP[m.toLowerCase()];
    if (m === m.toUpperCase()) return us.toUpperCase();
    if (m[0] === m[0].toUpperCase()) return us[0].toUpperCase() + us.slice(1);
    return us;
  });
const ID = new RegExp(`^(${Object.keys(MAP).join('|')})$`);
let changed = 0;
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p, out); }
    else if (/\.(tsx?|rs)$/.test(f.name) && !p.includes('/engine/types/')) out.push(p);
  }
  return out;
}
const files = [...walk('app/src'), ...walk('crates'), ...walk('src-tauri/src')];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!RE.test(src)) continue;
  RE.lastIndex = 0;
  const edits = [];
  if (file.endsWith('.rs')) {
    // String literals and comments.
    const re = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*/g;
    let m;
    while ((m = re.exec(src))) {
      const inner = m[0].startsWith('"') ? m[0].slice(1, -1) : null;
      if (inner !== null && ID.test(inner)) continue;
      const f = fix(m[0]);
      if (f !== m[0]) edits.push([m.index, m.index + m[0].length, f]);
    }
  } else {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n) => {
      const k = n.kind;
      if (k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral || k === ts.SyntaxKind.JsxText ||
          k === ts.SyntaxKind.TemplateHead || k === ts.SyntaxKind.TemplateMiddle || k === ts.SyntaxKind.TemplateTail) {
        const s = n.getStart(sf), e = n.getEnd();
        const text = src.slice(s, e);
        if (k === ts.SyntaxKind.StringLiteral && ID.test(n.text)) return;
        // Keys used as ids (e.g. a tab or a pad called 'colours') stay; display text changes.
        const f = fix(text);
        if (f !== text) edits.push([s, e, f]);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // Comments.
    const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
    let m;
    while ((m = re.exec(src))) {
      if (edits.some(([s, e]) => m.index >= s && m.index < e)) continue;
      const f = fix(m[0]);
      if (f !== m[0]) edits.push([m.index, m.index + m[0].length, f]);
    }
  }
  if (!edits.length) continue;
  edits.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [s, e, f] of edits) out = out.slice(0, s) + f + out.slice(e);
  fs.writeFileSync(file, out);
  changed++;
}
console.log('files changed', changed);
