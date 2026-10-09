// A Titler graphic's fields on their own (a graphics operator's seat): the
// control panel made from its template, changes sent as they are typed.

import { useEffect, useState } from 'react';
import { ControlPanel } from '../../../titler/src/designer/ControlPanel';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { projectOf, valuesOf } from './titlerSource';
import { dataPanelProps, TitlerRows } from './TitlerRows';

export function TitlerFields({ source, show, act }: { source: Source; show: Show; act: (a: Action) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (source.kind.type !== 'titler') return null;
  const k = source.kind;
  const p = projectOf(k);
  if (!p) return null;
  const { values, bound, fromData } = valuesOf(p, k, show, now);
  return (
    <div className="seat-item seat-item--titler" aria-label={source.name}>
      <span className="seat-item__name">{source.name}</span>
      <TitlerRows source={source} project={p} act={act} />
      <ControlPanel
        project={p}
        values={values}
        bound={bound}
        {...dataPanelProps(source, fromData, act)}
        onChange={(key, value) => act({ type: 'setTitlerValues', id: source.id, values: [{ key, value }] })}
      />
    </div>
  );
}
