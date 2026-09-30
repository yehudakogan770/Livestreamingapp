import { useEffect, useState } from 'react';
import type { Credits } from '../engine/types/Credits';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { creditsPage, parseNames } from '../engine/credits';
import { TEXT_FONTS } from '../engine/text';
import { useNow } from '../engine/useNow';
import { CreditsView } from '../components/CreditsView';
import type { Act } from './act';
import './PesukimCard.css';
import './CreditsCard.css';
import './TextEditor.css';

/** The credits input on air (or in Next) on this screen. */
export function creditsTarget(show: Show, screen: ScreenId): { id: string; where: 'onAir' | 'next'; c: Credits } | null {
  if (screen === 'monitor') return null;
  const sc = show.screens[screen];
  // What is in Next first: its controls come up as soon as it is lined up.
  for (const [id, where] of [
    [sc.preview, sc.preview === sc.program ? 'onAir' : 'next'],
    [sc.program, 'onAir'],
  ] as const) {
    const k = show.sources.find((s) => s.id === id)?.kind;
    if (id && k?.type === 'credits') return { id, where, c: k };
  }
  return null;
}

/** Credits, run live: play / pause, back to the top, faster / slower, and the names. */
export function CreditsCard({ show, act, screen }: { show: Show; act: Act; screen: ScreenId }) {
  const target = creditsTarget(show, screen);
  const now = useNow(false, 500);
  const [editing, setEditing] = useState(false);
  if (!target) return null;
  const { id, c, where } = target;
  const pages = c.mode === 'pages' ? creditsPage(c, now) : null;
  return (
    <div className="pk" aria-label="Credits">
      <div className="pk__head">
        <b className={`cd__tag cd__tag--${where}`}>{where === 'next' ? 'NEXT' : 'ON AIR'}</b>
        <span className="pk__where">
          Credits · {c.names.length} names
          <em>
            {' '}
            · {c.mode === 'roll' ? 'rolling' : c.mode === 'pages' ? `page ${pages!.page + 1} of ${pages!.pages}` : 'wall'}
            {c.playing ? '' : ' (paused)'}
          </em>
        </span>
        <button type="button" className="btn pk__edit" onClick={() => setEditing(true)}>
          Edit…
        </button>
      </div>
      {where === 'next' && <p className="field__note">Starts from the top when you TAKE it.</p>}
      <div className="pk__row pk__row--main">
        <button type="button" className="btn" onClick={() => act({ type: 'creditsRestart', id })} title="Back to the top">
          ⏮ Top
        </button>
        <button type="button" className={`btn ${c.playing ? '' : 'btn--primary'} pk__go`} onClick={() => act({ type: 'creditsPlay', id, value: !c.playing })}>
          {c.playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      </div>
      {c.mode === 'roll' && (
        <div className="pk__row crc__speed">
          <button type="button" className="btn" onClick={() => act({ type: 'creditsSpeed', id, speed: Math.round(c.speed / 1.25) })}>
            Slower
          </button>
          <span className="crc__rate">{c.speed} px/s</span>
          <button type="button" className="btn" onClick={() => act({ type: 'creditsSpeed', id, speed: Math.round(c.speed * 1.25) })}>
            Faster
          </button>
        </div>
      )}
      {editing && (
        <CreditsEditor
          c={c}
          name={show.sources.find((s) => s.id === id)?.name ?? 'Credits'}
          onSave={(next) => act({ type: 'updateCredits', id, credits: next })}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/** The names, title and look. Applied on Done. */
function CreditsEditor({ c, name, onSave, onClose }: { c: Credits; name: string; onSave: (c: Credits) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Credits>(() => structuredClone(c));
  const [names, setNames] = useState(c.names.join('\n'));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const set = (p: Partial<Credits>) => setDraft((d) => ({ ...d, ...p }));
  const preview: Credits = { ...draft, names: parseNames(names), playing: true, posMs: 4000, at: Date.now() };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Credits" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box crd">
        <header className="modal__head">
          <h2>Credits · {name}</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="crd__body">
          <section className="crd__names">
            <label className="field">
              <span className="field__label">Title</span>
              <input className="text" dir="auto" value={draft.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
            </label>
            <label className="field crd__grow">
              <span className="field__label">Names — one per line (paste straight from a spreadsheet)</span>
              <textarea className="text crd__list" dir="auto" value={names} onChange={(e) => setNames(e.target.value)} aria-label="Names" />
              <span className="field__note">{parseNames(names).length} names. A second column, or “Name — role”, shows the role smaller.</span>
            </label>
          </section>
          <section className="crd__look">
            <div className="crd__preview">
              <CreditsView c={preview} />
            </div>
            <span className="field__label">Show as</span>
            <div className="seg-group">
              {(
                [
                  ['roll', 'Rolling'],
                  ['pages', 'Pages'],
                  ['wall', 'Wall of names'],
                ] as const
              ).map(([m, label]) => (
                <button key={m} type="button" className="seg" aria-pressed={draft.mode === m} onClick={() => set({ mode: m })}>
                  {label}
                </button>
              ))}
            </div>
            {draft.mode === 'roll' && (
              <label className="field">
                <span className="field__label">Speed · {draft.speed} px/s</span>
                <input type="range" min={10} max={300} value={draft.speed} onChange={(e) => set({ speed: Number(e.target.value) })} aria-label="Speed" />
              </label>
            )}
            {draft.mode === 'pages' && (
              <label className="field">
                <span className="field__label">Each page · {draft.pageMs / 1000} s</span>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={draft.pageMs / 1000}
                  onChange={(e) => set({ pageMs: Number(e.target.value) * 1000 })}
                  aria-label="Seconds per page"
                />
              </label>
            )}
            <label className="field">
              <span className="field__label">Name size · {draft.size}</span>
              <input type="range" min={24} max={120} value={draft.size} onChange={(e) => set({ size: Number(e.target.value) })} aria-label="Name size" />
            </label>
            <div className="txed__row">
              <select value={draft.font} onChange={(e) => set({ font: e.target.value })} aria-label="Font">
                {TEXT_FONTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <label className="check">
                Text <input type="color" value={draft.color} onChange={(e) => set({ color: e.target.value })} aria-label="Text colour" />
              </label>
              <label className="check">
                Background <input type="color" value={draft.background} onChange={(e) => set({ background: e.target.value })} aria-label="Background colour" />
              </label>
            </div>
          </section>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              onSave({ ...draft, names: parseNames(names) });
              onClose();
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
