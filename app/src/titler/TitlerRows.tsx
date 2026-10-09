// The rows of a Titler graphic's own data (its CSV, Google Sheet or JSON
// address): back, next, or any row by name, while it is on air.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TitleProject } from '../../../titler/src/core/types';
import type { Action } from '../engine/types/Action';
import type { Source } from '../engine/types/Source';
import { rowLabel, titlerLastRow } from './titlerData';

export function TitlerRows({ source, project, act }: { source: Source; project: TitleProject; act: (a: Action) => void }) {
  if (source.kind.type !== 'titler' || !project.data?.some((d) => d.url.trim())) return null;
  const k = source.kind;
  const rows = k.data.some((t) => t.rows.length) ? titlerLastRow(k) + 1 : 0;
  const row = k.dataRow ?? project.data[0]?.row ?? 0;
  const problem = k.data.find((t) => t.error)?.error;
  const go = (r: number | null) => act({ type: 'titlerDataRow', id: source.id, row: r });
  return (
    <div className="tt-cp-rows" role="group" aria-label="Data row">
      <button
        type="button"
        className="btn btn--small"
        disabled={!rows || row <= 0}
        onClick={() => act({ type: 'titlerDataStep', id: source.id, delta: -1 })}
        aria-label="Previous row"
        title="Previous row (Shift+[)"
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <select className="text" aria-label="Row shown" value={rows ? Math.min(row, rows - 1) : ''} disabled={!rows} onChange={(e) => go(Number(e.target.value))}>
        {!rows && <option value="">{problem ? 'Could not be read' : 'Reading…'}</option>}
        {Array.from({ length: Math.min(rows, 1000) }, (_, i) => (
          <option key={i} value={i}>
            {rowLabel(k, i)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn--small"
        disabled={!rows || row >= rows - 1}
        onClick={() => act({ type: 'titlerDataStep', id: source.id, delta: 1 })}
        aria-label="Next row"
        title="Next row (Shift+])"
      >
        <ChevronRight aria-hidden="true" />
      </button>
      {problem && <span className="tt-cp-problem">{problem}</span>}
    </div>
  );
}

/** The control panel's data props for a graphic: what its data fills, what was typed over, and the way back. */
export function dataPanelProps(source: Source, fromData: Record<string, string>, act: (a: Action) => void) {
  if (source.kind.type !== 'titler') return {};
  const k = source.kind;
  return {
    fromData,
    typed: k.values.map((v) => v.key),
    onUseData: (key: string) => act({ type: 'updateTitler', id: source.id, titler: { ...k, values: k.values.filter((v) => v.key !== key) } }),
  };
}
