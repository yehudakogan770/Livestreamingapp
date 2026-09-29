import { useEffect, useState } from 'react';
import { defaultCountdown, type EngineClient } from '../engine/client';
import { defaultKey } from '../engine/chroma';
import type { NewSource } from '../engine/types/NewSource';
import type { SourceKind } from '../engine/types/SourceKind';
import type { Source } from '../engine/types/Source';
import { SourceView } from '../components/SourceView';
import { defaultPesukim } from '../engine/pesukim';
import { TEXT_TEMPLATES } from '../engine/text';
import { defaultCredits, parseNames } from '../engine/credits';
import { SplitPicker } from './SplitEditor';
import { SlideshowSetup } from './SlideshowEditor';
import { defaultSlideshow } from '../engine/slideshow';
import type { Slideshow } from '../engine/types/Slideshow';
import { defaultSplit } from '../engine/split';
import type { Split } from '../engine/types/Split';

/** What can be added; a sound file is stored as a video source that is never shown. */
type Kind = SourceKind['type'] | 'sound';

const KINDS: { kind: Kind; name: string; hint: string }[] = [
  { kind: 'camera', name: 'Camera', hint: 'Webcam, capture card or phone' },
  { kind: 'video', name: 'Video file', hint: 'MP4, MOV, WebM…' },
  { kind: 'image', name: 'Picture', hint: 'PNG, JPG, logo…' },
  { kind: 'color', name: 'Colour', hint: 'A solid colour' },
  { kind: 'pattern', name: 'Test pattern', hint: 'Colour bars for setup' },
  { kind: 'countdown', name: 'Countdown', hint: 'The show countdown, big' },
  { kind: 'pesukim', name: '12 Pesukim', hint: 'One word at a time, the crowd repeats' },
  { kind: 'text', name: 'Text / title', hint: 'Lower third, title, ticker, message' },
  { kind: 'credits', name: 'Credits / thank-you', hint: 'Rolling names at the end' },
  { kind: 'split', name: 'Split screen', hint: '2 – 4 inputs at once, picture-in-picture' },
  { kind: 'slideshow', name: 'Slideshow', hint: 'Pictures, PDF, videos between slides' },
  { kind: 'microphone', name: 'Microphone', hint: 'Mic, sound desk or line in' },
  { kind: 'sound', name: 'Sound / music file', hint: 'MP3, WAV… music and effects' },
];

const SWATCHES = ['#000000', '#ffffff', '#1f6f79', '#0b2545', '#3b1c32', '#c7372f', '#d4a017', '#2f8f4e'];

/** Choose what kind of input to add, set it up, and add it. */
export function AddInput({
  client,
  onAdd,
  onClose,
  sources = [],
  initialKind,
  initialTemplate,
}: {
  client: EngineClient;
  onAdd: (source: NewSource) => void;
  onClose: () => void;
  /** Inputs already added (to put in a split screen's boxes). */
  sources?: Source[];
  /** Open on this kind (from the menu bar). */
  initialKind?: string;
  initialTemplate?: number;
}) {
  const [kind, setKind] = useState<Kind>(() => (KINDS.some((k) => k.kind === initialKind) ? (initialKind as Kind) : 'camera'));
  const [name, setName] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [color, setColor] = useState('#1f6f79');
  const [template, setTemplate] = useState(initialTemplate ?? 0);
  const [split, setSplit] = useState<Split>(defaultSplit);
  const [slideshow, setSlideshow] = useState<Slideshow>(defaultSlideshow);
  const [words, setWords] = useState('');
  const [subWords, setSubWords] = useState('');
  const [looping, setLooping] = useState(true);
  const [cams, setCams] = useState<MediaDeviceInfo[] | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [cam, setCam] = useState<MediaDeviceInfo | null>(null);
  const deviceKind = kind === 'microphone' ? 'audioinput' : 'videoinput';
  const what = kind === 'microphone' ? 'microphones' : 'cameras';

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // Cameras are listed once permission is given, so their real names show.
  useEffect(() => {
    if ((kind !== 'camera' && kind !== 'microphone') || cams !== null) return;
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) {
      setCams([]);
      setCamErr(`No ${what} are available here.`);
      return;
    }
    md.getUserMedia(deviceKind === 'audioinput' ? { audio: true } : { video: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => setCamErr(`Lumora was not allowed to use ${what}, or none is plugged in.`))
      .finally(() =>
        md.enumerateDevices().then((all) => {
          const list = all.filter((d) => d.kind === deviceKind && !(deviceKind === 'audioinput' && d.deviceId === 'default'));
          setCams(list);
          if (list.length) setCamErr(null);
        }),
      );
  }, [kind, cams, deviceKind, what]);

  const choose = async (k: 'video' | 'image' | 'audio') => {
    const f = await client.pickFile(k);
    if (f) {
      setPath(f.path);
      if (!name) setName(f.name);
    }
  };

  const draft = (): NewSource | null => {
    const n = name.trim();
    switch (kind) {
      case 'camera':
        return cam ? { name: n || cam.label || 'Camera', kind: { type: 'camera', deviceId: cam.deviceId, label: cam.label } } : null;
      case 'video':
        return path ? { name: n || 'Video', kind: { type: 'video', path, durationS: 0, playback: { playing: false, posS: 0, at: 0 } }, looping } : null;
      case 'image':
        return path ? { name: n || 'Picture', kind: { type: 'image', path } } : null;
      case 'color':
        return { name: n || 'Colour', kind: { type: 'color', color } };
      case 'microphone':
        return cam ? { name: n || cam.label || 'Microphone', kind: { type: 'microphone', deviceId: cam.deviceId, label: cam.label } } : null;
      case 'sound':
        return path
          ? {
              name: n || 'Music',
              kind: { type: 'video', path, durationS: 0, playback: { playing: false, posS: 0, at: 0 } },
              looping,
              // Music and effects are heard whenever they play, not only "on air".
              audio: { follow: false, toMaster: true, toA: true, toB: true, delayMs: 0 },
            }
          : null;
      case 'pattern':
        return { name: n || 'Test pattern', kind: { type: 'pattern' } };
      case 'countdown':
        return { name: n || 'Countdown', kind: { type: 'countdown', background: color, timer: defaultCountdown() } };
      case 'text': {
        const t = TEXT_TEMPLATES[template]!.make();
        return {
          name: n || words.trim() || t.text,
          kind: { type: 'text', ...t, text: words.trim() || t.text, sub: words.trim() ? subWords.trim() : t.sub },
        };
      }
      case 'split':
        return { name: n || 'Split screen', kind: { type: 'split', ...split } };
      case 'slideshow':
        return slideshow.slides.length ? { name: n || 'Slideshow', kind: { type: 'slideshow', ...slideshow } } : null;
      case 'credits':
        return { name: n || 'Credits', kind: { type: 'credits', ...defaultCredits(), names: parseNames(words) } };
      case 'pesukim':
        // The words are typed or pasted in afterwards (Edit on its card).
        return { name: n || '12 Pesukim', kind: { type: 'pesukim', ...defaultPesukim() } };
    }
  };
  const ready = draft();
  const previewSource = ready
    ? {
        id: 'draft',
        key: defaultKey(),
        volume: 1,
        muted: true,
        looping: false,
        fit: 'contain' as const,
        audio: { follow: true, toMaster: true, toA: true, toB: true, delayMs: 0 },
        ...ready,
      }
    : null;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add input" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box addinput">
        <header className="modal__head">
          <h2>Add input</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="addinput__body">
          <nav className="addinput__kinds" aria-label="Input type">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                className="addinput__kind"
                aria-pressed={kind === k.kind}
                onClick={() => {
                  setKind(k.kind);
                  setPath(null);
                  setName('');
                  setCams(null);
                  setCam(null);
                  setCamErr(null);
                }}
              >
                <strong>{k.name}</strong>
                <span>{k.hint}</span>
              </button>
            ))}
          </nav>
          <div className="addinput__setup">
            <div className="addinput__preview">
              {previewSource ? (
                <SourceView source={previewSource} client={client} report={false} />
              ) : (
                <span className="addinput__empty">Nothing chosen yet</span>
              )}
            </div>

            {(kind === 'camera' || kind === 'microphone') && (
              <div className="field">
                <span className="field__label">{kind === 'camera' ? 'Choose a camera' : 'Choose a microphone or sound input'}</span>
                {cams === null && <span className="field__note">Looking for {what}…</span>}
                {camErr && <span className="field__note field__note--warn">{camErr}</span>}
                <div className="addinput__list">
                  {cams?.map((d, i) => (
                    <button key={d.deviceId || i} type="button" className="seg" aria-pressed={cam?.deviceId === d.deviceId} onClick={() => setCam(d)}>
                      {d.label || `${kind === 'camera' ? 'Camera' : 'Sound input'} ${i + 1}`}
                    </button>
                  ))}
                </div>
                <button type="button" className="linkbtn" onClick={() => setCams(null)}>
                  Look again
                </button>
              </div>
            )}

            {(kind === 'video' || kind === 'image' || kind === 'sound') && (
              <div className="field">
                <span className="field__label">{kind === 'video' ? 'Video file' : kind === 'sound' ? 'Sound or music file' : 'Picture file'}</span>
                <div className="addinput__file">
                  <button type="button" className="btn" onClick={() => void choose(kind === 'sound' ? 'audio' : kind)}>
                    Choose file…
                  </button>
                  <span className="addinput__path" title={path ?? ''}>
                    {path ? path : 'No file chosen'}
                  </span>
                </div>
                {(kind === 'video' || kind === 'sound') && (
                  <label className="check">
                    <input type="checkbox" checked={looping} onChange={(e) => setLooping(e.target.checked)} /> Loop at the end (good for background loops)
                  </label>
                )}
              </div>
            )}

            {(kind === 'color' || kind === 'countdown') && (
              <div className="field">
                <span className="field__label">{kind === 'countdown' ? 'Background' : 'Colour'}</span>
                <div className="addinput__swatches">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="swatch"
                      aria-label={c}
                      aria-pressed={color === c}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                  <input type="color" aria-label="Any colour" value={color} onChange={(e) => setColor(e.target.value)} />
                </div>
              </div>
            )}

            {kind === 'split' && <SplitPicker split={split} sources={sources} onChange={setSplit} />}
            {kind === 'slideshow' && (
              <SlideshowSetup sh={slideshow} sources={sources.filter((x) => x.kind.type !== 'slideshow')} client={client} onChange={setSlideshow} />
            )}

            {kind === 'credits' && (
              <label className="field">
                <span className="field__label">Names (one per line, or paste from a spreadsheet)</span>
                <textarea
                  className="text addinput__names"
                  dir="auto"
                  rows={6}
                  value={words}
                  placeholder={'Mendel K. — Chazzan\nChaya S.\n…'}
                  onChange={(e) => setWords(e.target.value)}
                  aria-label="Names"
                />
                <span className="field__note">A second column (or “Name — role”) shows the role smaller. Edit more on its card when it is on air.</span>
              </label>
            )}

            {kind === 'text' && (
              <div className="field">
                <span className="field__label">Kind of text</span>
                <div className="addinput__list">
                  {TEXT_TEMPLATES.map((t, i) => (
                    <button key={t.layout} type="button" className="seg" aria-pressed={template === i} onClick={() => setTemplate(i)} title={t.hint}>
                      {t.name}
                    </button>
                  ))}
                </div>
                <input
                  className="text"
                  dir="auto"
                  value={words}
                  placeholder={TEXT_TEMPLATES[template]!.make().text}
                  onChange={(e) => setWords(e.target.value)}
                  aria-label="Text"
                />
                {TEXT_TEMPLATES[template]!.layout !== 'ticker' && (
                  <input
                    className="text"
                    dir="auto"
                    value={subWords}
                    placeholder={TEXT_TEMPLATES[template]!.make().sub || 'Second line (optional)'}
                    onChange={(e) => setSubWords(e.target.value)}
                    aria-label="Second line"
                  />
                )}
                <span className="field__note">
                  Fonts, colours, the box and more: “Edit text…” on its tile after adding. Put it on an overlay button to show it over what is on air.
                </span>
              </div>
            )}

            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="text"
                value={name}
                maxLength={60}
                placeholder={ready?.name ?? 'Name shown on the tile'}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!ready} onClick={() => ready && onAdd(ready)}>
            Add input
          </button>
        </footer>
      </div>
    </div>
  );
}
