// A title as an HTML graphics template, for playout systems other than
// Lumora. One folder (a .zip) works everywhere:
//
//   index.html               CasparCG, SPX Graphics Controller, OBS and vMix
//                            browser sources, H2R Graphics, LiveOS: the page
//                            form, with play() / stop() / next() / update()
//   <name>.ograf.json        EBU OGraf manifest (Loopic, SPX, CasparCG with
//   graphic.mjs              OGraf, any OGraf renderer): the Web Component
//   README.txt               how to use it in each
//
// The title (with its pictures and fonts inside) and the player script are
// in every file, so each one works on its own and offline.

import type { TitleProject, Variable } from './types';
import type { ZipEntry } from './zip';

export const OGRAF_SCHEMA = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';

/** A safe folder / id name. */
export function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'title'
  );
}

/** JSON that can sit inside a <script> element. */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** A field as a JSON-schema property (OGraf's `schema`, also readable by SPX and Loopic). */
function fieldSchema(v: Variable): Record<string, unknown> {
  const base: Record<string, unknown> = { title: v.label || v.key, default: v.value };
  if (v.type === 'number') return { ...base, type: 'string', 'gddType': 'single-line', format: 'number' };
  if (v.type === 'color') return { ...base, type: 'string', gddType: 'color-rrggbb', pattern: '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' };
  if (v.type === 'image') return { ...base, type: 'string', gddType: 'file-path/image-path' };
  if (v.type === 'list') return { ...base, type: 'string', gddType: 'multi-line' };
  if (v.type === 'timer') return { ...base, type: 'string', description: 'A time (10:00); running: seconds@start time in ms' };
  if (v.options?.length) return { ...base, type: 'string', enum: v.options };
  return { ...base, type: 'string' };
}

export function dataSchema(p: TitleProject): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const v of p.variables) properties[v.key] = fieldSchema(v);
  return { type: 'object', properties };
}

const TIMER_PAYLOAD = {
  type: 'object',
  properties: { field: { type: 'string', title: 'Timer field (the first when left out)' }, seconds: { type: 'number', title: 'Seconds (for Add)' } },
};
const TIMER_ACTIONS = [
  { id: 'timerStart', name: 'Start timer', schema: TIMER_PAYLOAD },
  { id: 'timerStop', name: 'Stop timer', schema: TIMER_PAYLOAD },
  { id: 'timerToggle', name: 'Start or stop timer', schema: TIMER_PAYLOAD },
  { id: 'timerReset', name: 'Reset timer', schema: TIMER_PAYLOAD },
  { id: 'timerAdd', name: 'Add time', schema: TIMER_PAYLOAD },
];

export function ografManifest(p: TitleProject): Record<string, unknown> {
  const main = p.compositions.find((c) => c.id === p.main) ?? p.compositions[0];
  const inMs = main ? Math.round(main.markers.inEnd * 1000) : 0;
  const outMs = main ? Math.round((main.duration - main.markers.outStart) * 1000) : 0;
  return {
    $schema: OGRAF_SCHEMA,
    id: slug(p.name) + '-' + p.id.slice(-6),
    version: String(p.modified ?? 1),
    name: p.name,
    description: p.description ?? `${p.category}, made in Lumora Titler`,
    author: { name: 'Lumora Titler' },
    main: 'graphic.mjs',
    supportsRealTime: true,
    supportsNonRealTime: true,
    stepCount: 1,
    schema: dataSchema(p),
    ...(p.variables.some((v) => v.type === 'timer') ? { customActions: TIMER_ACTIONS } : {}),
    actionDurations: [
      { type: 'playAction', duration: inMs },
      { type: 'stopAction', duration: outMs },
      { type: 'updateAction', duration: 0 },
    ],
    renderRequirements: main ? [{ resolution: { width: { ideal: main.width }, height: { ideal: main.height } }, frameRate: { ideal: main.fps } }] : [],
    v_lumoraTitle: { format: p.format, version: p.version },
  };
}

/** SPX Graphics Controller's template definition (its fields and default playout). */
export function spxDefinition(p: TitleProject): Record<string, unknown> {
  return {
    description: p.name,
    playserver: 'OVERLAY',
    playchannel: '1',
    playlayer: '7',
    webplayout: '7',
    out: 'manual',
    uicolor: '2',
    dataformat: 'json',
    DataFields: p.variables.map((v) => ({
      field: v.key,
      ftype: v.type === 'list' ? 'textarea' : v.type === 'color' ? 'color' : v.options?.length ? 'dropdown' : 'textfield',
      title: v.label || v.key,
      value: v.value,
      ...(v.options?.length ? { items: v.options.map((o) => ({ text: o, value: o })) } : {}),
    })),
  };
}

export function templatePage(p: TitleProject, runtime: string): string {
  const main = p.compositions.find((c) => c.id === p.main) ?? p.compositions[0];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.name)}</title>
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}#title{position:fixed;inset:0}</style>
<script>window.SPXGCTemplateDefinition = ${scriptJson(spxDefinition(p))};</script>
</head>
<body>
<div id="title" data-width="${main?.width ?? 1920}" data-height="${main?.height ?? 1080}"></div>
<script>${runtime.replace(/<\/script/gi, '<\\/script')}</script>
<script>LumoraTitleRuntime.page(${scriptJson(p)});</script>
</body>
</html>
`;
}

export function ografModule(p: TitleProject, runtime: string): string {
  return `${runtime}\nconst Graphic = LumoraTitleRuntime.ograf(${scriptJson(p)});\nexport default Graphic;\n`;
}

export function readme(p: TitleProject): string {
  const keys = p.variables.map((v) => `  ${v.key.padEnd(16)} ${v.label}${v.type !== 'text' ? ` (${v.type})` : ''}`).join('\n') || '  (none)';
  const sample = p.variables[0]?.key ?? 'name';
  return `${p.name}: an HTML graphics template made in Lumora Titler
================================================================

Fields:
${keys}

CasparCG (HTML producer)
  Copy this folder into the server's template folder, then:
  CG 1-20 ADD 1 "${slug(p.name)}/index" 1 "{\\"${sample}\\":\\"Ada Lovelace\\"}"
  CG 1-20 UPDATE 1 "{\\"${sample}\\":\\"Grace Hopper\\"}"
  CG 1-20 STOP 1
  XML templateData (<componentData id="${sample}">) works too.

SPX Graphics Controller
  Copy this folder into ASSETS/templates/<project>; the fields appear in
  SPX by themselves (index.html carries SPXGCTemplateDefinition).

OBS Studio, vMix, Wirecast (browser source / web browser input)
  Point it at index.html (a local file) with the fields in the address:
  index.html?autoplay=1&${sample}=Ada%20Lovelace
  autoplay=1 takes the graphic when the page opens. The size of the
  source picks the title's format (16:9, 9:16, 1:1...) when it has formats.

OGraf (EBU): Loopic, SPX, CasparCG and other OGraf renderers
  Import the folder; the manifest is ${slug(p.name)}.ograf.json.

H2R Graphics, LiveOS
  Add it as an HTML / OGraf graphic from this folder.

Timers
  timer('start'), timer('stop'), timer('reset'), timer('add', 'clock', 60)
  on the page (CasparCG: CG 1-20 INVOKE 1 "timer('start')"); OGraf custom
  actions timerStart, timerStop, timerToggle, timerReset, timerAdd.

Your own page
  Put index.html in an iframe and send it messages:
  frame.contentWindow.postMessage({ lumoraTitle: 'update', data: { ${sample}: 'Ada' } }, '*')
  frame.contentWindow.postMessage({ lumoraTitle: 'play' }, '*')   // also 'stop', 'clear'
`;
}

/** Every file of the template folder. */
export function templateFiles(p: TitleProject, runtime: string): ZipEntry[] {
  const enc = new TextEncoder();
  const folder = slug(p.name);
  return [
    { name: `${folder}/index.html`, data: enc.encode(templatePage(p, runtime)) },
    { name: `${folder}/${folder}.ograf.json`, data: enc.encode(JSON.stringify(ografManifest(p), null, 2)) },
    { name: `${folder}/graphic.mjs`, data: enc.encode(ografModule(p, runtime)) },
    { name: `${folder}/README.txt`, data: enc.encode(readme(p)) },
  ];
}
