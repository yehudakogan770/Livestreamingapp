// The player on its own (exported templates): IN / HOLD / OUT on its clock,
// field values from every playout system's format, and the exported files
// (page, OGraf manifest and module) working as the systems call them.

import { beforeAll, describe, expect, it } from 'vitest';
import runtime from 'virtual:titler-player';
import { parseTemplateData, TitlePlayer, valuesFromQuery } from './player';
import { ografManifest, slug, spxDefinition, templateFiles, templatePage, OGRAF_SCHEMA } from '../core/htmlTemplate';
import { starterTemplates } from '../core/templates';
import type { TitleProject } from '../core/types';

const lower = () => starterTemplates().find((p) => p.name === 'Name and role')!;

// jsdom draws nothing (the renderer's pixels are checked by the golden frames).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

describe('field values from playout systems', () => {
  it('reads JSON text, objects, CasparCG XML and lists', () => {
    expect(parseTemplateData('{"name":"Ada","n":3}')).toEqual({ name: 'Ada', n: '3' });
    expect(parseTemplateData({ f0: { text: 'Grace' }, items: ['a', 'b'] })).toEqual({ f0: 'Grace', items: 'a\nb' });
    expect(
      parseTemplateData(
        '<templateData><componentData id="name"><data id="text" value="Ada &amp; Co &lt;3&gt;"/></componentData><componentData id="role"><data id="text" value=\'Host\'/></componentData></templateData>',
      ),
    ).toEqual({ name: 'Ada & Co <3>', role: 'Host' });
    expect(parseTemplateData('')).toEqual({});
    expect(parseTemplateData('{broken')).toEqual({});
    expect(parseTemplateData(null)).toEqual({});
  });

  it('takes only the title’s own fields from the address', () => {
    const p = lower();
    const key = p.variables[0]!.key;
    expect(valuesFromQuery(`?autoplay=1&${key}=Ada%20Lovelace&other=x`, p)).toEqual({ [key]: 'Ada Lovelace' });
  });
});

describe('the player', () => {
  const make = (p: TitleProject = lower()) => {
    let now = 1000;
    const host = document.createElement('div');
    const player = new TitlePlayer(host, p, { now: () => now, animate: false, sound: false, width: 960, height: 540 });
    return { player, host, tick: (ms: number) => ((now += ms), player.draw()) };
  };

  it('plays IN, holds, plays OUT on its own clock', async () => {
    const { player, tick } = make();
    const c = player.comp();
    await player.load();
    expect(player.state()).toBe('off');
    let inDone = false;
    void player.play().then(() => (inDone = true));
    expect(player.state()).toBe('in');
    tick(c.markers.inEnd * 1000 + 10);
    await new Promise((r) => setTimeout(r, 0));
    expect(player.state()).toBe('hold');
    expect(inDone).toBe(true);
    let outDone = false;
    void player.stop().then(() => (outDone = true));
    expect(player.state()).toBe('out');
    tick((c.duration - c.markers.outStart) * 1000 + 10);
    await new Promise((r) => setTimeout(r, 0));
    expect(player.state()).toBe('done');
    expect(outDone).toBe(true);
  });

  it('skips the animation when asked, and updates fields on air', async () => {
    const { player } = make();
    await player.load({ name: 'Ada' });
    await player.play(true);
    expect(player.state()).toBe('hold');
    player.update({ role: 'Host' });
    expect(player.getValues()).toMatchObject({ name: 'Ada', role: 'Host' });
    await player.stop(true);
    expect(player.state()).toBe('done');
  });

  it('puts its canvas in the host and takes it away', () => {
    const { player, host } = make();
    expect(host.querySelector('canvas')).toBe(player.canvas);
    player.dispose();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('refuses something that is not a title', () => {
    expect(() => new TitlePlayer(document.createElement('div'), { nope: 1 } as unknown as TitleProject)).toThrow();
  });
});

describe('the exported template', () => {
  it('is a folder with the page, the OGraf manifest and module, and a readme', () => {
    const p = lower();
    const files = templateFiles(p, '/*player*/');
    const folder = slug(p.name);
    expect(files.map((f) => f.name)).toEqual([`${folder}/index.html`, `${folder}/${folder}.ograf.json`, `${folder}/graphic.mjs`, `${folder}/README.txt`]);
    const manifest = JSON.parse(new TextDecoder().decode(files[1]!.data)) as Record<string, unknown>;
    expect(manifest.$schema).toBe(OGRAF_SCHEMA);
    expect(manifest.main).toBe('graphic.mjs');
    expect(manifest.supportsRealTime).toBe(true);
    expect(manifest.stepCount).toBe(1);
    expect(Object.keys((manifest.schema as { properties: object }).properties)).toEqual(p.variables.map((v) => v.key));
    expect(ografManifest(p).id).toMatch(/^name-and-role-/);
  });

  it('keeps a title’s words from closing its script', () => {
    const p = { ...lower(), name: 'Evil </script><script>alert(1)</script>' };
    const html = templatePage(p, 'var x = "</script>";');
    expect(html.match(/<\/script>/g)!.length).toBe(3);
    expect(html).toContain('<title>Evil &lt;/script>');
  });

  it('tells SPX its fields', () => {
    const p = lower();
    const d = spxDefinition(p) as { DataFields: { field: string; title: string }[] };
    expect(d.DataFields.map((f) => f.field)).toEqual(p.variables.map((v) => v.key));
  });

  it('runs as CasparCG and OBS run it: play, update, stop on the window', () => {
    const p = lower();
    const html = templatePage(p, runtime);
    // Run the page's scripts as the browser would.
    document.body.innerHTML = '<div id="title"></div>';
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    for (const s of scripts) new Function(s)();
    const w = window as unknown as Record<string, (...a: unknown[]) => unknown> & { lumoraTitle: TitlePlayer };
    expect(typeof w.play).toBe('function');
    expect(typeof w.update).toBe('function');
    expect((window as unknown as { SPXGCTemplateDefinition: unknown }).SPXGCTemplateDefinition).toBeTruthy();
    w.update!('{"name":"Grace Hopper"}');
    expect(w.lumoraTitle.getValues().name).toBe('Grace Hopper');
    w.play!();
    expect(w.lumoraTitle.state()).toBe('in');
    w.stop!();
    expect(w.lumoraTitle.state()).toBe('out');
    w.remove!();
    expect(w.lumoraTitle.state()).toBe('off');
    w.lumoraTitle.dispose();
  });

  it('is an OGraf Web Component', async () => {
    const p = lower();
    const src = templateFiles(p, runtime)[2]!;
    const code = new TextDecoder().decode(src.data).replace(/export default Graphic;\s*$/, 'return Graphic;');
    const Graphic = new Function(code)() as CustomElementConstructor;
    customElements.define('lumora-test-graphic', Graphic);
    const el = document.createElement('lumora-test-graphic') as HTMLElement &
      Record<string, (a?: unknown) => Promise<{ statusCode: number; currentStep?: number }>>;
    document.body.appendChild(el);
    expect(
      (await el.load!({ data: { name: 'Ada' }, renderType: 'realtime', renderCharacteristics: { resolution: { width: 640, height: 360 } } })).statusCode,
    ).toBe(200);
    expect(el.querySelector('canvas')).not.toBeNull();
    const played = el.playAction!({ skipAnimation: true });
    expect((await played).currentStep).toBe(0);
    expect((await el.updateAction!({ data: { name: 'Grace' } })).statusCode).toBe(200);
    expect((await el.stopAction!({ skipAnimation: true })).statusCode).toBe(200);
    expect((await el.customAction!({ id: 'x', payload: null })).statusCode).toBe(404);
    expect((await el.dispose!()).statusCode).toBe(200);
  });
});
