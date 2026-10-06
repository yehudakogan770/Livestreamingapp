import { useEffect, useRef, useState } from 'react';
import { updateTrack } from '../model/edit';
import { current } from '../model/seq';
import type { TrackRole } from '../model/types';
import { useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { Scrub } from './controls';

/** One fader and meter for each sound track, and one for everything. */
export function Mixer({ doc, engine }: { doc: Doc; engine: Engine }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const tracks = s.tracks.filter((t) => t.kind === 'audio');
  const [master, setMaster] = useState(0);
  return (
    <div className="emix">
      {tracks.map((t) => (
        <div key={t.id} className={`estrip${t.off ? ' is-muted' : ''}${t.solo ? ' is-solo' : ''}`}>
          <span className="estrip__name" title={t.name}>
            {t.name}
          </span>
          <select
            className="estrip__role"
            value={t.role ?? ''}
            aria-label={`${t.name}: what it carries`}
            title="Speech tracks make Music tracks turn down while someone talks"
            onChange={(e) => doc.edit((p) => updateTrack(p, t.id, { role: (e.target.value || undefined) as TrackRole | undefined }), 'Track role')}
          >
            <option value="">—</option>
            <option value="dialogue">Speech</option>
            <option value="music">Music</option>
          </select>
          <div className="estrip__pan">
            <span>Pan</span>
            <Scrub
              value={Math.round(t.pan * 100)}
              min={-100}
              max={100}
              step={1}
              label={`${t.name} pan`}
              onChange={(v, final) => doc.edit((p) => updateTrack(p, t.id, { pan: v / 100 }), 'Pan', final ? undefined : `pan-${t.id}`)}
            />
          </div>
          <div className="estrip__body">
            <Meter engine={engine} id={t.id} />
            <input
              className="estrip__fader"
              type="range"
              min={-60}
              max={12}
              step={0.5}
              value={t.volume}
              aria-label={`${t.name} volume`}
              onChange={(e) => doc.edit((p) => updateTrack(p, t.id, { volume: Number(e.target.value) }), 'Track volume', `vol-${t.id}`)}
              onDoubleClick={() => doc.edit((p) => updateTrack(p, t.id, { volume: 0 }), 'Track volume')}
            />
          </div>
          <span className="estrip__db">{t.volume > -60 ? `${t.volume > 0 ? '+' : ''}${t.volume.toFixed(1)} dB` : '−∞'}</span>
          <div className="estrip__btns">
            <button
              type="button"
              className={`th__btn th__btn--m${t.off ? ' is-on' : ''}`}
              aria-pressed={t.off}
              title="Mute"
              onClick={() => doc.edit((p) => updateTrack(p, t.id, { off: !t.off }), 'Mute')}
            >
              M
            </button>
            <button
              type="button"
              className={`th__btn th__btn--s${t.solo ? ' is-on' : ''}`}
              aria-pressed={t.solo}
              title="Solo"
              onClick={() => doc.edit((p) => updateTrack(p, t.id, { solo: !t.solo }), 'Solo')}
            >
              S
            </button>
          </div>
        </div>
      ))}
      <div className="estrip estrip--master">
        <span className="estrip__name">Everything</span>
        <div className="estrip__pan" />
        <div className="estrip__body">
          <Meter engine={engine} id="master" stereo />
          <input
            className="estrip__fader"
            type="range"
            min={-60}
            max={12}
            step={0.5}
            value={master}
            aria-label="Overall volume (while editing)"
            title="How loud it plays while editing (the film is not changed)"
            onChange={(e) => {
              const v = Number(e.target.value);
              setMaster(v);
              engine.setMaster(v);
            }}
          />
        </div>
        <span className="estrip__db">{master.toFixed(1)} dB</span>
        <span className="estrip__hint">Listening only</span>
      </div>
    </div>
  );
}

function Meter({ engine, id, stereo }: { engine: Engine; id: string; stereo?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const shown = [-90, -90];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const h = cv.clientHeight;
      if (cv.height !== h) cv.height = h;
      const lv = engine.levels()[id] ?? [-90, -90];
      ctx.clearRect(0, 0, cv.width, h);
      const n = stereo ? 2 : 1;
      for (let i = 0; i < n; i++) {
        shown[i] = Math.max(lv[i] ?? -90, (shown[i] ?? -90) - 1.2);
        const top = h - (Math.max(0, (shown[i] ?? -90) + 60) / 66) * h;
        const x = i * 8;
        ctx.fillStyle = '#1c1c1e';
        ctx.fillRect(x, 0, 6, h);
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, '#2f8f4e');
        grad.addColorStop(0.75, '#c9b23a');
        grad.addColorStop(0.92, '#d2453a');
        ctx.fillStyle = grad;
        ctx.fillRect(x, top, 6, h - top);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine, id, stereo]);
  return <canvas ref={ref} className="estrip__meter" width={stereo ? 14 : 6} />;
}
