// Transcribe, the transcript and captions: write down what is said (offline),
// read and cut the film by its words, and edit the caption blocks and how
// they look.
import { useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { LANGUAGES } from '../../../../app/src/captions/whisper';
import { timecode } from '../model/build';
import {
  captionBlocks,
  captionCues,
  captionTracks,
  deleteWords,
  mergeCaptions,
  placeCaptions,
  rulesFor,
  sequenceWords,
  setCaptionStyle,
  setCaptionText,
  splitCaption,
  toSrt,
  toVtt,
  type SeqWord,
} from '../model/captions';
import { updateClips } from '../model/edit';
import { current, end, rate } from '../model/seq';
import { DEFAULT_CAPTION_STYLE, type CaptionStyle, type Clip, type Project } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import { inApp, native } from '../native';
import type { Engine } from '../player/engine';
import { captionRange, spansToTranscribe, Transcriber, withTranscripts, type SpeechModel, type SpeechProgress } from '../speech/transcribe';
import { ColorField, Choice, Modal, Scrub, Section } from './controls';
import { usePlayhead } from './hooks';
import { FONTS } from './Inspector';
import type { Ui } from './state';

/** Languages most likely wanted, first. */
const FIRST = ['en', 'es', 'he', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'yi', 'uk', 'pl', 'nl'];

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const PREFS = 'lumora-edit-speech';
function prefs(): { model: SpeechModel; language: string } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { model?: SpeechModel; language?: string };
    return { model: v.model === 'whisper-small' ? 'whisper-small' : 'whisper-base', language: v.language ?? 'auto' };
  } catch {
    return { model: 'whisper-base', language: 'auto' };
  }
}

/** Captions made from what was heard in [from, to) (all of it when no range), on the first captions track. */
export function makeCaptions(p: Project, range: { from: number; to: number } | null): Project {
  const s = current(p);
  const style = captionTracks(s)[0]?.captions ?? DEFAULT_CAPTION_STYLE;
  const words = sequenceWords(p, s).filter((w) => !range || (w.from >= range.from && w.from < range.to));
  return placeCaptions(p, captionBlocks(words, rate(s), rulesFor(style))).project;
}

export function TranscribeDialog({ doc, ui }: { doc: Doc; ui: Ui }) {
  const { project, selection } = useDoc(doc);
  const s = current(project);
  const ids = selectedIds(selection);
  const start = prefs();
  const [model, setModel] = useState<SpeechModel>(start.model);
  const [language, setLanguage] = useState(start.language);
  const [what, setWhat] = useState<'selected' | 'all'>(ids.length ? 'selected' : 'all');
  const [captions, setCaptions] = useState(true);
  const [state, setState] = useState<SpeechProgress | { stage: 'error'; message: string } | null>(null);
  const job = useRef<Transcriber | null>(null);
  const busy = state !== null && state.stage !== 'done' && state.stage !== 'error';
  const close = () => {
    if (busy) return;
    ui.set({ dialog: null });
  };
  const chosen = what === 'selected' && ids.length ? ids : null;
  const spans = spansToTranscribe(project, s, chosen);
  const seconds = [...spans.values()].flat().reduce((a, [x, y]) => a + (y - x), 0);
  const langs = [...FIRST, ...LANGUAGES.filter((l) => !FIRST.includes(l)).sort((a, b) => languageName(a).localeCompare(languageName(b)))];

  const run = async () => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ model, language }));
    } catch {
      // Not kept: fine.
    }
    const t = new Transcriber(model, language === 'auto' ? null : language, setState);
    job.current = t;
    try {
      const media = doc.project.media.filter((m) => spans.has(m.id));
      const found = await t.run(media, spans);
      const range = chosen ? captionRange(current(doc.project), chosen) : null;
      doc.edit(
        (p) => {
          const q = withTranscripts(p, found);
          return captions ? makeCaptions(q, range) : q;
        },
        captions ? 'Transcribe and make captions' : 'Transcribe',
      );
      const words = [...found.values()].reduce((a, x) => a + x.words.length, 0);
      setState({ stage: 'done', done: 1, message: `Done: ${words} words${captions ? ', and captions on the timeline' : ''}.` });
    } catch (e) {
      setState({ stage: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      job.current = null;
    }
  };

  return (
    <Modal title="Transcribe" onClose={close}>
      {!state || state.stage === 'error' ? (
        <div className="form">
          <div className="form__row">
            <span>What</span>
            <Choice
              value={what}
              options={[
                ['selected', ids.length ? 'The selected clips' : 'The selected clips (select some first)'],
                ['all', 'The whole sequence'],
              ]}
              onChange={(v) => (v === 'all' || ids.length) && setWhat(v)}
              label="What to transcribe"
            />
          </div>
          <label className="form__row">
            <span>Language</span>
            <select className="text" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="auto">Work it out (from what is said first)</option>
              {langs.map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </select>
          </label>
          <div className="form__row">
            <span>Model</span>
            <Choice
              value={model}
              options={[
                ['whisper-base', 'Quick (base, 70 MB)'],
                ['whisper-small', 'Most accurate (small, 250 MB)'],
              ]}
              onChange={setModel}
              label="Speech model"
            />
          </div>
          <label className="check form__check">
            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Make captions on the timeline
          </label>
          <p className="insp__note">
            Everything happens on this computer: no sound leaves it. The speech model is downloaded once. About {Math.max(1, Math.round(seconds / 60))} minute
            {Math.round(seconds / 60) === 1 ? '' : 's'} of sound to listen to.
          </p>
          {!inApp() && <p className="form__problem">Transcribing works in the installed program.</p>}
          {state?.stage === 'error' && <p className="form__problem">{state.message}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={!inApp() || seconds <= 0} onClick={() => void run()}>
              Transcribe
            </button>
          </div>
        </div>
      ) : (
        <div className="expo">
          <p className="expo__msg">{state.message}</p>
          <div className="expo__bar">
            <i style={{ width: `${Math.round(('done' in state ? state.done : 0) * 100)}%` }} />
          </div>
          <div className="form__foot">
            {busy ? (
              <button type="button" className="btn" onClick={() => job.current?.stop()}>
                Stop
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => ui.set({ dialog: null })}>
                Done
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Paragraphs of the transcript: a new one after a pause of two seconds. */
function paragraphs(words: SeqWord[], fps: number): number[][] {
  const out: number[][] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!prev || w.from - prev.to > fps * 2) out.push([i]);
    else out[out.length - 1]?.push(i);
  });
  return out;
}

/** The words of the sequence: click one to go there; select some and delete to cut them out (and close up). */
export function TranscriptPanel({ doc, engine, ui }: { doc: Doc; engine: Engine; ui: Ui }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const t = usePlayhead(engine);
  const words = useMemo(() => sequenceWords(project, s), [project, s]);
  const paras = useMemo(() => paragraphs(words, fps), [words, fps]);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [find, setFind] = useState('');
  const dragging = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const lo = sel ? Math.min(sel.a, sel.b) : -1;
  const hi = sel ? Math.max(sel.a, sel.b) : -1;
  // The word at the playhead.
  let now = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as SeqWord;
    if (w.from > t) break;
    if (t < w.to) now = i;
  }
  const q = find.trim().toLowerCase();
  useEffect(() => {
    if (!engine.isPlaying || now < 0) return;
    box.current?.querySelector(`[data-i="${now}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [now, engine]);
  useEffect(() => setSel(null), [words]);
  const seek = (f: number) => {
    engine.pause();
    engine.seek(f);
  };
  const remove = () => {
    if (lo < 0) return;
    const chosen = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    const at = (words[lo] as SeqWord).from;
    doc.edit((p) => deleteWords(p, words, chosen), chosen.length === 1 ? 'Delete a word' : `Delete ${chosen.length} words`);
    setSel(null);
    seek(at);
  };
  if (!words.length)
    return (
      <div className="insp insp--empty">
        <h2 className="insp__title">Transcript</h2>
        <p className="insp__note">
          Nothing is transcribed yet. Transcribe the sequence (or some clips) to read it here, jump to any word, and cut by deleting words.
        </p>
        <button type="button" className="btn btn--sm" onClick={() => ui.set({ dialog: 'transcribe' })}>
          Transcribe…
        </button>
      </div>
    );
  return (
    <div className="tscript">
      <div className="tscript__bar">
        <input
          className="media__search"
          placeholder="Find words"
          aria-label="Find words"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="button" className="btn btn--sm" disabled={lo < 0} title="Cut the selected words out and close up (Delete)" onClick={remove}>
          Delete words
        </button>
        <button
          type="button"
          className="btn btn--sm"
          title="Caption blocks from the words, on the captions track"
          onClick={() => doc.edit((p) => makeCaptions(p, null), 'Make captions')}
        >
          Make captions
        </button>
        <button type="button" className="btn btn--sm" onClick={() => ui.set({ dialog: 'transcribe' })}>
          Transcribe…
        </button>
      </div>
      <div
        ref={box}
        className="tscript__words"
        tabIndex={0}
        role="listbox"
        aria-label="Transcript"
        aria-multiselectable="true"
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && lo >= 0) {
            e.preventDefault();
            e.stopPropagation();
            remove();
          } else if (e.key === 'Escape') setSel(null);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
      >
        {paras.map((para) => (
          <p key={para[0]} className="tscript__para">
            <button type="button" className="tscript__time" onClick={() => seek((words[para[0] as number] as SeqWord).from)}>
              {timecode((words[para[0] as number] as SeqWord).from, fps)}
            </button>
            {para.map((i) => {
              const w = words[i] as SeqWord;
              const cls = `tscript__w${i === now ? ' is-now' : ''}${i >= lo && i <= hi ? ' is-sel' : ''}${q && w.w.toLowerCase().includes(q) ? ' is-found' : ''}`;
              return (
                <span
                  key={i}
                  data-i={i}
                  role="option"
                  aria-selected={i >= lo && i <= hi}
                  className={cls}
                  title={timecode(w.from, fps)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    dragging.current = true;
                    if (e.shiftKey && sel) setSel({ a: sel.a, b: i });
                    else setSel({ a: i, b: i });
                  }}
                  onPointerEnter={(e) => {
                    if (dragging.current && e.buttons & 1 && sel) setSel({ a: sel.a, b: i });
                  }}
                  onClick={(e) => {
                    if (!e.shiftKey && lo === hi) seek(w.from);
                  }}
                >
                  {w.w}{' '}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      <p className="tscript__foot">
        {words.length} words
        {lo >= 0 ? ` · ${hi - lo + 1} selected (${(((words[hi] as SeqWord).to - (words[lo] as SeqWord).from) / fps).toFixed(1)} s)` : ''}. Click a word to go
        there; drag across words and press Delete to cut them out.
      </p>
    </div>
  );
}

/** Save a captions track as .srt or .vtt. */
export async function saveCaptionFile(doc: Doc, kind: 'srt' | 'vtt', track?: string, range?: { from: number; to: number }) {
  const s = current(doc.project);
  const cues = captionCues(s, track, range);
  if (!cues.length) return 'There are no captions to save.';
  const text = kind === 'srt' ? toSrt(cues) : toVtt(cues);
  if (!inApp()) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `${doc.project.name || 'Captions'}.${kind}`;
    a.click();
    return '';
  }
  const picked = await save({
    title: kind === 'srt' ? 'Save captions (.srt)' : 'Save captions (.vtt)',
    defaultPath: `${doc.project.name || 'Captions'}.${kind}`,
    filters: [{ name: kind === 'srt' ? 'SubRip captions' : 'WebVTT captions', extensions: [kind] }],
  });
  if (!picked) return '';
  await native.writeText(picked, text);
  return `Saved ${cues.length} captions`;
}

/** A caption block: its words, cutting it in two or joining, and how its track looks. */
export function CaptionSection({ doc, engine, ui, clip, selected }: { doc: Doc; engine: Engine; ui: Ui; clip: Clip; selected: Clip[] }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const t = usePlayhead(engine);
  const track = s.tracks.find((x) => x.id === clip.track);
  const style = track?.captions;
  if (clip.source.kind !== 'caption' || !style || !track) return null;
  const others = selected.filter((c) => c.source.kind === 'caption' && c.track === clip.track);
  const next = s.clips.filter((c) => c.track === clip.track && c.start >= end(clip)).sort((a, b) => a.start - b.start)[0];
  return (
    <>
      <Section title="Caption">
        <textarea
          className="text insp__words"
          rows={3}
          value={clip.source.text}
          aria-label="Caption words"
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => doc.edit((p) => updateClips(p, [clip.id], (c) => setCaptionText(c, e.target.value)), 'Caption words', `cap-${clip.id}`)}
        />
        <div className="insp__row">
          <button
            type="button"
            className="btn btn--sm"
            disabled={t <= clip.start || t >= end(clip)}
            title="Cut this caption in two at the playhead (the words are shared out)"
            onClick={() => doc.edit((p) => splitCaption(p, clip.id, t), 'Split caption')}
          >
            Split at playhead
          </button>
          {others.length > 1 ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                doc.edit(
                  (p) =>
                    mergeCaptions(
                      p,
                      others.map((c) => c.id),
                    ),
                  'Join captions',
                )
              }
            >
              Join the {others.length} selected
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              disabled={!next}
              onClick={() => next && doc.edit((p) => mergeCaptions(p, [clip.id, next.id]), 'Join captions')}
            >
              Join with the next
            </button>
          )}
        </div>
        <div className="insp__row">
          <button type="button" className="btn btn--sm" onClick={() => void saveCaptionFile(doc, 'srt', track.id).then((m) => m && ui.note(m))}>
            Save .srt…
          </button>
          <button type="button" className="btn btn--sm" onClick={() => void saveCaptionFile(doc, 'vtt', track.id).then((m) => m && ui.note(m))}>
            Save .vtt…
          </button>
        </div>
      </Section>
      <CaptionStyleEditor
        style={style}
        onChange={(change, final) => doc.edit((p) => setCaptionStyle(p, track.id, change), 'Caption look', final ? undefined : `capstyle-${track.id}`)}
      />
    </>
  );
}

function CaptionStyleEditor({ style, onChange }: { style: CaptionStyle; onChange: (c: Partial<CaptionStyle>, final: boolean) => void }) {
  return (
    <Section title="Caption look (the whole track)">
      <div className="insp__row">
        <select
          className="text text--sm"
          value={style.font}
          aria-label="Font"
          style={{ fontFamily: style.font }}
          onChange={(e) => onChange({ font: e.target.value }, true)}
        >
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
        <Scrub value={style.size} min={16} max={200} step={1} unit="px" label="Size" onChange={(v, final) => onChange({ size: v }, final)} />
        <Choice
          value={style.weight >= 700 ? 700 : style.weight >= 500 ? 600 : 400}
          options={[
            [400, 'Regular'],
            [600, 'Semibold'],
            [700, 'Bold'],
          ]}
          onChange={(v) => onChange({ weight: v }, true)}
          label="Weight"
        />
      </div>
      <div className="insp__row">
        <span className="field__label">Color</span>
        <ColorField value={style.color} label="Caption color" onChange={(color) => onChange({ color }, false)} />
        <span className="field__label">Outline</span>
        <Scrub value={style.stroke} min={0} max={20} step={0.5} unit="px" label="Outline" onChange={(v, final) => onChange({ stroke: v }, final)} />
        <ColorField value={style.strokeColor} label="Outline color" onChange={(strokeColor) => onChange({ strokeColor }, false)} />
      </div>
      <div className="insp__row">
        <label className="check">
          <input type="checkbox" checked={style.box} onChange={(e) => onChange({ box: e.target.checked }, true)} /> Box behind
        </label>
        {style.box && (
          <>
            <ColorField value={style.boxColor} label="Box color" onChange={(boxColor) => onChange({ boxColor }, false)} />
            <Scrub
              value={style.boxOpacity}
              min={0}
              max={100}
              step={1}
              unit="%"
              label="Box opacity"
              onChange={(v, final) => onChange({ boxOpacity: v }, final)}
            />
          </>
        )}
        <span className="field__label">Shadow</span>
        <Scrub value={style.shadow} min={0} max={30} step={0.5} label="Shadow" onChange={(v, final) => onChange({ shadow: v }, final)} />
      </div>
      <div className="insp__row">
        <span className="field__label">Place</span>
        <Choice
          value={style.position}
          options={[
            ['bottom', 'Bottom'],
            ['middle', 'Middle'],
            ['top', 'Top'],
          ]}
          onChange={(v) => onChange({ position: v }, true)}
          label="Place"
        />
        <span className="field__label">From the edge</span>
        <Scrub value={style.margin} min={0} max={40} step={0.5} unit="%" label="From the edge" onChange={(v, final) => onChange({ margin: v }, final)} />
      </div>
      <div className="insp__row">
        <span className="field__label">Letters a line</span>
        <Scrub
          value={style.lineChars}
          min={12}
          max={80}
          step={1}
          label="Letters a line"
          onChange={(v, final) => onChange({ lineChars: Math.round(v) }, final)}
        />
        <span className="field__label">Lines</span>
        <Choice
          value={style.lines}
          options={[
            [1, '1'],
            [2, '2'],
            [3, '3'],
          ]}
          onChange={(v) => onChange({ lines: v }, true)}
          label="Lines a caption"
        />
      </div>
      <p className="insp__note">Letters and lines decide where new captions break when they are made from the transcript.</p>
    </Section>
  );
}
