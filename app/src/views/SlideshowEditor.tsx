import { Images, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Slide } from '../engine/types/Slide';
import type { Slideshow } from '../engine/types/Slideshow';
import type { Source } from '../engine/types/Source';
import { AREAS, pdfToPictures } from '../engine/slideshow';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';
import { sendCommand } from './commands';
import './SlideshowEditor.css';
import './TextEditor.css';
import './PesukimCard.css';

const AS_SLIDE = ['camera', 'video', 'image', 'color', 'pattern', 'countdown', 'text', 'pesukim', 'credits', 'split', 'visuals'];
const BEHIND = ['camera', 'video', 'image', 'color', 'pattern', 'visuals'];

/** The slides (add, reorder, remove) and how the slideshow looks. */
export function SlideshowSetup({
  sh,
  sources,
  client,
  onChange,
}: {
  sh: Slideshow;
  sources: Source[];
  client: EngineClient;
  onChange: (sh: Slideshow) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (p: Partial<Slideshow>) => onChange({ ...sh, ...p });
  const setSlides = (slides: Slide[]) => onChange({ ...sh, slides, current: Math.min(sh.current, Math.max(0, slides.length - 1)) });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= sh.slides.length) return;
    const slides = [...sh.slides];
    [slides[i], slides[j]] = [slides[j]!, slides[i]!];
    setSlides(slides);
  };
  const addPictures = async () => {
    const files = await client.pickFiles('image');
    if (files.length) setSlides([...sh.slides, ...files.map((f) => ({ type: 'image' as const, path: f.path }))]);
  };
  const addPdf = async () => {
    setProblem(null);
    const [file] = await client.pickFiles('pdf');
    if (!file) return;
    try {
      setBusy('Opening the PDF…');
      const data = await (await fetch(client.mediaUrl(file.path))).arrayBuffer();
      const stamp = Date.now().toString(36);
      const paths = await pdfToPictures(
        data,
        (png, page) => client.saveSlide(png, `${stamp}-${page}.png`),
        (n, of) => setBusy(`Turning page ${n} of ${of} into a slide…`),
      );
      setSlides([...sh.slides, ...paths.map((path) => ({ type: 'image' as const, path }))]);
    } catch (e) {
      setProblem(`That PDF could not be opened: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const inputs = sources.filter((s) => AS_SLIDE.includes(s.kind.type));
  const nameOf = (id: string) => sources.find((s) => s.id === id)?.name ?? '(removed)';

  return (
    <div className="field sls">
      <span className="field__label">Slides ({sh.slides.length})</span>
      <div className="sls__list" aria-label="Slides">
        {sh.slides.length === 0 && <span className="field__note">No slides yet: add pictures, a PDF, or an input (like a video to play between slides).</span>}
        {sh.slides.map((sl, i) => (
          <div key={i} className="sls__slide">
            <span className="sls__n">{i + 1}</span>
            <div className="sls__thumb">
              {sl.type === 'image' ? (
                <img src={client.mediaUrl(sl.path)} alt="" draggable={false} />
              ) : (
                <span className="sls__input">{nameOf(sl.sourceId)}</span>
              )}
            </div>
            <textarea
              className="sls__notes"
              rows={2}
              maxLength={4000}
              value={sl.notes ?? ''}
              placeholder="Notes for the speaker (only the speaker’s device shows them)"
              aria-label={`Notes for slide ${i + 1}`}
              onChange={(e) => setSlides(sh.slides.map((x, j) => (j === i ? { ...x, notes: e.target.value || null } : x)))}
            />
            <span className="sls__btns">
              <button type="button" className="icon" aria-label={`Move slide ${i + 1} earlier`} onClick={() => move(i, -1)} disabled={i === 0}>
                ▲
              </button>
              <button type="button" className="icon" aria-label={`Move slide ${i + 1} later`} onClick={() => move(i, 1)} disabled={i === sh.slides.length - 1}>
                ▼
              </button>
              <button type="button" className="icon" aria-label={`Remove slide ${i + 1}`} onClick={() => setSlides(sh.slides.filter((_, j) => j !== i))}>
                <X aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="txed__row">
        <button type="button" className="btn" onClick={() => void addPictures()} disabled={!!busy}>
          + Pictures…
        </button>
        <button type="button" className="btn" onClick={() => void addPdf()} disabled={!!busy} title="PowerPoint: use File → Save as → PDF first">
          + PDF…
        </button>
        <select
          value=""
          onChange={(e) => e.target.value && setSlides([...sh.slides, { type: 'input', sourceId: e.target.value }])}
          aria-label="Add an input as a slide"
        >
          <option value="">+ An input as a slide…</option>
          {inputs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {busy && <span className="field__note">{busy}</span>}
      {problem && (
        <span className="field__note field__note--warn" role="alert">
          {problem}
        </span>
      )}
      <span className="field__note">PowerPoint: save it as a PDF first (File → Save as → PDF), then add the PDF.</span>

      <span className="field__label">Where the slides go</span>
      <div className="addinput__list">
        {AREAS.map((a) => (
          <button
            key={a.name}
            type="button"
            className="seg"
            aria-pressed={sh.area.x === a.frame.x && sh.area.y === a.frame.y && sh.area.w === a.frame.w}
            onClick={() => set({ area: a.frame })}
          >
            {a.name}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field__label">Behind (and around) the slides</span>
        <select value={sh.behind ?? ''} onChange={(e) => set({ behind: e.target.value || null })} aria-label="Behind the slides">
          <option value="">Just the background color</option>
          {sources
            .filter((s) => BEHIND.includes(s.kind.type))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <div className="txed__row">
        <label className="check">
          <input type="checkbox" checked={sh.fit === 'cover'} onChange={(e) => set({ fit: e.target.checked ? 'cover' : 'contain' })} /> Fill the area (crop)
        </label>
        <label className="check">
          <input type="checkbox" checked={sh.fade} onChange={(e) => set({ fade: e.target.checked })} /> Fade between slides
        </label>
        <label className="check">
          Background <input type="color" value={sh.background} onChange={(e) => set({ background: e.target.value })} aria-label="Background color" />
        </label>
      </div>
      <div className="txed__row">
        <label className="check">
          <input type="checkbox" checked={sh.autoMs !== null} onChange={(e) => set({ autoMs: e.target.checked ? 8000 : null })} /> Next slide by itself every
          <input
            type="number"
            className="text pked__secs"
            min={1}
            max={600}
            disabled={sh.autoMs === null}
            value={(sh.autoMs ?? 8000) / 1000}
            onChange={(e) => set({ autoMs: Math.round(Math.min(600, Math.max(1, Number(e.target.value) || 8)) * 1000) })}
            aria-label="Seconds per slide"
          />
          s
        </label>
        <label className="check">
          <input type="checkbox" checked={sh.looping} onChange={(e) => set({ looping: e.target.checked })} /> Start again after the last
        </label>
      </div>
    </div>
  );
}

/** Edit a slideshow that has been added. Applied on Done. */
export function SlideshowEditor({
  source,
  sources,
  act,
  client,
  onClose,
}: {
  source: Source;
  sources: Source[];
  act: Act;
  client: EngineClient;
  onClose: () => void;
}) {
  const [sh, setSh] = useState<Slideshow | null>(() => (source.kind.type === 'slideshow' ? structuredClone(source.kind) : null));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!sh) return null;
  const others = sources.filter((s) => s.id !== source.id && s.kind.type !== 'slideshow');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Slideshow" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box sled">
        <header className="modal__head">
          <h2>
            <Images className="modal__icon" aria-hidden="true" />
            Slideshow · {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="sled__body">
          <div className="sled__preview">
            <SourceView source={{ ...source, kind: { type: 'slideshow', ...sh } }} client={client} report={false} />
          </div>
          <SlideshowSetup sh={sh} sources={others} client={client} onChange={setSh} />
        </div>
        <footer className="modal__foot">
          <button
            type="button"
            className="btn"
            title="The speaker changes the slides from a phone, tablet or laptop"
            onClick={() => {
              // Keep what was changed here, then show how to connect the speaker.
              act({ type: 'updateSlideshow', id: source.id, slideshow: sh });
              onClose();
              sendCommand({ type: 'speakerRemote' });
            }}
          >
            Control from another device…
          </button>
          <span className="sled__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              act({ type: 'updateSlideshow', id: source.id, slideshow: sh });
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
