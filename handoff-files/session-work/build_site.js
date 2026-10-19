// Fill the icons and logos into the page.
const fs = require('fs');
const si = require('simple-icons');
let s = fs.readFileSync(__dirname + '/site_src.html', 'utf8');
s = s.replace(/\{\{i:([a-z0-9-]+)\}\}/g, (_, n) => {
  const svg = fs.readFileSync(`${__dirname}/node_modules/lucide-static/icons/${n}.svg`, 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
});
s = s.replace(/\{\{logo:(\w+)\}\}/g, (_, k) => `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" style="color:#${si[k].hex}"><path d="${si[k].path}" /></svg>`);
fs.writeFileSync('/home/user/Livestreamingapp/docs/index.html', s);
console.log('built', s.length, 'left over:', (s.match(/\{\{/g) || []).length);
