// The Templates section: motion title templates to click (added at the
// playhead) or drag onto the timeline, your own saved titles, and the extra
// title settings in the Inspector (bar, rounded box, second-line color…).
import { useEffect, useState } from 'react';
import { DEFAULT_TEXT, type Clip, type TextData } from '../model/types';
import { onSavedTemplates, saveTemplates, savedTemplates, templateFromClip, TITLE_TEMPLATES, type TitleTemplate } from '../model/templates';
import type { Actions } from './actions';
import { ColorField } from './controls';

function useSaved(): TitleTemplate[] {
  const [list, setList] = useState(savedTemplates);
  useEffect(() => onSavedTemplates(() => setList(savedTemplates())), []);
  return list;
}

/** A small picture of what a template looks like. */
function Look({ t }: { t: TitleTemplate }) {
  const d: TextData = { ...DEFAULT_TEXT, ...t.text };
  const words = (d.text.split('\n')[0] ?? '').replace('{count}', '3').replace('{clock}', '0:30');
  return (
    <span
      className="ttpl__look"
      style={{
        justifyContent: d.align === 'left' ? 'flex-start' : d.align === 'right' ? 'flex-end' : 'center',
        alignItems: d.py > 0.7 ? 'flex-end' : d.py < 0.3 ? 'flex-start' : 'center',
      }}
    >
      <b
        style={{
          fontFamily: `"${d.font}", system-ui, sans-serif`,
          fontWeight: d.weight,
          fontStyle: d.italic ? 'italic' : undefined,
          color: d.color,
          textTransform: d.caps ? 'uppercase' : undefined,
          background: d.box ? d.boxColor : undefined,
          borderRadius: d.boxRadius ? Math.min(8, d.boxRadius / 4) : undefined,
          borderLeft: d.accent && (d.accentSide ?? 'left') === 'left' ? `3px solid ${d.accent}` : undefined,
          borderBottom: d.accent && d.accentSide === 'bottom' ? `2px solid ${d.accent}` : undefined,
          borderTop: d.accent && d.accentSide === 'top' ? `2px solid ${d.accent}` : undefined,
          borderRight: d.accent && d.accentSide === 'right' ? `3px solid ${d.accent}` : undefined,
          WebkitTextStroke: d.stroke ? `1px ${d.strokeColor}` : undefined,
        }}
      >
        {words}
      </b>
    </span>
  );
}

/** Every template, by group: click to add at the playhead, or drag onto the timeline. */
export function TemplatesSection({ actions }: { actions: Actions }) {
  const mine = useSaved();
  const all = [...TITLE_TEMPLATES, ...mine];
  const groups = [...new Set(all.map((t) => t.group))];
  return (
    <div className="fxlist__group ttpl">
      <h3>Templates</h3>
      <p className="fxlist__hint">Click to add at the playhead, or drag onto a track. Change the words, colors and fonts in the Inspector.</p>
      {groups.map((g) => (
        <div key={g} className="ttpl__group">
          <h4>{g}</h4>
          <div className="ttpl__grid">
            {all
              .filter((t) => t.group === g)
              .map((t) => (
                <div key={t.id} className="ttpl__item">
                  <button
                    type="button"
                    className="ttpl__btn"
                    draggable
                    title={`${t.name} (${t.seconds} s)`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-lumora-template', t.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => actions.addTemplate(t.id)}
                  >
                    <Look t={t} />
                    <span className="ttpl__name">{t.name}</span>
                  </button>
                  {t.group === 'My templates' && (
                    <button
                      type="button"
                      className="ttpl__del"
                      title={`Delete ${t.name}`}
                      aria-label={`Delete ${t.name}`}
                      onClick={() => saveTemplates(savedTemplates().filter((x) => x.id !== t.id))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** More title settings (bar, rounded box, second-line color, capitals) and saving a title as a template. */
export function TitleExtras({ clip, fps, onChange }: { clip: Clip; fps: number; onChange: (t: TextData, final: boolean) => void }) {
  const [saved, setSaved] = useState('');
  if (clip.source.kind !== 'text') return null;
  const data = clip.source.text;
  const set = (change: Partial<TextData>, final = true) => onChange({ ...data, ...change }, final);
  return (
    <div className="insp__extras">
      <div className="insp__row">
        <label className="check">
          <input type="checkbox" checked={!!data.accent} onChange={(e) => set({ accent: e.target.checked ? '#e5a823' : undefined })} /> Bar
        </label>
        {data.accent && (
          <>
            <ColorField value={data.accent} label="Bar color" onChange={(accent) => set({ accent }, false)} />
            <select
              className="text text--sm"
              value={data.accentSide ?? 'left'}
              aria-label="Bar side"
              onChange={(e) => set({ accentSide: e.target.value as TextData['accentSide'] })}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="top">Top</option>
              <option value="bottom">Under</option>
            </select>
            <input
              className="text text--sm insp__num"
              type="number"
              min={1}
              max={60}
              aria-label="Bar thickness"
              value={data.accentSize ?? 8}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => set({ accentSize: Math.max(1, Math.min(60, Number(e.target.value) || 8)) })}
            />
          </>
        )}
      </div>
      <div className="insp__row">
        <span className="field__label">Second line</span>
        <ColorField value={data.color2 ?? data.color} label="Second line color" onChange={(color2) => set({ color2 }, false)} />
        {data.box && (
          <>
            <span className="field__label">Corners</span>
            <input
              className="text text--sm insp__num"
              type="number"
              min={0}
              max={200}
              aria-label="Box corner roundness"
              value={data.boxRadius ?? 0}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => set({ boxRadius: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
            />
          </>
        )}
      </div>
      <div className="insp__row">
        <label className="check">
          <input type="checkbox" checked={!!data.caps} onChange={(e) => set({ caps: e.target.checked })} /> Capitals
        </label>
        <label className="check" title="The box and bar grow in with the words">
          <input type="checkbox" checked={!!data.boxGrow} onChange={(e) => set({ boxGrow: e.target.checked })} /> Box grows in
        </label>
      </div>
      <p className="insp__note">
        Live words: {'{count}'} shows the seconds left, {'{clock}'} the minutes and seconds left.
      </p>
      <div className="insp__row">
        <button
          type="button"
          className="btn btn--sm"
          title="Keep this title (words, look and motion) in Templates, for any project"
          onClick={() => {
            const name = window.prompt('Name the template', clip.name) ?? '';
            if (!name.trim()) return;
            const t = templateFromClip(clip, name, fps);
            if (!t) return;
            saveTemplates([...savedTemplates(), t]);
            setSaved(`Saved “${t.name}” in Templates`);
          }}
        >
          Save as template
        </button>
        {saved && <span className="insp__note">{saved}</span>}
      </div>
    </div>
  );
}
