// The check as plain text: "Copy details" and "Send to the Lumora team".
// Only drive letters, never folders; no names, keys or addresses.

import type { BrowserFacts, Facts, Report } from './rules';

const GRADE: Record<string, string> = { good: 'Good', ok: 'OK', low: 'Low', info: '—' };
const VERDICT: Record<string, string> = { yes: 'YES', risky: 'RISKY', no: 'NO' };
const SAFETY: Record<string, string> = { safe: 'Safe', risky: 'Risky', avoid: 'Avoid' };

export function detailsText(r: Report, f: Facts | null, b: BrowserFacts | null, version: string): string {
  const lines: string[] = [];
  lines.push(`System check: ${VERDICT[r.verdict]} — ${r.headline}`);
  lines.push(`${r.app === 'lumora' ? 'Lumora' : 'Lumora Studio'} ${version}`);
  lines.push('');
  for (const c of r.checks) {
    lines.push(`[${GRADE[c.grade]}] ${c.label}: ${c.value}${c.critical && c.grade === 'low' ? ' (needed)' : ''}`);
    if (c.advice) lines.push(`    ${c.advice}`);
  }
  lines.push('');
  lines.push(r.app === 'lumora' ? 'At an event on this computer:' : 'Editing on this computer:');
  for (const t of r.tips) lines.push(`  ${t.kind === 'do' ? 'DO' : 'DON’T'}: ${t.text}`);
  for (const x of r.features) lines.push(`  ${x.name}: ${SAFETY[x.safety]} — ${x.note}`);
  if (f) {
    lines.push('');
    lines.push(
      `GPUs: ${f.gpus.map((g) => `${g.name} (${g.vendor}, ${g.vramMb ?? '?'} MB, driver ${[g.driverVersion || '?', g.driverDate].filter(Boolean).join(' of ')})`).join('; ') || 'none listed'}`,
    );
    if (f.native) lines.push(`Native engine: ${f.native.adapters.map((a) => `${a.name} [${a.kind}, ${a.backend}]`).join('; ') || 'none'}`);
    lines.push(`Encoders: ${f.hwEncoders.join(', ') || 'none'}${f.hwDecode ? ` · decode ${f.hwDecode}` : ''}`);
    lines.push(`WebView2: ${f.webview2 ?? '?'} · FFmpeg ${f.ffmpeg.version || (f.ffmpeg.found ? 'found' : 'missing')}`);
    if (f.missing.length) lines.push(`Not measured: ${f.missing.join('; ')}`);
  }
  if (b) lines.push(`WebGL: ${b.webgl2 ? b.renderer || 'yes' : 'no WebGL 2'}`);
  // "Report a problem" keeps 4000 characters.
  const text = lines.join('\n');
  return text.length > 3800 ? `${text.slice(0, 3799)}…` : text;
}
