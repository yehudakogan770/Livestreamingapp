import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/importing.ts'
rep(p,"""  const text = new TextDecoder().decode(bytes);
  let json: unknown;""","""  const text = new TextDecoder().decode(bytes);
  if (/^\\s*(<\\?xml[^>]*>\\s*)?(<!--[\\s\\S]*?-->\\s*)*(<!DOCTYPE[^>]*>\\s*)?<svg[\\s>]/i.test(text)) return { kind: 'project', ...svgProject(text, baseName(name)) };
  let json: unknown;""")
rep(p,"import { fromLottie, isLottie } from '../core/lottie';","import { fromLottie, isLottie } from '../core/lottie';\nimport { newProject } from '../core/build';\nimport { fromSvg } from '../core/svgImport';")
rep(p,"export const IMPORT_ACCEPT = '.json,.lottie.json,.lumpack,.zip,.lumtitle,application/json,application/zip';","export const IMPORT_ACCEPT = '.json,.lottie.json,.lumpack,.zip,.lumtitle,.svg,application/json,application/zip,image/svg+xml';")
rep(p,"const baseName = (name: string) => name.replace(/\\.(lottie\\.json|json|lumpack|zip|lumtitle)$/i, '');","""const baseName = (name: string) => name.replace(/\\.(lottie\\.json|json|lumpack|zip|lumtitle|svg)$/i, '');

/** An SVG drawing as a title: its shapes as layers, on a composition of its size (at least 16 px a side). */
export function svgProject(text: string, name: string): { project: TitleProject; notes: string[] } {
  const r = fromSvg(text);
  const w = Math.max(16, Math.round(r.width));
  const h = Math.max(16, Math.round(r.height));
  const p = newProject(name, w, h);
  p.compositions[0]!.layers = r.layers.map((l) => ({ ...l, end: p.compositions[0]!.duration }));
  return { project: p, notes: r.notes };
}""")
p='titler/src/designer/Designer.tsx'
rep(p,"""        let layers = clipboard;
        try {
          const text = await navigator.clipboard?.readText();""","""        let layers = clipboard;
        try {
          const text = await navigator.clipboard?.readText();
          // SVG (Figma's "Copy as SVG", Illustrator): pasted as shape layers.
          if (text && /^\\s*(<\\?xml[^>]*>\\s*)?<svg[\\s>]/i.test(text)) {
            const svg = fromSvg(text);
            const c = store.comp();
            const pasted = svg.layers.map((l) => ({ ...l, end: c.duration }));
            if (!pasted.length) return store.set({ status: 'There were no shapes in the SVG.' });
            store.edit('Paste SVG', (p) => addLayers(p, c.id, pasted, sel()[0] ?? null), {
              selection: pasted.map((l) => l.id),
              status: `Pasted ${pasted.length} layer${pasted.length > 1 ? 's' : ''} from SVG${svg.notes.length ? ` (${svg.notes.join(' ')})` : ''}`,
            });
            return;
          }""")
rep(p,"import { pickImportFile, readImport } from './importing';","import { pickImportFile, readImport } from './importing';\nimport { fromSvg } from '../core/svgImport';")
