// Exports for other systems: the title as an HTML / OGraf template (with the
// fonts it uses inside, so it looks the same on any playout computer).

import { resolveFont, tokensFor } from '../core/binding';
import { templateFiles } from '../core/htmlTemplate';
import { pack } from '../core/package';
import { unpack } from '../core/package';
import { zip } from '../core/zip';
import type { Asset, Layer, TitleProject } from '../core/types';
import type { Host } from './host';

/** The font families a title's text uses (as the event look is now). */
export function familiesUsed(p: TitleProject): string[] {
  const t = tokensFor(p, undefined);
  const out = new Set<string>([t.font, t.fontSub]);
  const walk = (ls: Layer[]) => {
    for (const l of ls) {
      if (l.type === 'group') walk(l.children);
      if (l.type !== 'text') continue;
      out.add(resolveFont(l.style.font, t));
      for (const m of l.text.matchAll(/\[f=([^\]]+)\]/g)) out.add(m[1]!.trim());
    }
  };
  for (const c of p.compositions) walk(c.layers);
  for (const s of p.textStyles ?? []) out.add(resolveFont(s.style.font, t));
  return [...out].filter(Boolean);
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

/** The page's own font files for a family (the fonts the Titler ships with), as data URLs. */
async function pageFontFaces(family: string): Promise<{ src: string; weight: string; style: string; range: string }[]> {
  if (typeof document === 'undefined') return [];
  const out: { src: string; weight: string; style: string; range: string }[] = [];
  const want = family.toLowerCase();
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of [...rules]) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const fam = unquote(r.style.getPropertyValue('font-family')).toLowerCase();
      if (fam !== want && fam !== `${want} variable`) continue;
      const m = /url\((['"]?)([^'")]+)\1\)/.exec(r.style.getPropertyValue('src'));
      if (!m) continue;
      try {
        const res = await fetch(new URL(m[2]!, sheet.href ?? location.href).href);
        if (!res.ok) continue;
        const blob = await res.blob();
        const data = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
        out.push({
          src: data,
          weight: r.style.getPropertyValue('font-weight') || '400',
          style: r.style.getPropertyValue('font-style') || 'normal',
          range: r.style.getPropertyValue('unicode-range') || '',
        });
      } catch {
        /* not reachable: left out (the playout computer's own font is used) */
      }
    }
  }
  return out;
}

/** The title with the Titler's own fonts it uses inside (fonts it already carries stay). */
export async function withFonts(p: TitleProject): Promise<TitleProject> {
  const have = new Set(p.assets.filter((a) => a.kind === 'font').map((a) => (a.family ?? '').toLowerCase()));
  const extra: Asset[] = [];
  for (const fam of familiesUsed(p)) {
    if (have.has(fam.toLowerCase())) continue;
    const faces = await pageFontFaces(fam);
    faces.forEach((f, i) =>
      extra.push({
        id: `font-${fam.replace(/\W+/g, '-')}-${i}`,
        name: `${fam} ${f.weight}`,
        kind: 'font',
        src: f.src,
        family: fam,
        weight: f.weight,
        style: f.style,
        ...(f.range ? { range: f.range } : {}),
      }),
    );
  }
  return extra.length ? { ...p, assets: [...p.assets, ...extra] } : p;
}

/** The title packed (pictures, videos and fonts inside), ready to go elsewhere. */
export async function selfContained(p: TitleProject, host: Host): Promise<TitleProject> {
  const text = await pack(await withFonts(p), host.readAsDataUrl ? (s) => host.readAsDataUrl!(s) : undefined);
  return unpack(text).project ?? p;
}

/** The HTML / OGraf template folder as a .zip. */
export async function templateZip(p: TitleProject, host: Host): Promise<Blob> {
  const { default: runtime } = await import('virtual:titler-player');
  const full = await selfContained(p, host);
  return new Blob([zip(templateFiles(full, runtime)) as BlobPart], { type: 'application/zip' });
}
