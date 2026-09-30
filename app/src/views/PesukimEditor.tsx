import { useEffect, useState } from 'react';
import type { Show } from '../engine/types/Show';
import type { PesukimLook } from '../engine/types/PesukimLook';
import type { Pasuk } from '../engine/types/Pasuk';
import { BAR_DESIGNS, glossesOf, PESUKIM, parsePaste, pesukimOf, standardPesukim, wordsOf, type PesukimData } from '../engine/pesukim';
import { PesukimView } from '../components/PesukimView';
import { SourceView } from '../components/SourceView';
import type { EngineClient } from '../engine/client';
import type { Act } from './act';
import './PesukimCard.css';

const BACKGROUNDS = [
  { name: 'Night', color: '#15213a' },
  { name: 'Gold', color: '#3a2d12' },
  { name: 'Forest', color: '#12291f' },
  { name: 'Black', color: '#050506' },
];
const TEXT_COLOURS = [
  { name: 'Gold', color: '#ffe39e' },
  { name: 'White', color: '#ffffff' },
  { name: 'Light blue', color: '#9fe0ff' },
];
const FONTS = ['Frank Ruhl Libre', 'David Libre', 'Heebo'];
const BEHIND_KINDS = ['camera', 'video', 'image', 'color', 'pattern', 'visuals'];

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
  const pictures = show.sources.filter((s) => BEHIND_KINDS.includes(s.kind.type));
  const behind = look.behind ? show.sources.find((s) => s.id === look.behind) : undefined;
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
              <PesukimView data={preview} behind={behind && client ? <SourceView source={behind} client={client} report={false} /> : null} />
            </div>
            <span className="field__label">Show</span>
            <div className="seg-group">
              {(
                [
                  ['bar', 'Bar'],
                  ['word', 'One word'],
                  ['strip', 'Big word + line'],
                  ['pasuk', 'Whole pasuk'],
                ] as const
              ).map(([m, name]) => (
                <button
                  key={m}
                  type="button"
                  className={`seg${look.mode === m ? ' is-on' : ''}`}
                  aria-pressed={look.mode === m}
                  onClick={() => set({ mode: m })}
                >
                  {name}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={look.keepSaid} onChange={(e) => set({ keepSaid: e.target.checked })} /> Keep words already said on screen
            </label>
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
                  Your own design: a picture made for the bar (a wide PNG, about 1650 × 240; see-through parts show the picture behind). The words go on top.
                  Put this input on as an overlay over the camera, or choose the camera below.
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

            {look.mode !== 'bar' && <span className="field__label">Background</span>}
            <div className="pked__swatches" hidden={look.mode === 'bar'}>
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.color}
                  type="button"
                  className={`pked__swatch${look.background === b.color ? ' is-on' : ''}`}
                  style={{ background: b.color }}
                  onClick={() => set({ background: b.color })}
                >
                  {b.name}
                </button>
              ))}
              <input type="color" value={look.background} onChange={(e) => set({ background: e.target.value })} aria-label="Other background colour" />
            </div>
            <label className="field">
              <span className="field__label">Behind the words</span>
              <select value={look.behind ?? ''} onChange={(e) => set({ behind: e.target.value || null })}>
                <option value="">Just the background colour</option>
                {pictures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
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
              <select value={look.font} onChange={(e) => set({ font: e.target.value })} aria-label="Font" className="bcd__grow">
                {FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
              <select value={look.wordChange} onChange={(e) => set({ wordChange: e.target.value as PesukimLook['wordChange'] })} aria-label="Word change">
                <option value="fade">Words fade in</option>
                <option value="pop">Words pop in</option>
                <option value="cut">Words just change</option>
              </select>
            </div>
            <label className="field" hidden={look.mode === 'bar'}>
              <span className="field__label">Word size</span>
              <input type="range" min={8} max={40} value={look.size} onChange={(e) => set({ size: Number(e.target.value) })} aria-label="Word size" />
            </label>
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
