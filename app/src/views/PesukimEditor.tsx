import { useEffect, useState } from 'react';
import { EFFECTS } from '../engine/effects';

const WORD_EFFECTS: [PesukimLook['wordChange'], string][] = [
  ['fade', 'Fade'],
  ['rise', 'Rise'],
  ['pop', 'Pop'],
  ['zoom', 'Zoom'],
  ['blur', 'Focus'],
  ['typewriter', 'Typewriter'],
  ['cut', 'Just change'],
];
import { FontPicker } from '../components/FontPicker';
import type { Show } from '../engine/types/Show';
import type { PesukimLook } from '../engine/types/PesukimLook';
import type { Pasuk } from '../engine/types/Pasuk';
import { BAR_DESIGNS, glossesOf, PESUKIM, parsePaste, pesukimOf, standardPesukim, wordsOf, type PesukimData } from '../engine/pesukim';
import { PesukimView } from '../components/PesukimView';
import type { EngineClient } from '../engine/client';
import type { Act } from './act';
import './PesukimCard.css';

const TEXT_COLOURS = [
  { name: 'Gold', color: '#ffe39e' },
  { name: 'White', color: '#ffffff' },
  { name: 'Light blue', color: '#9fe0ff' },
];
const FONTS = ['Frank Ruhl Libre', 'David Libre', 'Heebo'];

/** The three lines don't have the same number of words. */
function mismatch(p: Pasuk): string {
  const he = wordsOf(p.text).length;
  const tr = wordsOf(p.translit).length;
  const en = glossesOf(p.english).length;
  if (!he) return '';
  const off = [tr && tr !== he ? `how it sounds has ${tr} words` : '', en && en !== he ? `English has ${en}` : ''].filter(Boolean);
  return off.length ? `The Hebrew has ${he} words; ${off.join(', ')}.` : '';
}

/** Type or paste the twelve pesukim and the children's names, and choose the look. Applied on Done. */
export function PesukimEditor({ show, id, act, onClose, client }: { show: Show; id: string; act: Act; onClose: () => void; client?: EngineClient }) {
  const current = pesukimOf(show, id);
  const [list, setList] = useState<Pasuk[]>(() => structuredClone(current?.pesukim ?? []));
  const [look, setLook] = useState<PesukimLook>(() => structuredClone(current!.look));
  const [pasting, setPasting] = useState<string | null>(null);
  const [previewAt, setPreviewAt] = useState(0);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!current) return null;

  const set = (patch: Partial<PesukimLook>) => setLook((l) => ({ ...l, ...patch }));
  const setPasuk = (i: number, patch: Partial<Pasuk>) => setList((l) => l.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const preview: PesukimData = { pesukim: list, look, place: { pasuk: previewAt, word: 1, whole: false, blank: false, intro: false, changedAt: 0 } };
  const fill = () => setList((l) => standardPesukim(l.map((p) => p.child)));
  const pickBar = async () => {
    if (!client) return;
    const [f] = await client.pickFiles('image');
    if (f) set({ barImage: f.path });
  };
  const done = () => {
    act({ type: 'updatePesukim', id, pesukim: list, look });
    onClose();
  };
  const applyPaste = () => {
    const rows = parsePaste(pasting ?? '');
    setList((l) => l.map((p, i) => (rows[i] ? { ...p, child: rows[i]!.child || p.child, text: rows[i]!.text } : p)));
    setPasting(null);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="12 Pesukim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box pked">
        <header className="modal__head">
          <h2>12 Pesukim</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="pked__body">
          <section className="pked__list" aria-label="The pesukim">
            <div className="pked__listhead">
              <span className="field__label">Pesukim and children</span>
              <span className="bcd__row">
                <button type="button" className="btn" onClick={fill} title="The Hebrew, how it sounds and what it means (the children's names stay)">
                  Fill in the 12 Pesukim
                </button>
                <button type="button" className="btn" onClick={() => setPasting('')}>
                  Paste all 12…
                </button>
              </span>
            </div>
            {pasting !== null && (
              <div className="pked__paste">
                <textarea
                  className="text"
                  dir="auto"
                  rows={8}
                  autoFocus
                  value={pasting}
                  placeholder={'One pasuk per line.\nTo add the child’s name: Mendel: תּוֹרָה צִוָּה לָנוּ…'}
                  onChange={(e) => setPasting(e.target.value)}
                  aria-label="Paste the pesukim"
                />
                <div className="bcd__row">
                  <span className="field__note bcd__grow">Each line becomes one pasuk, in order.</span>
                  <button type="button" className="btn" onClick={() => setPasting(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn--primary" onClick={applyPaste} disabled={!pasting.trim()}>
                    Use these
                  </button>
                </div>
              </div>
            )}
            {list.slice(0, PESUKIM).map((p, i) => (
              <div key={i} className={`pked__pasuk${previewAt === i ? ' is-on' : ''}`} onFocus={() => setPreviewAt(i)}>
                <span className="pked__n">{String(i + 1).padStart(2, '0')}</span>
                <input
                  className="text pked__child"
                  value={p.child}
                  placeholder="Child’s name"
                  maxLength={60}
                  onChange={(e) => setPasuk(i, { child: e.target.value })}
                  aria-label={`Child for pasuk ${i + 1}`}
                />
                <div className="pked__texts">
                  <textarea
                    className="text pked__text"
                    dir="auto"
                    rows={2}
                    value={p.text}
                    placeholder="The words of the pasuk (Hebrew)"
                    onChange={(e) => setPasuk(i, { text: e.target.value })}
                    aria-label={`Pasuk ${i + 1}`}
                  />
                  <input
                    className="text"
                    value={p.translit}
                    placeholder="How it sounds, word for word"
                    onChange={(e) => setPasuk(i, { translit: e.target.value })}
                    aria-label={`Pasuk ${i + 1} transliteration`}
                  />
                  <input
                    className="text"
                    value={p.english}
                    placeholder="What it means, word for word"
                    onChange={(e) => setPasuk(i, { english: e.target.value })}
                    aria-label={`Pasuk ${i + 1} English`}
                  />
                  <input
                    className="text"
                    value={p.translation}
                    placeholder="What the whole pasuk means (shown with the whole pasuk)"
                    onChange={(e) => setPasuk(i, { translation: e.target.value })}
                    aria-label={`Pasuk ${i + 1} translation`}
                  />
                  {mismatch(p) && <span className="field__note pked__warn">{mismatch(p)}</span>}
                </div>
                <span className="pked__count">{wordsOf(p.text).length || ''}</span>
              </div>
            ))}
            <p className="field__note">
              Each space starts a new word. To show two words together, join them with a hyphen (e.g. ה׳-אֱלֹקֵינוּ). Keep the same number of words on all three
              lines, so the right words light up together; use _ for a word with no English.
            </p>
          </section>

          <section className="pked__look" aria-label="Look">
            <div className="pked__preview">
              <PesukimView data={preview} url={client ? (p) => client.mediaUrl(p) : undefined} />
            </div>
            <label className="check">
              <input type="checkbox" checked={look.showName} onChange={(e) => set({ showName: e.target.checked })} /> Show the child’s name before their pasuk
            </label>
            <label className="check">
              <input type="checkbox" checked={look.showTranslit} onChange={(e) => set({ showTranslit: e.target.checked })} /> How it sounds (transliteration)
            </label>
            <label className="check">
              <input type="checkbox" checked={look.showEnglish} onChange={(e) => set({ showEnglish: e.target.checked })} /> What it means (English)
            </label>
            {look.mode === 'bar' && (
              <>
                <span className="field__label">The bar shows</span>
                <div className="seg-group">
                  {(
                    [
                      ['one', 'One word at a time'],
                      ['line', 'The line, the word lit'],
                    ] as const
                  ).map(([v, name]) => (
                    <button
                      key={v}
                      type="button"
                      className={`seg${look.barWords === v ? ' is-on' : ''}`}
                      aria-pressed={look.barWords === v}
                      onClick={() => set({ barWords: v })}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <span className="field__label">Bar design</span>
                <div className="pked__swatches">
                  {BAR_DESIGNS.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`pked__swatch pked__design${!look.barImage && look.design === d.id ? ' is-on' : ''}`}
                      style={{ background: `linear-gradient(${d.top}, ${d.bottom})`, borderColor: d.edge }}
                      onClick={() => set({ design: d.id, barImage: '' })}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
                <label className="check">
                  <input type="checkbox" checked={look.plain} onChange={(e) => set({ plain: e.target.checked })} /> Text only (no bar, the words in the same
                  place)
                </label>
                {(look.plain || (look.design === 'none' && !look.barImage)) && (
                  <div className="bcd__row">
                    <label className="check">
                      Words <input type="color" value={look.textColor} onChange={(e) => set({ textColor: e.target.value })} aria-label="Words colour" />
                    </label>
                    <label className="check">
                      Outline{' '}
                      <input type="color" value={look.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} aria-label="Outline colour" />
                    </label>
                    <span className="field__note bcd__grow">Two colours keep the words easy to read over any picture.</span>
                  </div>
                )}
                <div className="bcd__row">
                  <button type="button" className={`btn${look.barImage ? ' is-on' : ''}`} onClick={() => void pickBar()} disabled={!client}>
                    {look.barImage ? '✓ My own picture — change' : '🖼 Use my own design (a picture)'}
                  </button>
                  {look.barImage && (
                    <button type="button" className="btn btn--small" onClick={() => set({ barImage: '' })}>
                      Remove
                    </button>
                  )}
                </div>
                <p className="field__note">
                  Your own design: a picture made for the bar (a wide PNG, about 1650 × 240; see-through parts show the camera behind). The words go on top.
                </p>
              </>
            )}
            <label className="check">
              <input type="checkbox" checked={look.autoMs !== null} onChange={(e) => set({ autoMs: e.target.checked ? 3000 : null })} /> Next word by itself
              every
              <input
                type="number"
                className="text pked__secs"
                min={0.5}
                max={60}
                step={0.5}
                disabled={look.autoMs === null}
                value={(look.autoMs ?? 3000) / 1000}
                onChange={(e) => set({ autoMs: Math.round(Math.min(60, Math.max(0.5, Number(e.target.value) || 3)) * 1000) })}
                aria-label="Seconds between words"
              />
              s
            </label>

            <span className="field__label">Text</span>
            <div className="pked__swatches">
              {TEXT_COLOURS.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  className={`pked__swatch pked__swatch--text${look.textColor === c.color ? ' is-on' : ''}`}
                  style={{ color: c.color }}
                  onClick={() => set({ textColor: c.color })}
                >
                  {c.name}
                </button>
              ))}
              <input type="color" value={look.textColor} onChange={(e) => set({ textColor: e.target.value })} aria-label="Other text colour" />
            </div>
            <div className="bcd__row">
              <label className="field bcd__grow">
                <span className="field__label">The bar comes on</span>
                <select value={look.barIn} onChange={(e) => set({ barIn: e.target.value as PesukimLook['barIn'] })} aria-label="How the bar comes on">
                  {EFFECTS.filter(([v]) => v !== 'build').map(([v, name]) => (
                    <option key={v} value={v}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field bcd__grow">
                <span className="field__label">Each word</span>
                <select
                  value={look.wordChange}
                  onChange={(e) => set({ wordChange: e.target.value as PesukimLook['wordChange'] })}
                  aria-label="Each word comes on"
                >
                  {WORD_EFFECTS.map(([v, name]) => (
                    <option key={v} value={v}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="bcd__row">
              <FontPicker value={look.font} onChange={(font) => set({ font })} added={show.event.brand.fonts.map((f) => f.name)} />
            </div>
          </section>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={done}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
