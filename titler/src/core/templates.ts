// The starter templates: clean broadcast graphics in the event's colors.
// Every color is a brand token ($box, $accent…) so each template takes on the
// event's look; no glows, no gradients, no emoji, no letter-spaced capitals.
// 1920×1080, inside the title-safe area.

import { DEFAULT_TOKENS } from './binding';
import { newComposition, newShape, newText, newImage, uid } from './build';
import { keys, still } from './easing';
import { fade, grow, reveal, setPhases, slide, wipe } from './motion';
import type { Asset, Composition, Layer, ShapeLayer, TextLayer, TextStyle, TitleProject, Variable, Vec2 } from './types';
import { FORMAT, VERSION } from './types';

export const CATEGORIES = ['Lower thirds', 'Bugs', 'Tickers and banners', 'Scoreboards', 'Full screen', 'Cards'] as const;

/** A neutral sample logo (two simple shapes), until the operator picks their own. */
export const SAMPLE_LOGO =
  'data:image/svg+xml;base64,' +
  b64(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect x="8" y="8" width="304" height="144" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="4" stroke-dasharray="14 10"/><circle cx="118" cy="80" r="34" fill="#ffffff"/><rect x="170" y="46" width="68" height="68" rx="6" fill="#ffffff" fill-opacity="0.6"/></svg>',
  );

function b64(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  return (globalThis as unknown as { Buffer: { from(s: string): { toString(e: string): string } } }).Buffer.from(s).toString('base64');
}

interface Spec {
  name: string;
  category: (typeof CATEGORIES)[number];
  description: string;
  duration?: number;
  inEnd?: number;
  out?: number;
  vars: Variable[];
  assets?: Asset[];
  build(c: Composition, O: number): Layer[];
  /** Full-screen graphics have an opaque background box. */
  loop?: { start: number; end: number };
}

const v = (key: string, label: string, value: string, extra: Partial<Variable> = {}): Variable => ({ key, label, type: 'text', value, ...extra });

function box(c: Composition, name: string, x: number, y: number, w: number, h: number, color = '$box', extra: Partial<ShapeLayer> = {}): ShapeLayer {
  const s = newShape(c, 'rect', [x, y], [w, h], color);
  s.name = name;
  return Object.assign(s, extra);
}

function words(
  c: Composition,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  style: Partial<TextStyle> = {},
  extra: Partial<TextLayer> = {},
): TextLayer {
  const t = newText(c, text, [x, y], [w, h], style);
  t.name = name;
  return Object.assign(t, extra);
}

const SIDE_IN: Vec2 = [-28, 0];

function make(spec: Spec): TitleProject {
  const duration = spec.duration ?? 8;
  const c = newComposition('Main', 1920, 1080, 30, duration);
  const out = spec.out ?? 0.6;
  setPhases(c, spec.inEnd ?? 1, out, spec.loop);
  const O = duration - out;
  c.layers = spec.build(c, O);
  return {
    format: FORMAT,
    version: VERSION,
    id: `tpl-${spec.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    main: c.id,
    compositions: [c],
    variables: spec.vars,
    tokens: { ...DEFAULT_TOKENS },
    assets: spec.assets ?? [],
  };
}

/** Standard lower-third motion: boxes wipe on from the left, words slide in; OUT reversed and quicker. */
function lowerThirdMotion(bar: ShapeLayer | null, boxes: ShapeLayer[], texts: TextLayer[], O: number) {
  if (bar) {
    grow(bar, { at: 0, dur: 0.35 }, false, 'y');
    fade(bar, { at: O + 0.35, dur: 0.25 }, true);
  }
  boxes.forEach((b, i) => {
    wipe(b, 'left', { at: 0.1 + i * 0.12, dur: 0.45 });
    wipe(b, 'right', { at: O + 0.1 + i * 0.05, dur: 0.38 }, true);
  });
  texts.forEach((t, i) => {
    slide(t, SIDE_IN, { at: 0.3 + i * 0.1, dur: 0.5 });
    fade(t, { at: 0.3 + i * 0.1, dur: 0.4 });
    fade(t, { at: O, dur: 0.22 }, true);
  });
}

const SPECS: Spec[] = [
  {
    name: 'Name and role',
    category: 'Lower thirds',
    description: 'A name over a role, each in its own box, with an accent bar. The boxes follow the words.',
    vars: [v('name', 'Name', 'Jordan Avery'), v('role', 'Role', 'Director of Operations')],
    build(c, O) {
      const bar = box(c, 'Accent bar', 160, 800, 8, 144, '$accent');
      const nameText = words(c, 'Name', 200, 800, 1400, 88, '{{name}}', { size: 50, weight: 700 }, { wrap: false });
      const roleText = words(c, 'Role', 200, 888, 1400, 56, '{{role}}', { size: 30, weight: 500, fill: { type: 'solid', color: '$textSub' } }, { wrap: false });
      const nameBox = box(c, 'Name box', 168, 800, 760, 88, '$box', { fitTo: { layer: nameText.id, pad: [32, 0], min: [320, 0] } });
      const roleBox = box(c, 'Role box', 168, 888, 600, 56, '$boxAlt', { fitTo: { layer: roleText.id, pad: [32, 0], min: [240, 0] } });
      lowerThirdMotion(bar, [nameBox, roleBox], [nameText, roleText], O);
      return [nameText, roleText, bar, roleBox, nameBox];
    },
  },
  {
    name: 'Two-line box',
    category: 'Lower thirds',
    description: 'Name and role together in one box with an accent rule underneath; words come in one after another.',
    vars: [v('name', 'Name', 'Morgan Ellis'), v('role', 'Role', 'Head of Product, Northwind')],
    build(c, O) {
      const nameText = words(c, 'Name', 196, 792, 1300, 72, '{{name}}', { size: 52, weight: 700, vAlign: 'bottom' }, { wrap: false });
      const roleText = words(
        c,
        'Role',
        196,
        864,
        1300,
        56,
        '{{role}}',
        { size: 32, weight: 400, vAlign: 'top', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      const panel = box(c, 'Box', 160, 776, 800, 164, '$box', { fitTo: { layer: nameText.id, pad: [36, 0], min: [520, 0] } });
      const rule = box(c, 'Accent rule', 160, 940, 800, 6, '$accent', { fitTo: { layer: nameText.id, pad: [36, 0], min: [520, 0] } });
      wipe(rule, 'left', { at: 0, dur: 0.4 });
      grow(panel, { at: 0.1, dur: 0.45 }, false, 'y');
      panel.transform.anchor = still<Vec2>([0, 164]);
      panel.transform.position = keys<Vec2>([0, [160, 940]]);
      reveal(nameText, 'word', { at: 0.35, dur: 0.45 }, 14);
      reveal(roleText, 'word', { at: 0.5, dur: 0.45 }, 10);
      fade(nameText, { at: O, dur: 0.25 }, true);
      fade(roleText, { at: O, dur: 0.25 }, true);
      grow(panel, { at: O + 0.15, dur: 0.35 }, true, 'y');
      wipe(rule, 'right', { at: O + 0.3, dur: 0.3 }, true);
      return [nameText, roleText, rule, panel];
    },
  },
  {
    name: 'Minimal',
    category: 'Lower thirds',
    description: 'A compact box with a thin accent line drawn on beside the words.',
    vars: [v('name', 'Name', 'Sam Patel'), v('role', 'Role', 'Keynote speaker')],
    build(c, O) {
      const nameText = words(c, 'Name', 216, 836, 1200, 56, '{{name}}', { size: 40, weight: 600 }, { wrap: false });
      const roleText = words(c, 'Role', 216, 892, 1200, 40, '{{role}}', { size: 26, weight: 400, fill: { type: 'solid', color: '$textSub' } }, { wrap: false });
      const panel = box(c, 'Box', 176, 820, 560, 128, '$box', { fitTo: { layer: nameText.id, pad: [40, 0], min: [420, 0] } });
      panel.transform.opacity = still(88);
      const line = newShape(c, 'path', [196, 836], [0, 0], '$accent');
      line.name = 'Accent line';
      line.fill = null;
      line.stroke = { paint: { type: 'solid', color: '$accent' }, width: 4, cap: 'butt' };
      line.path = { closed: false, v: [{ p: [0, 0] }, { p: [0, 96] }] };
      line.trim = { start: still(0), end: keys<number>([0.1, 0, 'smooth'], [0.6, 100]), offset: still(0) };
      fade(panel, { at: 0, dur: 0.35 });
      slide(nameText, [0, 12], { at: 0.25, dur: 0.45 });
      fade(nameText, { at: 0.25, dur: 0.4 });
      slide(roleText, [0, 12], { at: 0.35, dur: 0.45 });
      fade(roleText, { at: 0.35, dur: 0.4 });
      for (const l of [nameText, roleText, line]) fade(l, { at: O, dur: 0.25 }, true);
      fade(panel, { at: O + 0.15, dur: 0.4 }, true);
      return [nameText, roleText, line, panel];
    },
  },
  {
    name: 'Accent tab',
    category: 'Lower thirds',
    description: 'A short label in an accent tab, the name in a box beside it.',
    vars: [v('label', 'Label', 'Speaker'), v('name', 'Name', 'Riley Chen'), v('role', 'Role', 'Founder, Brightline Labs')],
    build(c, O) {
      const label = words(
        c,
        'Label',
        180,
        824,
        600,
        48,
        '{{label}}',
        { size: 26, weight: 700, fill: { type: 'solid', color: '$accentText' } },
        { wrap: false },
      );
      const tab = box(c, 'Tab', 160, 824, 200, 48, '$accent', { fitTo: { layer: label.id, pad: [20, 0], min: [120, 0] } });
      const nameText = words(c, 'Name', 196, 872, 1300, 76, '{{name}}', { size: 46, weight: 700 }, { wrap: false });
      const roleText = words(
        c,
        'Role',
        196,
        940,
        1300,
        40,
        '{{role}}',
        { size: 26, weight: 400, vAlign: 'top', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      const panel = box(c, 'Box', 160, 872, 700, 116, '$box', { fitTo: { layer: nameText.id, pad: [36, 0], min: [420, 0] } });
      lowerThirdMotion(null, [tab, panel], [label, nameText, roleText], O);
      return [label, nameText, roleText, tab, panel];
    },
  },
  {
    name: 'Centered name',
    category: 'Lower thirds',
    description: 'Name and role centered low on the screen, for interviews and panels.',
    vars: [v('name', 'Name', 'Alex Morgan'), v('role', 'Role', 'Moderator')],
    build(c, O) {
      const nameText = words(c, 'Name', 360, 830, 1200, 70, '{{name}}', { size: 46, weight: 700, align: 'center' }, { wrap: false });
      const roleText = words(
        c,
        'Role',
        360,
        900,
        1200,
        44,
        '{{role}}',
        { size: 28, weight: 400, align: 'center', vAlign: 'top', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      const panel = box(c, 'Box', 360, 818, 1200, 140, '$box', { fitTo: { layer: nameText.id, pad: [48, 0], min: [480, 0] } });
      const rule = box(c, 'Accent rule', 360, 958, 1200, 5, '$accent', { fitTo: { layer: nameText.id, pad: [48, 0], min: [480, 0] } });
      panel.transform.anchor = still<Vec2>([600, 70]);
      panel.transform.position = still<Vec2>([960, 888]);
      rule.transform.anchor = still<Vec2>([600, 0]);
      rule.transform.position = still<Vec2>([960, 958]);
      grow(rule, { at: 0, dur: 0.45 }, false, 'x');
      grow(panel, { at: 0.08, dur: 0.45 }, false, 'x');
      fade(panel, { at: 0.08, dur: 0.2 });
      for (const [i, t] of [nameText, roleText].entries()) {
        fade(t, { at: 0.35 + i * 0.1, dur: 0.4 });
        slide(t, [0, 10], { at: 0.35 + i * 0.1, dur: 0.45 });
        fade(t, { at: O, dur: 0.22 }, true);
      }
      grow(panel, { at: O + 0.15, dur: 0.35 }, true, 'x');
      grow(rule, { at: O + 0.25, dur: 0.35 }, true, 'x');
      return [nameText, roleText, rule, panel];
    },
  },
  {
    name: 'Social handle',
    category: 'Lower thirds',
    description: 'Where to follow: the network in an accent box, the handle beside it.',
    vars: [v('network', 'Network', 'Instagram'), v('handle', 'Handle', '@lumora.live')],
    build(c, O) {
      const net = words(
        c,
        'Network',
        184,
        868,
        400,
        64,
        '{{network}}',
        { size: 28, weight: 600, fill: { type: 'solid', color: '$accentText' } },
        { wrap: false },
      );
      const netBox = box(c, 'Network box', 160, 868, 220, 64, '$accent', { fitTo: { layer: net.id, pad: [24, 0], min: [140, 0] } });
      const handle = words(c, 'Handle', 160, 868, 1000, 64, '{{handle}}', { size: 34, weight: 600 }, { wrap: false });
      // The handle sits after the network box: parented to a null placed at its right edge would need text width; a fixed gap keeps it simple.
      handle.transform.position = still<Vec2>([400, 868]);
      const handleBox = box(c, 'Handle box', 380, 868, 400, 64, '$box', { fitTo: { layer: handle.id, pad: [20, 0], min: [200, 0] } });
      lowerThirdMotion(null, [netBox, handleBox], [net, handle], O);
      return [net, handle, netBox, handleBox];
    },
  },
  {
    name: 'Up next',
    category: 'Lower thirds',
    description: 'What comes next and when: a label, the title and the time.',
    vars: [v('label', 'Label', 'Up next'), v('title', 'Title', 'Panel: Building for the next decade'), v('time', 'Time', '2:30 PM')],
    build(c, O) {
      const label = words(c, 'Label', 196, 792, 600, 44, '{{label}}', { size: 26, weight: 700, fill: { type: 'solid', color: '$accent' } }, { wrap: false });
      const title = words(c, 'Title', 196, 836, 1100, 70, '{{title}}', { size: 42, weight: 700 }, { wrap: false });
      const time = words(c, 'Time', 196, 904, 600, 44, '{{time}}', { size: 28, weight: 500, fill: { type: 'solid', color: '$textSub' } }, { wrap: false });
      const panel = box(c, 'Box', 160, 776, 900, 188, '$box', { fitTo: { layer: title.id, pad: [36, 0], min: [560, 0] } });
      const bar = box(c, 'Accent bar', 160, 776, 6, 188, '$accent');
      lowerThirdMotion(bar, [panel], [label, title, time], O);
      return [label, title, time, bar, panel];
    },
  },
  {
    name: 'Chapter title',
    category: 'Lower thirds',
    description: 'A numbered section title, large and low on the left.',
    vars: [v('number', 'Number', '02'), v('title', 'Title', 'Questions from the audience')],
    build(c, O) {
      const num = words(
        c,
        'Number',
        160,
        800,
        140,
        140,
        '{{number}}',
        { size: 72, weight: 700, align: 'center', fill: { type: 'solid', color: '$accentText' } },
        { wrap: false, fit: 'shrink' },
      );
      const numBox = box(c, 'Number box', 160, 800, 140, 140, '$accent');
      const title = words(c, 'Title', 336, 800, 1300, 140, '{{title}}', { size: 56, weight: 700 }, { wrap: true, maxLines: 2 });
      const panel = box(c, 'Box', 300, 800, 900, 140, '$box', { fitTo: { layer: title.id, pad: [36, 0], min: [480, 0] } });
      grow(numBox, { at: 0, dur: 0.4 });
      numBox.transform.anchor = still<Vec2>([70, 70]);
      numBox.transform.position = keys<Vec2>([0, [230, 870]]);
      lowerThirdMotion(null, [panel], [num, title], O);
      grow(numBox, { at: O + 0.3, dur: 0.3 }, true);
      return [num, title, numBox, panel];
    },
  },
  {
    name: 'Live bug',
    category: 'Bugs',
    description: 'LIVE in an accent box with a short label, top right.',
    out: 0.5,
    vars: [v('live', 'Live label', 'LIVE'), v('label', 'Label', 'Main stage')],
    build(c, O) {
      const live = words(
        c,
        'Live',
        1460,
        70,
        120,
        48,
        '{{live}}',
        { size: 26, weight: 800, align: 'center', fill: { type: 'solid', color: '$accentText' } },
        { wrap: false },
      );
      const liveBox = box(c, 'Live box', 1460, 70, 120, 48, '$accent');
      const label = words(c, 'Label', 1596, 70, 240, 48, '{{label}}', { size: 24, weight: 500, align: 'left' }, { wrap: false, fit: 'shrink', minSize: 14 });
      const labelBox = box(c, 'Label box', 1580, 70, 280, 48, '$box');
      labelBox.transform.opacity = still(90);
      for (const [i, l] of [liveBox, labelBox].entries()) {
        wipe(l, 'left', { at: i * 0.1, dur: 0.35 });
        wipe(l, 'right', { at: O + 0.1, dur: 0.3 }, true);
      }
      for (const l of [live, label]) {
        fade(l, { at: 0.25, dur: 0.3 });
        fade(l, { at: O, dur: 0.2 }, true);
      }
      return [live, label, liveBox, labelBox];
    },
  },
  {
    name: 'Logo bug',
    category: 'Bugs',
    description: 'The event or sponsor logo in a corner, slightly see-through.',
    out: 0.5,
    vars: [v('logo', 'Logo', SAMPLE_LOGO, { type: 'image' })],
    build(c, O) {
      const logo = newImage(c, '{{logo}}', [220, 110], [1620, 70], 'Logo');
      logo.transform.opacity = still(85);
      fade(logo, { at: 0, dur: 0.5 });
      fade(logo, { at: O, dur: 0.5 }, true);
      return [logo];
    },
  },
  {
    name: 'Clock and place',
    category: 'Bugs',
    description: 'Time of day and the place, top left.',
    out: 0.5,
    vars: [v('time', 'Time', '7:45 PM', { bind: 'clock:time' }), v('place', 'Place', 'Hall A')],
    build(c, O) {
      const time = words(
        c,
        'Time',
        96,
        70,
        180,
        52,
        '{{time}}',
        { size: 28, weight: 700, align: 'center', fill: { type: 'solid', color: '$accentText' } },
        { wrap: false, fit: 'shrink' },
      );
      const timeBox = box(c, 'Time box', 96, 70, 180, 52, '$accent');
      const place = words(c, 'Place', 296, 70, 400, 52, '{{place}}', { size: 26, weight: 500 }, { wrap: false });
      const placeBox = box(c, 'Place box', 276, 70, 300, 52, '$box', { fitTo: { layer: place.id, pad: [20, 0], min: [140, 0] } });
      for (const [i, l] of [timeBox, placeBox].entries()) {
        wipe(l, 'left', { at: i * 0.1, dur: 0.35 });
        wipe(l, 'right', { at: O + 0.1, dur: 0.3 }, true);
      }
      for (const l of [time, place]) {
        fade(l, { at: 0.25, dur: 0.3 });
        fade(l, { at: O, dur: 0.2 }, true);
      }
      return [time, place, timeBox, placeBox];
    },
  },
  {
    name: 'Breaking banner',
    category: 'Tickers and banners',
    description: 'A full-width banner: a label in the accent color and the headline.',
    vars: [v('label', 'Label', 'Breaking'), v('headline', 'Headline', 'Main stage opens early: doors at 6:30 PM')],
    build(c, O) {
      const label = words(
        c,
        'Label',
        96,
        852,
        300,
        108,
        '{{label}}',
        { size: 40, weight: 800, align: 'center', fill: { type: 'solid', color: '$accentText' } },
        { wrap: false, fit: 'shrink' },
      );
      const labelBox = box(c, 'Label box', 96, 852, 300, 108, '$accent');
      const headline = words(c, 'Headline', 436, 852, 1360, 108, '{{headline}}', { size: 48, weight: 700 }, { wrap: true, maxLines: 2, minSize: 28 });
      const bar = box(c, 'Banner', 396, 852, 1428, 108, '$box');
      wipe(labelBox, 'left', { at: 0, dur: 0.35 });
      wipe(bar, 'left', { at: 0.15, dur: 0.5 });
      fade(label, { at: 0.2, dur: 0.3 });
      reveal(headline, 'word', { at: 0.45, dur: 0.5 }, 0);
      fade(headline, { at: O, dur: 0.2 }, true);
      fade(label, { at: O, dur: 0.2 }, true);
      wipe(bar, 'right', { at: O + 0.1, dur: 0.4 }, true);
      wipe(labelBox, 'right', { at: O + 0.3, dur: 0.3 }, true);
      return [label, headline, labelBox, bar];
    },
  },
  {
    name: 'News ticker',
    category: 'Tickers and banners',
    description: 'A crawl along the bottom with a label; the items come from a list.',
    duration: 10,
    vars: [
      v('label', 'Label', 'Latest'),
      v('items', 'Items', 'Doors open at 6:30 PM\nWorkshops continue in Hall B\nLivestream replay available tomorrow\nFood trucks on the north lawn', {
        type: 'list',
        separator: '        ',
      }),
    ],
    build(c, O) {
      const label = words(
        c,
        'Label',
        96,
        960,
        220,
        64,
        '{{label}}',
        { size: 30, weight: 700, align: 'center', fill: { type: 'solid', color: '$accentText' } },
        { wrap: false, fit: 'shrink' },
      );
      const labelBox = box(c, 'Label box', 96, 960, 220, 64, '$accent');
      const crawl = words(
        c,
        'Crawl',
        316,
        960,
        1508,
        64,
        '{{items}}',
        { size: 30, weight: 500 },
        { wrap: false, fit: 'none', scroll: { mode: 'crawl', speed: 140, gap: 120 } },
      );
      const strip = box(c, 'Strip', 316, 960, 1508, 64, '$box');
      strip.transform.opacity = still(94);
      wipe(labelBox, 'left', { at: 0, dur: 0.35 });
      wipe(strip, 'left', { at: 0.15, dur: 0.5 });
      fade(label, { at: 0.2, dur: 0.3 });
      fade(crawl, { at: 0.5, dur: 0.3 });
      for (const l of [crawl, label]) fade(l, { at: O, dur: 0.2 }, true);
      wipe(strip, 'right', { at: O + 0.1, dur: 0.4 }, true);
      wipe(labelBox, 'right', { at: O + 0.3, dur: 0.3 }, true);
      return [label, crawl, labelBox, strip];
    },
  },
  {
    name: 'Scoreboard bug',
    category: 'Scoreboards',
    description: 'Teams, scores, game clock and period, top left. Fills from a Lumora scoreboard.',
    out: 0.5,
    vars: [
      v('team_home', 'Home team', 'HOM', { bind: 'score:homeShort', group: 'Home' }),
      v('score_home', 'Home score', '2', { type: 'number', bind: 'score:home', group: 'Home' }),
      v('color_home', 'Home color', '#2f6fd6', { type: 'color', bind: 'score:homeColor', group: 'Home' }),
      v('team_away', 'Away team', 'AWY', { bind: 'score:awayShort', group: 'Away' }),
      v('score_away', 'Away score', '1', { type: 'number', bind: 'score:away', group: 'Away' }),
      v('color_away', 'Away color', '#d64541', { type: 'color', bind: 'score:awayColor', group: 'Away' }),
      v('clock', 'Clock', '38:12', { bind: 'score:clock', group: 'Game' }),
      v('period', 'Period', '2nd', { bind: 'score:period', group: 'Game' }),
    ],
    build(c, O) {
      const y = 70;
      const h = 56;
      const x = 96;
      const out: Layer[] = [];
      const backing = box(c, 'Backing', x, y, 560, h, '$box');
      const chipH = box(c, 'Home color', x, y, 8, h, '{{color_home}}');
      const teamH = words(c, 'Home team', x + 20, y, 110, h, '{{team_home}}', { size: 28, weight: 700 }, { wrap: false, fit: 'shrink' });
      const scoreH = words(c, 'Home score', x + 130, y, 60, h, '{{score_home}}', { size: 32, weight: 800, align: 'center' }, { wrap: false, fit: 'shrink' });
      const chipA = box(c, 'Away color', x + 200, y, 8, h, '{{color_away}}');
      const teamA = words(c, 'Away team', x + 220, y, 110, h, '{{team_away}}', { size: 28, weight: 700 }, { wrap: false, fit: 'shrink' });
      const scoreA = words(c, 'Away score', x + 330, y, 60, h, '{{score_away}}', { size: 32, weight: 800, align: 'center' }, { wrap: false, fit: 'shrink' });
      const clockBox = box(c, 'Clock box', x + 400, y, 160, h, '$boxAlt');
      const clock = words(c, 'Clock', x + 400, y, 100, h, '{{clock}}', { size: 26, weight: 600, align: 'center' }, { wrap: false, fit: 'shrink' });
      const period = words(
        c,
        'Period',
        x + 496,
        y,
        60,
        h,
        '{{period}}',
        { size: 20, weight: 500, align: 'center', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false, fit: 'shrink' },
      );
      wipe(backing, 'left', { at: 0, dur: 0.45 });
      wipe(clockBox, 'left', { at: 0.2, dur: 0.35 });
      grow(chipH, { at: 0.25, dur: 0.3 }, false, 'y');
      grow(chipA, { at: 0.3, dur: 0.3 }, false, 'y');
      for (const [i, l] of [teamH, scoreH, teamA, scoreA, clock, period].entries()) {
        fade(l, { at: 0.3 + i * 0.04, dur: 0.3 });
        fade(l, { at: O, dur: 0.2 }, true);
      }
      fade(chipH, { at: O, dur: 0.2 }, true);
      fade(chipA, { at: O, dur: 0.2 }, true);
      wipe(clockBox, 'right', { at: O + 0.05, dur: 0.3 }, true);
      wipe(backing, 'right', { at: O + 0.1, dur: 0.38 }, true);
      out.push(teamH, scoreH, teamA, scoreA, clock, period, chipH, chipA, clockBox, backing);
      return out;
    },
  },
  {
    name: 'Scoreboard bar',
    category: 'Scoreboards',
    description: 'Full team names and scores in a bar at the top center, clock and period below.',
    out: 0.5,
    vars: [
      v('team_home', 'Home team', 'Harbor City', { bind: 'score:homeName', group: 'Home' }),
      v('score_home', 'Home score', '3', { type: 'number', bind: 'score:home', group: 'Home' }),
      v('color_home', 'Home color', '#2f6fd6', { type: 'color', bind: 'score:homeColor', group: 'Home' }),
      v('team_away', 'Away team', 'Riverside', { bind: 'score:awayName', group: 'Away' }),
      v('score_away', 'Away score', '2', { type: 'number', bind: 'score:away', group: 'Away' }),
      v('color_away', 'Away color', '#d64541', { type: 'color', bind: 'score:awayColor', group: 'Away' }),
      v('clock', 'Clock', '72:05', { bind: 'score:clock', group: 'Game' }),
      v('period', 'Period', '2nd half', { bind: 'score:period', group: 'Game' }),
    ],
    build(c, O) {
      const y = 64;
      const backing = box(c, 'Backing', 560, y, 800, 72, '$box');
      const chipH = box(c, 'Home color', 560, y, 10, 72, '{{color_home}}');
      const chipA = box(c, 'Away color', 1350, y, 10, 72, '{{color_away}}');
      const teamH = words(
        c,
        'Home team',
        590,
        y,
        260,
        72,
        '{{team_home}}',
        { size: 32, weight: 700, align: 'right' },
        { wrap: false, fit: 'shrink', minSize: 18 },
      );
      const scoreBox = box(c, 'Score box', 870, y, 180, 72, '$boxAlt');
      const scoreH = words(c, 'Home score', 870, y, 80, 72, '{{score_home}}', { size: 40, weight: 800, align: 'center' }, { wrap: false, fit: 'shrink' });
      const dash = words(
        c,
        'Dash',
        945,
        y,
        30,
        72,
        '–',
        { size: 32, weight: 500, align: 'center', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      const scoreA = words(c, 'Away score', 970, y, 80, 72, '{{score_away}}', { size: 40, weight: 800, align: 'center' }, { wrap: false, fit: 'shrink' });
      const teamA = words(c, 'Away team', 1070, y, 260, 72, '{{team_away}}', { size: 32, weight: 700 }, { wrap: false, fit: 'shrink', minSize: 18 });
      const sub = words(
        c,
        'Clock and period',
        860,
        y + 72,
        200,
        40,
        '{{clock}}  {{period}}',
        { size: 22, weight: 600, align: 'center', fill: { type: 'solid', color: '$accentText' } },
        { wrap: false, fit: 'shrink' },
      );
      const subBox = box(c, 'Clock box', 860, y + 72, 200, 40, '$accent', { fitTo: { layer: sub.id, pad: [18, 0], min: [160, 0] } });
      backing.transform.anchor = still<Vec2>([400, 0]);
      backing.transform.position = still<Vec2>([960, y]);
      grow(backing, { at: 0, dur: 0.45 }, false, 'x');
      wipe(scoreBox, 'top', { at: 0.2, dur: 0.3 });
      wipe(subBox, 'top', { at: 0.4, dur: 0.3 });
      for (const [i, l] of [chipH, chipA, teamH, scoreH, dash, scoreA, teamA, sub].entries()) {
        fade(l, { at: 0.3 + i * 0.03, dur: 0.3 });
        fade(l, { at: O, dur: 0.2 }, true);
      }
      wipe(subBox, 'bottom', { at: O, dur: 0.2 }, true);
      wipe(scoreBox, 'bottom', { at: O + 0.1, dur: 0.2 }, true);
      grow(backing, { at: O + 0.15, dur: 0.35 }, true, 'x');
      return [sub, teamH, scoreH, dash, scoreA, teamA, chipH, chipA, subBox, scoreBox, backing];
    },
  },
  {
    name: 'Countdown card',
    category: 'Full screen',
    description: 'Starting soon, with the time left from Lumora’s countdown.',
    vars: [
      v('title', 'Title', 'We’ll be starting soon'),
      v('countdown', 'Time left', '04:59', { bind: 'countdown' }),
      v('subtitle', 'Line below', 'Annual Partner Summit'),
    ],
    build(c, O) {
      const bg = box(c, 'Background', 0, 0, 1920, 1080, '$box');
      const rule = box(c, 'Accent rule', 860, 560, 200, 6, '$accent');
      const title = words(c, 'Title', 260, 300, 1400, 120, '{{title}}', { size: 72, weight: 700, align: 'center' }, { wrap: true, maxLines: 2 });
      const time = words(c, 'Time left', 460, 400, 1000, 160, '{{countdown}}', { size: 140, weight: 700, align: 'center' }, { wrap: false });
      const subtitle = words(
        c,
        'Line below',
        260,
        600,
        1400,
        70,
        '{{subtitle}}',
        { size: 36, weight: 400, align: 'center', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      fade(bg, { at: 0, dur: 0.5 });
      rule.transform.anchor = still<Vec2>([100, 3]);
      rule.transform.position = still<Vec2>([960, 563]);
      grow(rule, { at: 0.3, dur: 0.5 }, false, 'x');
      for (const [i, t] of [title, time, subtitle].entries()) {
        fade(t, { at: 0.35 + i * 0.12, dur: 0.5 });
        slide(t, [0, 16], { at: 0.35 + i * 0.12, dur: 0.6 });
        fade(t, { at: O, dur: 0.3 }, true);
      }
      fade(rule, { at: O, dur: 0.3 }, true);
      fade(bg, { at: O + 0.2, dur: 0.4 }, true);
      return [title, time, subtitle, rule, bg];
    },
  },
  {
    name: 'Full-screen title',
    category: 'Full screen',
    description: 'A large title and a subtitle on a plain background.',
    vars: [v('title', 'Title', 'Opening session'), v('subtitle', 'Subtitle', 'Annual Partner Summit · Day one')],
    build(c, O) {
      const bg = box(c, 'Background', 0, 0, 1920, 1080, '$box');
      const title = words(c, 'Title', 192, 380, 1536, 200, '{{title}}', { size: 120, weight: 700, vAlign: 'bottom' }, { wrap: true, maxLines: 2, minSize: 60 });
      const rule = box(c, 'Accent rule', 192, 604, 160, 8, '$accent');
      const sub = words(
        c,
        'Subtitle',
        192,
        636,
        1536,
        70,
        '{{subtitle}}',
        { size: 40, weight: 400, vAlign: 'top', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      fade(bg, { at: 0, dur: 0.45 });
      wipe(rule, 'left', { at: 0.25, dur: 0.4 });
      reveal(title, 'char', { at: 0.3, dur: 0.6 }, 24);
      fade(sub, { at: 0.6, dur: 0.4 });
      slide(sub, [0, 12], { at: 0.6, dur: 0.5 });
      for (const l of [title, sub, rule]) fade(l, { at: O, dur: 0.3 }, true);
      fade(bg, { at: O + 0.2, dur: 0.4 }, true);
      return [title, sub, rule, bg];
    },
    inEnd: 1.2,
  },
  {
    name: 'Quote card',
    category: 'Full screen',
    description: 'A quote with who said it, set large on a plain background.',
    vars: [
      v('quote', 'Quote', 'The best events feel effortless to the audience because someone planned every minute.'),
      v('author', 'Who said it', 'Taylor Brooks, Event Director'),
    ],
    build(c, O) {
      const bg = box(c, 'Background', 0, 0, 1920, 1080, '$box');
      const bar = box(c, 'Accent bar', 192, 300, 10, 360, '$accent');
      const quote = words(
        c,
        'Quote',
        250,
        300,
        1400,
        360,
        '{{quote}}',
        { size: 64, weight: 500, lineHeight: 1.25, vAlign: 'top' },
        { wrap: true, fit: 'shrink', minSize: 36 },
      );
      const author = words(
        c,
        'Who said it',
        250,
        700,
        1400,
        60,
        '{{author}}',
        { size: 34, weight: 600, fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      fade(bg, { at: 0, dur: 0.45 });
      grow(bar, { at: 0.2, dur: 0.45 }, false, 'y');
      reveal(quote, 'line', { at: 0.35, dur: 0.6 }, 18);
      fade(author, { at: 0.8, dur: 0.4 });
      for (const l of [quote, author, bar]) fade(l, { at: O, dur: 0.3 }, true);
      fade(bg, { at: O + 0.2, dur: 0.4 }, true);
      return [quote, author, bar, bg];
    },
    inEnd: 1.3,
  },
  {
    name: 'Agenda',
    category: 'Full screen',
    description: 'A heading and a list of items, one a line, coming in one after another.',
    vars: [
      v('heading', 'Heading', 'Today'),
      v(
        'items',
        'Items',
        '9:00  Welcome and opening remarks\n10:30  Product keynote\n12:00  Lunch on the terrace\n1:30  Breakout workshops\n4:00  Closing panel',
        { type: 'list' },
      ),
    ],
    build(c, O) {
      const bg = box(c, 'Background', 0, 0, 1920, 1080, '$box');
      const heading = words(c, 'Heading', 192, 160, 1536, 110, '{{heading}}', { size: 80, weight: 700 }, { wrap: false });
      const rule = box(c, 'Accent rule', 192, 282, 120, 8, '$accent');
      const items = words(
        c,
        'Items',
        192,
        330,
        1536,
        600,
        '{{items}}',
        { size: 46, weight: 500, lineHeight: 1.6, vAlign: 'top' },
        { wrap: true, fit: 'shrink', minSize: 24 },
      );
      fade(bg, { at: 0, dur: 0.45 });
      fade(heading, { at: 0.2, dur: 0.4 });
      slide(heading, [0, 14], { at: 0.2, dur: 0.5 });
      wipe(rule, 'left', { at: 0.35, dur: 0.35 });
      reveal(items, 'line', { at: 0.45, dur: 0.9 }, 16);
      for (const l of [heading, rule, items]) fade(l, { at: O, dur: 0.3 }, true);
      fade(bg, { at: O + 0.2, dur: 0.4 }, true);
      return [heading, rule, items, bg];
    },
    inEnd: 1.5,
  },
  {
    name: 'End card',
    category: 'Full screen',
    description: 'Thank you, with where to find more.',
    vars: [v('title', 'Title', 'Thank you for joining us'), v('website', 'Website', 'lumora.live'), v('handle', 'Handle', '@lumora.live')],
    build(c, O) {
      const bg = box(c, 'Background', 0, 0, 1920, 1080, '$box');
      const title = words(c, 'Title', 192, 380, 1536, 140, '{{title}}', { size: 88, weight: 700, align: 'center' }, { wrap: true, maxLines: 2, minSize: 48 });
      const rule = box(c, 'Accent rule', 900, 548, 120, 6, '$accent');
      const site = words(c, 'Website', 192, 580, 1536, 64, '{{website}}', { size: 40, weight: 600, align: 'center' }, { wrap: false });
      const handle = words(
        c,
        'Handle',
        192,
        644,
        1536,
        56,
        '{{handle}}',
        { size: 32, weight: 400, align: 'center', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      fade(bg, { at: 0, dur: 0.5 });
      reveal(title, 'word', { at: 0.25, dur: 0.6 }, 20);
      grow(rule, { at: 0.5, dur: 0.4 }, false, 'x');
      rule.transform.anchor = still<Vec2>([60, 3]);
      rule.transform.position = still<Vec2>([960, 551]);
      for (const [i, t] of [site, handle].entries()) {
        fade(t, { at: 0.7 + i * 0.12, dur: 0.4 });
        fade(t, { at: O, dur: 0.3 }, true);
      }
      fade(title, { at: O, dur: 0.3 }, true);
      fade(rule, { at: O, dur: 0.3 }, true);
      fade(bg, { at: O + 0.2, dur: 0.4 }, true);
      return [title, site, handle, rule, bg];
    },
    inEnd: 1.3,
  },
  {
    name: 'Sponsor card',
    category: 'Cards',
    description: 'Presented by, with the sponsor’s logo, lower right.',
    vars: [v('label', 'Label', 'Presented by'), v('sponsor_logo', 'Sponsor logo', SAMPLE_LOGO, { type: 'image' })],
    build(c, O) {
      const panel = box(c, 'Box', 1384, 740, 440, 240, '$box');
      panel.transform.opacity = still(92);
      const rule = box(c, 'Accent rule', 1384, 740, 440, 6, '$accent');
      const label = words(
        c,
        'Label',
        1414,
        760,
        380,
        48,
        '{{label}}',
        { size: 26, weight: 500, align: 'center', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      const logo = newImage(c, '{{sponsor_logo}}', [320, 140], [1444, 816], 'Sponsor logo');
      wipe(rule, 'left', { at: 0, dur: 0.35 });
      wipe(panel, 'top', { at: 0.1, dur: 0.45 });
      fade(label, { at: 0.35, dur: 0.35 });
      fade(logo, { at: 0.45, dur: 0.45 });
      slide(logo, [0, 12], { at: 0.45, dur: 0.5 });
      for (const l of [label, logo]) fade(l, { at: O, dur: 0.25 }, true);
      wipe(panel, 'bottom', { at: O + 0.1, dur: 0.35 }, true);
      wipe(rule, 'right', { at: O + 0.3, dur: 0.3 }, true);
      return [label, logo, rule, panel];
    },
  },
  {
    name: 'Stat card',
    category: 'Cards',
    description: 'One big number and what it means, on the right of the screen.',
    vars: [v('value', 'Number', '12400', { type: 'number', suffix: '+' }), v('label', 'What it is', 'people watching from 40 countries')],
    build(c, O) {
      const panel = box(c, 'Box', 1180, 300, 560, 400, '$box');
      const bar = box(c, 'Accent bar', 1180, 300, 8, 400, '$accent');
      const value = words(c, 'Number', 1228, 340, 480, 170, '{{value}}', { size: 130, weight: 800 }, { wrap: false, fit: 'shrink', minSize: 50 });
      const label = words(
        c,
        'What it is',
        1228,
        520,
        480,
        150,
        '{{label}}',
        { size: 38, weight: 500, vAlign: 'top', fill: { type: 'solid', color: '$textSub' } },
        { wrap: true, fit: 'shrink', minSize: 22 },
      );
      grow(bar, { at: 0, dur: 0.35 }, false, 'y');
      wipe(panel, 'left', { at: 0.1, dur: 0.45 });
      fade(value, { at: 0.35, dur: 0.4 });
      slide(value, [0, 20], { at: 0.35, dur: 0.55 });
      reveal(label, 'word', { at: 0.5, dur: 0.5 }, 8);
      for (const l of [value, label]) fade(l, { at: O, dur: 0.25 }, true);
      wipe(panel, 'right', { at: O + 0.1, dur: 0.38 }, true);
      fade(bar, { at: O + 0.35, dur: 0.25 }, true);
      return [value, label, bar, panel];
    },
  },
  {
    name: 'Location and date',
    category: 'Cards',
    description: 'Where and when, top left: two short lines in a box.',
    vars: [v('place', 'Place', 'Pier 27, San Francisco'), v('date', 'Date', 'Thursday, October 8')],
    build(c, O) {
      const place = words(c, 'Place', 132, 80, 900, 52, '{{place}}', { size: 32, weight: 700 }, { wrap: false });
      const date = words(
        c,
        'Date',
        132,
        132,
        900,
        40,
        '{{date}}',
        { size: 24, weight: 400, vAlign: 'top', fill: { type: 'solid', color: '$textSub' } },
        { wrap: false },
      );
      const panel = box(c, 'Box', 96, 64, 500, 124, '$box', { fitTo: { layer: place.id, pad: [36, 0], min: [320, 0] } });
      const bar = box(c, 'Accent bar', 96, 64, 6, 124, '$accent');
      lowerThirdMotion(bar, [panel], [place, date], O);
      return [place, date, bar, panel];
    },
  },
  {
    name: 'Call to action',
    category: 'Cards',
    description: 'A short message with a web address in the accent color, low center.',
    vars: [v('message', 'Message', 'Ask the panel a question'), v('link', 'Link', 'lumora.live/ask')],
    build(c, O) {
      const msg = words(c, 'Message', 360, 836, 1200, 64, '{{message}}', { size: 40, weight: 600, align: 'center' }, { wrap: false });
      const link = words(
        c,
        'Link',
        360,
        900,
        1200,
        52,
        '{{link}}',
        { size: 32, weight: 700, align: 'center', fill: { type: 'solid', color: '$accent' } },
        { wrap: false },
      );
      const panel = box(c, 'Box', 360, 820, 1200, 148, '$box', { fitTo: { layer: msg.id, pad: [56, 0], min: [560, 0] } });
      panel.transform.anchor = still<Vec2>([600, 74]);
      panel.transform.position = still<Vec2>([960, 894]);
      grow(panel, { at: 0, dur: 0.45 }, false, 'x');
      fade(panel, { at: 0, dur: 0.15 });
      for (const [i, t] of [msg, link].entries()) {
        fade(t, { at: 0.3 + i * 0.12, dur: 0.4 });
        slide(t, [0, 10], { at: 0.3 + i * 0.12, dur: 0.45 });
        fade(t, { at: O, dur: 0.22 }, true);
      }
      grow(panel, { at: O + 0.15, dur: 0.35 }, true, 'x');
      return [msg, link, panel];
    },
  },
];

let cached: TitleProject[] | null = null;

/** Every starter template (made once). */
export function starterTemplates(): TitleProject[] {
  cached ??= SPECS.map(make);
  return cached;
}

/** A fresh copy of a template to edit (its own id). */
export function fromTemplate(t: TitleProject): TitleProject {
  const copy = JSON.parse(JSON.stringify(t)) as TitleProject;
  copy.id = uid('p');
  delete copy.modified;
  return copy;
}
