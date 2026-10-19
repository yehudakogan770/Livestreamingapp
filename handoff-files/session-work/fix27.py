import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/templates.ts'
GAME = """  {
    name: 'Game clock',
    category: 'Scoreboards',
    description: 'A running game clock and the period, top center. Runs by itself, also in exported templates; start and stop it from the control panel.',
    out: 0.5,
    vars: [
      v('clock', 'Clock', '0:00', { type: 'timer', timer: { dir: 'up', format: 'm:ss' }, bind: undefined, group: 'Clock' }),
      v('period', 'Period', '1st', { options: ['1st', '2nd', 'HT', 'ET', 'FT'], group: 'Clock' }),
      v('added', 'Added time', '', { group: 'Clock' }),
    ],
    build(c, O) {
      const y = 64;
      const h = 60;
      const clockBox = box(c, 'Clock box', 860, y, 150, h, '$box');
      const periodBox = box(c, 'Period box', 1010, y, 74, h, '$accent');
      const clock = words(
        c,
        'Clock',
        860,
        y,
        150,
        h,
        '{{clock}}',
        { size: 38, weight: 700, align: 'center', figures: 'tabular' },
        { wrap: false, fit: 'shrink', minSize: 20 },
      );
      const period = words(
        c,
        'Period',
        1010,
        y,
        74,
        h,
        '{{period}}',
        { size: 24, weight: 700, align: 'center', fill: { type: 'solid', color: '$accentText' } },
        { wrap: false, fit: 'shrink', minSize: 12 },
      );
      const added = words(
        c,
        'Added time',
        860,
        y + h,
        150,
        34,
        '{{added}}',
        { size: 22, weight: 700, align: 'center', fill: { type: 'solid', color: '$accent' } },
        { wrap: false },
      );
      for (const [i, l] of [clockBox, periodBox].entries()) {
        grow(l, { at: i * 0.08, dur: 0.35 }, false, 'x');
        fade(l, { at: O + 0.15, dur: 0.3 }, true);
      }
      for (const l of [clock, period, added]) {
        fade(l, { at: 0.25, dur: 0.3 });
        fade(l, { at: O, dur: 0.2 }, true);
      }
      return [clock, period, added, clockBox, periodBox];
    },
  },
"""
RESULTS = """  {
    name: 'Results table',
    category: 'Full screen',
    description: 'Results, standings or a schedule: a table filled from a spreadsheet (each column a list field), rows coming in one after another.',
    vars: [
      v('title', 'Title', 'Results'),
      v('subtitle', 'Line below', 'District 4, 92% of votes counted'),
      v('names', 'Names', 'Avery Chen\\nJordan Ruiz\\nSam Patel\\nMorgan Lee\\nRiley Brooks', { type: 'list', group: 'Table' }),
      v('groups', 'Second column', 'Harbor Party\\nCivic Alliance\\nIndependent\\nGreen Union\\nIndependent', { type: 'list', group: 'Table' }),
      v('counts', 'Numbers', '48,210\\n41,977\\n12,404\\n6,880\\n2,115', { type: 'list', group: 'Table' }),
      v('shares', 'Shares', '43.1%\\n37.5%\\n11.1%\\n6.2%\\n1.9%', { type: 'list', group: 'Table' }),
    ],
    build(c, O) {
      const bg = box(c, 'Background', 0, 0, 1920, 1080, '$box');
      const title = words(c, 'Title', 192, 120, 1536, 100, '{{title}}', { size: 72, weight: 700 }, { wrap: false });
      const sub = words(c, 'Line below', 192, 222, 1536, 56, '{{subtitle}}', { size: 32, weight: 500, fill: { type: 'solid', color: '$textSub' } }, { wrap: false });
      const rule = box(c, 'Accent rule', 192, 300, 120, 8, '$accent');
      const rowH = 104;
      const top = 352;
      const rows = 6;
      const stripes: ShapeLayer[] = [];
      for (let i = 0; i < rows; i += 2) stripes.push(box(c, `Row ${i + 1}`, 192, top + i * rowH, 1536, rowH, '$boxAlt'));
      const col = (name: string, key: string, x: number, w: number, extra: Partial<TextStyle>) =>
        words(c, name, x, top, w, rowH * rows, `{{${key}}}`, { size: 44, weight: 500, lineHeight: rowH / 44, vAlign: 'top', ...extra }, { wrap: false, fit: 'none' });
      const names = col('Names', 'names', 232, 640, { weight: 700 });
      const groups = col('Second column', 'groups', 892, 420, { fill: { type: 'solid', color: '$textSub' } });
      const counts = col('Numbers', 'counts', 1312, 220, { align: 'right', figures: 'tabular' });
      const shares = col('Shares', 'shares', 1548, 140, { align: 'right', weight: 700, figures: 'tabular', fill: { type: 'solid', color: '$accent' } });
      fade(bg, { at: 0, dur: 0.45 });
      fade(title, { at: 0.2, dur: 0.4 });
      slide(title, [0, 14], { at: 0.2, dur: 0.5 });
      fade(sub, { at: 0.3, dur: 0.4 });
      wipe(rule, 'left', { at: 0.35, dur: 0.35 });
      stripes.forEach((s, i) => wipe(s, 'left', { at: 0.4 + i * 0.08, dur: 0.4 }));
      for (const t of [names, groups, counts, shares]) reveal(t, 'line', { at: 0.5, dur: 0.9 }, 16);
      for (const l of [title, sub, rule, names, groups, counts, shares, ...stripes]) fade(l, { at: O, dur: 0.3 }, true);
      fade(bg, { at: O + 0.2, dur: 0.4 }, true);
      return [title, sub, rule, names, groups, counts, shares, ...stripes, bg];
    },
    inEnd: 1.6,
  },
"""
rep(p,"""  {
    name: 'Countdown card',""", GAME + """  {
    name: 'Countdown card',""")
rep(p,"""  {
    name: 'End card',""", RESULTS + """  {
    name: 'End card',""")
rep(p,"""      v('countdown', 'Time left', '04:59', { bind: 'countdown' }),""","""      v('countdown', 'Time left', '05:00', { type: 'timer', timer: { dir: 'down', format: 'mm:ss' }, bind: 'countdown' }),""")
rep(p,"""      v('clock', 'Clock', '38:12', { bind: 'score:clock', group: 'Game' }),""","""      v('clock', 'Clock', '38:12', { type: 'timer', timer: { dir: 'up', format: 'm:ss' }, bind: 'score:clock', group: 'Game' }),""")
