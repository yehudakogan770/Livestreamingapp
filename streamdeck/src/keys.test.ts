// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KINDS, type KeySettings, type Kind } from './actions';
import { assetFiles } from './assets';
import { COLORS, dataUrl, keyModel, renderSvg, wrap, type KeyContext } from './keys';
import { deckState, NO_APP, type AppState } from './show';
import { sampleShow } from './testing';

const online = (app: Partial<AppState> = {}, show = sampleShow()): KeyContext => ({
  state: deckState(show, { ...NO_APP, ...app }),
  connection: 'online',
  deck: 'live',
  now: 0,
});

const model = (kind: Kind, s: KeySettings, ctx = online()) => keyModel(kind, s, ctx);
/** The key's background color. */
const background = (kind: Kind, s: KeySettings, ctx = online()) => renderSvg(model(kind, s, ctx)).match(/<rect width="144" height="144" fill="([^"]+)"/)![1];

describe('tally on input keys', () => {
  it('is red on air, green in Next, dark otherwise, on the screen the key works on', () => {
    expect(background('input', { input: 'cam1' })).toBe(COLORS.program);
    expect(background('input', { input: 'cam2' })).toBe(COLORS.preview);
    expect(background('input', { input: 'slides' })).toBe(COLORS.background);
    expect(background('input', { input: 'slides', screen: 'back' })).toBe(COLORS.program);
    expect(background('input', { input: 'slides' }, { ...online(), deck: 'back' })).toBe(COLORS.program);
    expect(model('input', { input: 'cam1' })).toMatchObject({ label: 'Camera 1', sub: 'On air' });
    expect(model('input', { input: 'cam2' }).sub).toBe('In Next');
    expect(model('input', { input: 'slides' }).sub).toBe('Input 3');
  });

  it('finds the input again by name in another event, and asks for one when none is chosen', () => {
    expect(model('input', { input: 'old-id', inputName: 'Camera 2' }).tone).toBe('preview');
    expect(model('input', {})).toMatchObject({ label: 'INPUT', sub: 'Choose input', tone: 'idle' });
  });
});

describe('what the other keys show', () => {
  it('overlays: red when on air, green when in Next, named after their input', () => {
    expect(model('overlay', { channel: '1' })).toMatchObject({ label: 'Slides', tone: 'program' });
    expect(model('overlay', { channel: '2' })).toMatchObject({ label: 'OVERLAY 2', tone: 'preview' });
    expect(model('overlay', { channel: '3' }).tone).toBe('idle');
  });

  it('recording, going live and rehearsal', () => {
    expect(model('record', {}).tone).toBe('idle');
    expect(model('record', {}, online({ recording: true }))).toMatchObject({ tone: 'program', sub: 'Hold to stop' });
    expect(model('record', { holdToStop: false }, online({ recording: true })).sub).toBe('Recording');
    expect(model('golive', {})).toMatchObject({ label: 'GO LIVE', sub: 'Hold' });
    expect(model('golive', {}, online({ streaming: true }))).toMatchObject({ label: 'LIVE', tone: 'program' });
    expect(model('golive', {}, online({ streaming: true, rehearsal: true }))).toMatchObject({ label: 'REHEARSING', tone: 'warn' });
    expect(model('rehearsal', {}, online({ rehearsal: true })).tone).toBe('warn');
  });

  it('panic, blank, presets, replay, cues, countdown and the screen switch', () => {
    const show = { ...sampleShow(), panic: true };
    expect(model('panic', {}, online({}, show))).toMatchObject({ tone: 'program', sub: 'Hold to end' });
    expect(model('blank', { screen: 'back' }).tone).toBe('warn');
    expect(model('blank', {}).tone).toBe('idle');
    expect(model('preset', { preset: 'p2' })).toMatchObject({ label: 'Speeches', tone: 'on' });
    expect(model('preset', { preset: 'p1' }).tone).toBe('idle');
    expect(model('preset', { preset: 'next' }).label).toBe('NEXT');
    expect(model('replay', { seconds: '20', slow: true }).sub).toBe('Press to arm');
    expect(model('replay', { seconds: '20', slow: true }, online({ replay: true })).label).toBe('20s ½×');
    expect(model('nextcue', {}).sub).toBe('Opening');
    expect(model('countdown', {})).toMatchObject({ label: '1:30', sub: 'Doors open', tone: 'idle' });
    const running = sampleShow();
    (running.sources as { kind: { timer?: { endsAt: number | null } } }[])[3]!.kind.timer!.endsAt = 65_500;
    expect(model('countdown', {}, { ...online({}, running), now: 0 })).toMatchObject({ label: '1:06', tone: 'on' });
    expect(model('screen', {}).label).toBe('LIVE');
    expect(model('screen', {}, { ...online(), deck: 'back' })).toMatchObject({ label: 'BACK', tone: 'on' });
  });

  it('a label of your own replaces the usual words', () => {
    expect(model('take', { label: 'Go' }).label).toBe('Go');
  });
});

describe('when Lumora can’t be reached', () => {
  it('grays the key and shows a warning sign with why', () => {
    const ctx: KeyContext = { state: null, connection: 'offline', deck: 'live', now: 0 };
    const m = keyModel('input', { input: 'cam1' }, ctx);
    expect(m).toMatchObject({ offline: true, sub: 'Lumora offline' });
    const svg = renderSvg(m);
    expect(svg).toContain(COLORS.warn);
    expect(svg).not.toContain(COLORS.program);
    expect(keyModel('take', {}, { ...ctx, connection: 'wrongPin' }).sub).toBe('Wrong PIN');
    expect(keyModel('take', {}, { ...ctx, connection: 'off' }).sub).toBe('Set up');
    // The Screen key is the deck's own: it always works.
    expect(keyModel('screen', {}, ctx).offline).toBeUndefined();
  });
});

describe('drawing', () => {
  it('fits names on the key', () => {
    expect(wrap('Camera 1', 11, 2)).toEqual(['Camera 1']);
    expect(wrap('Wide shot from the balcony', 11, 2)).toEqual(['Wide shot', 'from the…']);
    expect(wrap('Supercalifragilistic', 11, 1)).toEqual(['Supercalif…']);
  });

  it('keeps names as text, never as markup', () => {
    const svg = renderSvg({ icon: 'input', label: '<script>&"', tone: 'idle' });
    expect(svg).toContain('&lt;script&gt;&amp;&quot;');
    expect(svg).not.toContain('<script>');
  });

  it('shows how long is left to hold', () => {
    const m = keyModel('panic', {}, { ...online(), hold: 0.5 });
    expect(m.sub).toBe('Keep holding');
    expect(renderSvg(m)).toContain('width="68" height="8"');
  });

  it('hands Stream Deck an SVG picture', () => {
    expect(dataUrl('<svg/>')).toBe('data:image/svg+xml;charset=utf8,%3Csvg%2F%3E');
  });
});

describe('the plugin folder', () => {
  const dir = fileURLToPath(new URL('../com.lumora.streamdeck.sdPlugin/', import.meta.url));
  const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as {
    Version: string;
    UUID: string;
    Icon: string;
    CategoryIcon: string;
    CodePath: string;
    Nodejs: { Version: string };
    Actions: { UUID: string; Icon: string; PropertyInspectorPath: string; States: { Image: string }[] }[];
  };

  it('has the pictures drawn from the icons (run npm run streamdeck:pack after changing them)', () => {
    for (const [path, text] of Object.entries(assetFiles())) expect(readFileSync(`${dir}${path}`, 'utf8'), path).toBe(text);
  });

  it('lists every action, each with its pictures and settings panel', () => {
    expect(manifest.UUID).toBe('com.lumora.streamdeck');
    expect(manifest.CodePath).toBe('bin/plugin.js');
    expect(manifest.Nodejs.Version).toBe('20');
    expect(manifest.Actions.map((a) => a.UUID)).toEqual(KINDS.map((k) => `com.lumora.streamdeck.${k}`));
    for (const a of manifest.Actions) {
      expect(existsSync(`${dir}${a.Icon}.svg`), a.Icon).toBe(true);
      expect(existsSync(`${dir}${a.States[0]!.Image}.svg`)).toBe(true);
      expect(existsSync(`${dir}${a.PropertyInspectorPath}`)).toBe(true);
    }
    expect(existsSync(`${dir}${manifest.Icon}.svg`) && existsSync(`${dir}${manifest.CategoryIcon}.svg`)).toBe(true);
  });

  it('has the version of streamdeck/package.json (what Lumora compares to offer an update)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(manifest.Version).toBe(`${pkg.version}.0`);
  });
});
