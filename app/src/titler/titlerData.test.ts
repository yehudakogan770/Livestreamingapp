// A Titler graphic's own data source on air: read by the control window
// (again as often as the designer set), the row chosen by the operator
// (buttons, Shift+[ / ]), and merged with what the operator typed and with
// Lumora's own bindings: sample < the title's data < typed < Lumora bindings.

import { describe, expect, it } from 'vitest';
import { demoApply } from '../engine/demo';
import { emptyShow } from '../engine/client';
import { overlayActions } from '../engine/overlays';
import { defaultScoreboard } from '../engine/score';
import type { Show } from '../engine/types/Show';
import { fromTemplate, starterTemplates } from '../../../titler/src/core/templates';
import type { TitleProject } from '../../../titler/src/core/types';
import { projectOf, titlerKind, valuesOf } from './titlerSource';
import { dataValuesOf, rowLabel, TitlerDataReader } from './titlerData';

const CSV = 'name,role,score_home\nJordan Lee,Host,1\nSam Rivera,Guest,2\nAlex Kim,Coach,3\n';

function scoreTitle(): TitleProject {
  const p = fromTemplate(starterTemplates().find((t) => t.name === 'Scoreboard bug')!);
  p.data = [{ id: 'd1', name: 'Roster', kind: 'csv', url: 'https://example.com/roster.csv', refresh: 10, row: 0, map: { team_home: 'name' } }];
  return p;
}

function withTitle(p: TitleProject): { show: Show; id: string } {
  let s = emptyShow();
  s = demoApply(s, { type: 'addSource', source: { id: 'g', name: 'Bug', kind: titlerKind(p) } }, 0);
  return { show: s, id: 'g' };
}

const kindOf = (s: Show, id: string) => {
  const k = s.sources.find((x) => x.id === id)!.kind;
  if (k.type !== 'titler') throw new Error('not a titler');
  return k;
};

async function read(show: Show, now: number, text = CSV) {
  const sent: { id: string; data: unknown }[] = [];
  const reads: string[] = [];
  const r = new TitlerDataReader(
    async (id, data) => void sent.push({ id, data }),
    async (url) => (reads.push(url), text),
  );
  await Promise.all(r.tick(show, now));
  return { r, sent, reads };
}

describe("a Titler graphic's own data on air", () => {
  it('is read by the control window and sent with the graphic; read again only when due', async () => {
    const { show, id } = withTitle(scoreTitle());
    const { r, sent, reads } = await read(show, 1000);
    expect(reads).toEqual(['https://example.com/roster.csv']);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toEqual([{ source: 'd1', headers: ['name', 'role', 'score_home'], rows: expect.any(Array), error: '' }]);
    // Not yet due (every 10 s): nothing read.
    await Promise.all(r.tick(show, 5000));
    expect(reads).toHaveLength(1);
    // Due, same contents: read, nothing new sent.
    await Promise.all(r.tick(show, 11_500));
    expect(reads).toHaveLength(2);
    expect(sent).toHaveLength(1);
    void id;
  });

  it('a source that fails keeps its last rows and says why', async () => {
    const { show } = withTitle(scoreTitle());
    const sent: { data: { error: string; rows: string[][] }[] }[] = [];
    let fail = false;
    const r = new TitlerDataReader(
      async (_id, data) => void sent.push({ data: data as never }),
      async () => (fail ? Promise.reject(new Error('The address answered 404')) : CSV),
    );
    await Promise.all(r.tick(show, 0));
    fail = true;
    await Promise.all(r.tick(show, 60_000));
    expect(sent[1]!.data[0]!.error).toBe('The address answered 404');
    expect(sent[1]!.data[0]!.rows).toHaveLength(3);
  });

  it('the row is chosen and stepped (on-air graphics with Shift+[ / ]), within the rows there are', async () => {
    let { show, id } = withTitle(scoreTitle());
    const { sent } = await read(show, 0);
    show = demoApply(show, { type: 'setTitlerData', id, data: sent[0]!.data as never }, 0);
    const p = projectOf(kindOf(show, id))!;
    expect(dataValuesOf(p, kindOf(show, id))).toMatchObject({ team_home: 'Jordan Lee', score_home: '1' });
    show = demoApply(show, { type: 'titlerDataStep', delta: 1 }, 0);
    expect(kindOf(show, id).dataRow).toBe(1);
    expect(dataValuesOf(p, kindOf(show, id)).team_home).toBe('Sam Rivera');
    show = demoApply(show, { type: 'titlerDataRow', id, row: 99 }, 0);
    expect(kindOf(show, id).dataRow).toBe(2);
    show = demoApply(show, { type: 'titlerDataStep', id, delta: 1 }, 0);
    expect(kindOf(show, id).dataRow).toBe(2);
    expect(rowLabel(kindOf(show, id), 2)).toBe('3. Alex Kim');
    // With two graphics, the step goes to the one on air.
    show = demoApply(show, { type: 'addSource', source: { id: 'g2', name: 'Other', kind: titlerKind(scoreTitle()) } }, 0);
    show = demoApply(show, { type: 'setTitlerData', id: 'g2', data: sent[0]!.data as never }, 0);
    for (const a of overlayActions(show, 'g2', 'live', true)) show = demoApply(show, a, 0);
    show = demoApply(show, { type: 'titlerDataStep', delta: 1 }, 0);
    expect(kindOf(show, 'g2').dataRow).toBe(1);
    expect(kindOf(show, id).dataRow).toBe(2);
  });

  it('what a field shows: sample < the title’s data < what the operator typed < Lumora’s bindings', async () => {
    let { show, id } = withTitle(scoreTitle());
    const { sent } = await read(show, 0);
    show = demoApply(show, { type: 'setTitlerData', id, data: sent[0]!.data as never }, 0);
    const p = projectOf(kindOf(show, id))!;
    // The data fills team_home (mapped) and score_home (same name).
    let v = valuesOf(p, kindOf(show, id), show, 0);
    expect(v.values.team_home).toBe('Jordan Lee');
    expect(v.fromData.team_home).toBe('Jordan Lee');
    // Typed over: the operator's words win over the data.
    show = demoApply(show, { type: 'setTitlerValues', id, values: [{ key: 'team_home', value: 'NYC' }] }, 0);
    v = valuesOf(p, kindOf(show, id), show, 0);
    expect(v.values.team_home).toBe('NYC');
    // Giving a field back to the data.
    const k0 = kindOf(show, id);
    show = demoApply(show, { type: 'updateTitler', id, titler: { ...k0, values: k0.values.filter((x) => x.key !== 'team_home') } }, 0);
    expect(valuesOf(p, kindOf(show, id), show, 0).values.team_home).toBe('Jordan Lee');
    // A field bound to Lumora's scoreboard wins over both.
    show = demoApply(show, { type: 'addSource', source: { id: 'sb', name: 'Score', kind: { type: 'scoreboard', ...defaultScoreboard() } } }, 0);
    show = demoApply(show, { type: 'score', id: 'sb', side: 'home', delta: 7 }, 0);
    v = valuesOf(p, kindOf(show, id), show, 0);
    expect(p.variables.find((x) => x.key === 'score_home')!.bind).toBe('score:home');
    expect(v.values.score_home).toBe('7');
    expect(v.bound.team_home).toBe('HOM');
  });
});
