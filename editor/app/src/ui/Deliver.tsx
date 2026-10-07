// Delivery: the export window (presets for every destination, codec and
// encoder settings, range, chapters, captions) and the render queue that
// makes the exports in the background.
import {
  ArrowDown,
  AudioLines,
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Globe,
  HardDrive,
  Image,
  ListPlus,
  Settings2,
  Smartphone,
  Tv,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { duration, timecode } from '../model/build';
import { captionTracks } from '../model/captions';
import { rate } from '../model/seq';
import { selectedIds, useDoc, type Doc } from '../doc';
import { chaptersFrom, youtubeChapters } from '../export/chapters';
import { estimateMb, planDelivery, planStems, rangeFor, reframeHint, type RangeKind } from '../export/deliver';
import { STEM_NAMES, stemsIn } from '../export/loudness';
import { openSmart } from '../smart/open';
import { hardwareName } from '../export/encoders';
import {
  allPresets,
  deletePreset,
  extensionOf,
  GROUP_NAMES,
  presetProblems,
  savePreset,
  type AudioCodec,
  type Container,
  type DeliveryPreset,
  type DnxhrProfile,
  type PresetGroup,
  type ProresProfile,
  type VideoCodec,
  type VideoSpec,
} from '../export/presets';

const GROUP_ICONS: Record<PresetGroup, LucideIcon> = {
  web: Globe,
  social: Smartphone,
  broadcast: Tv,
  master: HardDrive,
  audio: AudioLines,
  image: Image,
  custom: Bookmark,
};
import { isActive, isFinished, overall, type QueueJob } from '../export/queue';
import { renderQueue, useQueue } from '../export/renderQueue';
import { manageNative } from '../manage/native';
import { folderOf, inApp, joinPath, native } from '../native';
import { Choice, Modal } from './controls';
import { panels } from './panels';
import type { Ui } from './state';
import './delivery.css';

let encoderList: Promise<string[]> | null = null;
/** The encoders that work here (asked once; trying hardware encoders takes a moment). */
export function encodersHere(): Promise<string[]> {
  if (!inApp()) return Promise.resolve([]);
  encoderList ??= manageNative.encoders().catch(() => []);
  return encoderList;
}

const CODECS: [VideoCodec, string][] = [
  ['h264', 'H.264'],
  ['hevc', 'H.265 / HEVC'],
  ['prores', 'ProRes'],
  ['dnxhr', 'DNxHR'],
  ['png', 'PNG frames'],
  ['gif', 'GIF'],
];
const CONTAINER_FOR: Record<VideoCodec, Container> = { h264: 'mp4', hevc: 'mp4', prores: 'mov', dnxhr: 'mov', png: 'png', gif: 'gif' };

function withCodec(p: DeliveryPreset, codec: VideoCodec): DeliveryPreset {
  const v = p.video as VideoSpec;
  const alpha = codec === 'png' || (codec === 'prores' && (v.prores === '4444' || v.prores === '4444xq')) ? v.alpha : false;
  const image = codec === 'png' || codec === 'gif';
  return {
    ...p,
    container: codec === 'h264' || codec === 'hevc' ? (p.container === 'mov' ? 'mov' : 'mp4') : CONTAINER_FOR[codec],
    video: {
      ...v,
      codec,
      alpha,
      bitDepth: codec === 'h264' ? 8 : codec === 'prores' ? 10 : v.bitDepth,
      prores: v.prores ?? 'hq',
      dnxhr: v.dnxhr ?? 'hq',
      hardware: codec === 'h264' || codec === 'hevc' ? v.hardware : 'software',
    },
    audio: image ? null : codec === 'prores' || codec === 'dnxhr' ? { codec: 'pcm24', kbps: 0 } : (p.audio ?? { codec: 'aac', kbps: 256 }),
  };
}

export function DeliverDialog({ doc, ui }: { doc: Doc; ui: Ui }) {
  const { project, selection } = useDoc(doc);
  const [presets, setPresets] = useState(allPresets);
  const [presetId, setPresetId] = useState('match');
  const [p, setP] = useState<DeliveryPreset>(() => presets[0] as DeliveryPreset);
  const [seqId, setSeqId] = useState(project.open);
  const s = project.sequences.find((x) => x.id === seqId) ?? project.sequences[0];
  const sel = selectedIds(selection);
  const marked = !!s && (s.inPoint !== null || s.outPoint !== null);
  const [what, setWhat] = useState<RangeKind>(marked ? 'marked' : 'all');
  const [chapters, setChapters] = useState(true);
  const hasCaptions = !!s && captionTracks(s).some((t) => s.clips.some((c) => c.track === t.id));
  const [burn, setBurn] = useState(true);
  const [embed, setEmbed] = useState(false);
  const [sidecar, setSidecar] = useState(false);
  const [toLumora, setToLumora] = useState(false);
  const [stems, setStems] = useState(false);
  const [thumbAt, setThumbAt] = useState<number | null>(null);
  const [settings, setSettings] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [encoders, setEncoders] = useState<string[] | null>(inApp() ? null : []);
  const folder = project.eventPath ? folderOf(project.eventPath) : '';
  const [out, setOut] = useState(joinPath(folder || (inApp() ? '' : 'C:/Users/You/Videos'), `${project.name || 'Film'} (edited).mp4`));
  const [problem, setProblem] = useState('');
  const close = () => ui.set({ dialog: null });

  useEffect(() => {
    let live = true;
    void encodersHere().then((e) => live && setEncoders(e));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const next = presets.find((x) => x.id === presetId);
    if (!next) return;
    setP(next);
    setToLumora(!!next.toLumora);
  }, [presetId, presets]);

  useEffect(() => {
    setOut((o) => o.replace(/(_%0\dd)?\.[a-z0-9]+$/i, `.${extensionOf(p)}`));
  }, [p]);

  if (!s) return null;
  const fps = rate(s);
  const range = rangeFor(s, what, sel);
  const seconds = Math.max(0, (range.to - range.from) / fps);
  const v = p.video;
  const problems = presetProblems(p);
  const chapterList = chaptersFrom(s.markers, fps, range);
  const stemKinds = p.audio ? stemsIn(s, range) : [];
  const reframe = reframeHint(project, s.id, p);
  const markersIn = s.markers.filter((m) => m.at >= range.from && m.at < range.to).sort((a, b) => a.at - b.at);
  const plan = (() => {
    if (problems.length || encoders === null) return null;
    try {
      return planDelivery(project, {
        preset: p,
        seq: s.id,
        range,
        out,
        chapters,
        captions: { burn, embed, sidecar },
        encoders,
        app: inApp(),
        thumbnailAt: thumbAt,
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  })();
  const mb = estimateMb(p, s, seconds);
  const groups = [...new Set(presets.map((x) => x.group))] as PresetGroup[];
  const setVideo = (change: Partial<VideoSpec>) => v && setP({ ...p, video: { ...v, ...change } });

  const queue = async (andShow: boolean) => {
    setProblem('');
    let target = out;
    if (inApp() && !/[\\/]/.test(out)) {
      const picked = await save({ title: 'Export to', defaultPath: out, filters: [{ name: p.name, extensions: [extensionOf(p)] }] });
      if (!picked) return;
      target = picked;
      setOut(picked);
    }
    try {
      const req = {
        preset: p,
        seq: s.id,
        range,
        out: target,
        chapters,
        captions: { burn, embed, sidecar },
        encoders: encoders ?? [],
        app: inApp(),
        thumbnailAt: thumbAt,
      };
      const made = planDelivery(doc.project, req);
      // Stems are planned before the film is queued, so a problem stops both.
      const stemPlans = stems && stemKinds.length ? planStems(doc.project, req) : [];
      renderQueue.add(made, s.name, p.name, toLumora && !!v);
      for (const x of stemPlans) renderQueue.add(x.plan, s.name, x.name);
      ui.note(`${s.name} · ${p.name} is in the render queue`);
      close();
      if (andShow) panels.show({ kind: 'queue' });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title="Export" onClose={close} wide>
      <div className="form dlv">
        <div className="dlv__presets" role="listbox" aria-label="Presets">
          {groups.map((g) => (
            <div key={g} className="dlv__group">
              <span className="dlv__gname">
                {(() => {
                  const Icon = GROUP_ICONS[g];
                  return <Icon />;
                })()}
                {GROUP_NAMES[g]}
              </span>
              {presets
                .filter((x) => x.group === g)
                .map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="option"
                    aria-selected={presetId === x.id}
                    className={`fchip${presetId === x.id ? ' is-on' : ''}`}
                    title={x.note}
                    onClick={() => setPresetId(x.id)}
                  >
                    {x.name}
                    {x.group === 'custom' && presetId === x.id && (
                      <span
                        className="dlv__del"
                        role="button"
                        aria-label={`Delete preset ${x.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPresets([...allPresets().filter((y) => y.group !== 'custom'), ...deletePreset(x.id)]);
                          setPresetId('match');
                        }}
                      >
                        <X />
                      </span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </div>
        <p className="dlv__note">{p.note}</p>
        {project.sequences.length > 1 && (
          <label className="form__row">
            <span>Sequence</span>
            <select className="text" value={s.id} onChange={(e) => setSeqId(e.target.value)}>
              {project.sequences.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form__row">
          <span>Range</span>
          <Choice
            value={what}
            options={[
              ['all', 'Whole sequence'],
              ['marked', marked ? 'In to out' : 'In to out (mark first)'],
              ['selected', sel.length ? 'Selected clips' : 'Selected clips (none)'],
            ]}
            onChange={(x) => (x !== 'marked' || marked) && (x !== 'selected' || sel.length) && setWhat(x)}
            label="Range"
          />
        </div>
        <button type="button" className="linkbtn dlv__more" aria-expanded={settings} onClick={() => setSettings(!settings)}>
          {settings ? <ChevronDown /> : <ChevronRight />}
          <Settings2 />
          Settings: {describe(p, s)}
        </button>
        {settings && <PresetSettings p={p} setP={setP} setVideo={setVideo} seqHeight={s.height} />}
        {(p.container === 'mp4' || p.container === 'mov' || p.container === 'm4a') && (
          <label className="check form__check" title={chapterList.length ? youtubeChapters(chapterList) : 'Add markers to make chapters'}>
            <input type="checkbox" checked={chapters} onChange={(e) => setChapters(e.target.checked)} /> Chapters from markers
            {chapterList.length ? ` (${chapterList.length})` : ' (no markers in the range)'}
            {chapters && chapterList.length > 0 && (
              <button type="button" className="linkbtn dlv__copy" onClick={() => void navigator.clipboard?.writeText(youtubeChapters(chapterList))}>
                Copy for YouTube
              </button>
            )}
          </label>
        )}
        {hasCaptions && v && (
          <label className="check form__check">
            <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} /> Burn the captions into the picture
          </label>
        )}
        {hasCaptions && v && (p.container === 'mp4' || p.container === 'mov') && (
          <label className="check form__check">
            <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} /> Put the captions in the file (a subtitle track viewers can
            turn on)
          </label>
        )}
        {hasCaptions && (
          <label className="check form__check">
            <input type="checkbox" checked={sidecar} onChange={(e) => setSidecar(e.target.checked)} /> Also save the captions as .srt and .vtt next to it
          </label>
        )}
        {v && p.container === 'mp4' && (
          <label className="check form__check">
            <input type="checkbox" checked={toLumora} onChange={(e) => setToLumora(e.target.checked)} /> Put it in Lumora’s library, ready to show live
          </label>
        )}
        {reframe && (
          <p className="dlv__hint">
            {reframe.ready ? (
              <>
                This crops the wide picture to the middle. There is a reframed version that follows the people: “{reframe.ready.name}”.{' '}
                <button type="button" className="linkbtn" onClick={() => reframe.ready && setSeqId(reframe.ready.id)}>
                  Export that one
                </button>
              </>
            ) : (
              <>
                This crops the wide picture to the middle.{' '}
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    close();
                    openSmart('reframe', reframe.aspect);
                  }}
                >
                  Auto reframe to {reframe.aspect}…
                </button>{' '}
                makes a version that follows the people in it.
              </>
            )}
          </p>
        )}
        {stemKinds.length > 0 && (
          <label className="check form__check" title="One 24-bit WAV for each, as long as the film, so they line up and add up to the mix">
            <input type="checkbox" checked={stems} onChange={(e) => setStems(e.target.checked)} /> Also save stems:{' '}
            {stemKinds.map((k) => STEM_NAMES[k]).join(', ')} (WAV)
          </label>
        )}
        {v && p.container !== 'png' && p.container !== 'gif' && (
          <label className="form__row">
            <span>Thumbnail</span>
            <select
              className="text"
              aria-label="Thumbnail from a marker"
              value={thumbAt ?? ''}
              onChange={(e) => setThumbAt(e.target.value === '' ? null : Number(e.target.value))}
              disabled={!markersIn.length}
            >
              <option value="">{markersIn.length ? 'None' : 'None (add a marker on the frame you want)'}</option>
              {markersIn.map((m) => (
                <option key={m.id} value={m.at}>
                  At marker “{m.name || 'Marker'}” ({timecode(m.at, s.fps)})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="form__row">
          <span>Save as</span>
          <input className="text" value={out} onChange={(e) => setOut(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <p className="dlv__enc">
          {encoders === null
            ? 'Checking this computer’s encoders…'
            : typeof plan === 'string'
              ? plan
              : plan?.engine === 'ffmpeg' && plan.encoder
                ? `Encoder: ${plan.encoder.hardware ? hardwareName(plan.encoder.name) : 'software'} (${plan.encoder.name})`
                : plan?.engine === 'webcodecs'
                  ? 'Encoder: this computer’s built-in H.264 encoder'
                  : plan?.engine === 'none'
                    ? 'Sound only'
                    : ''}
          {plan && typeof plan !== 'string' && plan.notes.length > 0 && ` · ${plan.notes.join(' ')}`}
        </p>
        {[...problems, ...(problem ? [problem] : [])].map((x) => (
          <p key={x} className="form__problem">
            {x}
          </p>
        ))}
        <div className="form__foot">
          <span className="form__est">
            {duration(seconds)} · about {mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`}
          </span>
          {naming === null ? (
            <button type="button" className="btn" disabled={problems.length > 0} onClick={() => setNaming(p.group === 'custom' ? p.name : `${p.name} (mine)`)}>
              <BookmarkPlus />
              Save preset…
            </button>
          ) : (
            <span className="dlv__name">
              <input
                className="text"
                autoFocus
                aria-label="Preset name"
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.currentTarget.nextSibling as HTMLButtonElement | null)?.click();
                  if (e.key === 'Escape') setNaming(null);
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const list = savePreset({ ...p, name: naming.trim() || p.name, id: p.group === 'custom' ? p.id : 'new' });
                  const mine = list[list.length - 1];
                  setPresets([...allPresets().filter((y) => y.group !== 'custom'), ...list]);
                  if (mine) setPresetId(mine.id);
                  setNaming(null);
                }}
              >
                Save
              </button>
            </span>
          )}
          <button type="button" className="btn" disabled={seconds <= 0 || problems.length > 0 || typeof plan === 'string'} onClick={() => void queue(false)}>
            <ListPlus />
            Add to queue
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={seconds <= 0 || problems.length > 0 || typeof plan === 'string'}
            onClick={() => void queue(true)}
          >
            <Upload />
            Export
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A preset in a few words. */
function describe(p: DeliveryPreset, s: { width: number; height: number }): string {
  const v = p.video;
  const sound = p.audio
    ? p.audio.codec === 'pcm24'
      ? '24-bit PCM'
      : p.audio.codec === 'pcm16'
        ? '16-bit PCM'
        : `${p.audio.codec.toUpperCase()} ${p.audio.kbps} kb/s`
    : '';
  const loud = p.loudness !== null ? `${p.loudness} LUFS` : '';
  if (!v) return [sound, loud, `.${p.container}`].filter(Boolean).join(' · ');
  const w = v.width ?? (v.height ? Math.round((v.height * s.width) / s.height) : s.width);
  const h = v.height ?? (v.width ? Math.round((v.width * s.height) / s.width) : s.height);
  const codec =
    v.codec === 'prores'
      ? `ProRes ${v.prores === 'hq' ? '422 HQ' : (v.prores ?? '').toUpperCase()}`
      : v.codec === 'dnxhr'
        ? `DNxHR ${(v.dnxhr ?? '').toUpperCase()}`
        : (CODECS.find((c) => c[0] === v.codec)?.[1] ?? v.codec);
  const r =
    v.codec === 'h264' || v.codec === 'hevc' ? (v.rate.mode === 'quality' ? `quality ${v.rate.q}` : `${v.rate.mode.toUpperCase()} ${v.rate.mbps} Mb/s`) : '';
  return [codec, `${w}×${h}`, v.bitDepth === 10 ? '10-bit' : '', v.alpha ? 'alpha' : '', r, sound, loud, `.${p.container}`].filter(Boolean).join(' · ');
}

function PresetSettings({
  p,
  setP,
  setVideo,
  seqHeight,
}: {
  p: DeliveryPreset;
  setP: (p: DeliveryPreset) => void;
  setVideo: (v: Partial<VideoSpec>) => void;
  seqHeight: number;
}) {
  const v = p.video;
  const sizes: [string, string][] = [
    ['seq', `Sequence (${seqHeight}p)`],
    ['2160', '2160p'],
    ['1440', '1440p'],
    ['1080', '1080p'],
    ['720', '720p'],
    ['v1080', '1080×1920 vertical'],
    ['sq1080', '1080×1080 square'],
  ];
  const sizeKey = !v
    ? 'seq'
    : v.width === 1080 && v.height === 1920
      ? 'v1080'
      : v.width === 1080 && v.height === 1080
        ? 'sq1080'
        : v.width === null && v.height
          ? String(v.height)
          : 'seq';
  return (
    <div className="dlv__settings">
      <div className="form__row">
        <span>Make</span>
        <Choice
          value={v ? 'video' : 'sound'}
          options={[
            ['video', 'Picture and sound'],
            ['sound', 'Sound only'],
          ]}
          onChange={(k) =>
            k === 'sound'
              ? setP({ ...p, video: null, container: 'wav', audio: { codec: 'pcm24', kbps: 0 } })
              : setP({
                  ...p,
                  container: 'mp4',
                  audio: { codec: 'aac', kbps: 256 },
                  video: {
                    codec: 'h264',
                    width: null,
                    height: null,
                    fit: 'fit',
                    fps: null,
                    rate: { mode: 'quality', q: 80 },
                    bitDepth: 8,
                    alpha: false,
                    hardware: 'auto',
                  },
                })
          }
          label="Make"
        />
      </div>
      {v && (
        <>
          <div className="form__row">
            <span>Codec</span>
            <Choice value={v.codec} options={CODECS} onChange={(c) => setP(withCodec(p, c))} label="Codec" />
          </div>
          {v.codec === 'prores' && (
            <div className="form__row">
              <span>ProRes</span>
              <Choice<ProresProfile>
                value={v.prores ?? 'hq'}
                options={[
                  ['proxy', 'Proxy'],
                  ['lt', 'LT'],
                  ['standard', '422'],
                  ['hq', '422 HQ'],
                  ['4444', '4444'],
                  ['4444xq', '4444 XQ'],
                ]}
                onChange={(x) => setVideo({ prores: x, alpha: x === '4444' || x === '4444xq' ? v.alpha : false })}
                label="ProRes profile"
              />
            </div>
          )}
          {v.codec === 'dnxhr' && (
            <div className="form__row">
              <span>DNxHR</span>
              <Choice<DnxhrProfile>
                value={v.dnxhr ?? 'hq'}
                options={[
                  ['lb', 'LB'],
                  ['sq', 'SQ'],
                  ['hq', 'HQ'],
                  ['hqx', 'HQX 10-bit'],
                  ['444', '444'],
                ]}
                onChange={(x) => setVideo({ dnxhr: x })}
                label="DNxHR profile"
              />
            </div>
          )}
          {(v.codec === 'h264' || v.codec === 'hevc') && (
            <div className="form__row">
              <span>File</span>
              <Choice<Container>
                value={p.container}
                options={[
                  ['mp4', '.mp4'],
                  ['mov', '.mov'],
                ]}
                onChange={(c) => setP({ ...p, container: c, audio: c === 'mp4' && p.audio?.codec.startsWith('pcm') ? { codec: 'aac', kbps: 256 } : p.audio })}
                label="File type"
              />
            </div>
          )}
          <div className="form__row">
            <span>Size</span>
            <select
              className="text"
              value={sizeKey}
              onChange={(e) => {
                const k = e.target.value;
                if (k === 'seq') setVideo({ width: null, height: null });
                else if (k === 'v1080') setVideo({ width: 1080, height: 1920 });
                else if (k === 'sq1080') setVideo({ width: 1080, height: 1080 });
                else setVideo({ width: null, height: Number(k) });
              }}
            >
              {sizes.map(([k, name]) => (
                <option key={k} value={k}>
                  {name}
                </option>
              ))}
            </select>
            {v.width !== null && v.height !== null && (
              <Choice
                value={v.fit}
                options={[
                  ['fit', 'Fit (bars)'],
                  ['fill', 'Fill (crop)'],
                ]}
                onChange={(fit) => setVideo({ fit })}
                label="Fit"
              />
            )}
          </div>
          {(v.codec === 'h264' || v.codec === 'hevc') && (
            <>
              <div className="form__row">
                <span>Rate</span>
                <Choice
                  value={v.rate.mode}
                  options={[
                    ['quality', 'Quality'],
                    ['vbr', 'Variable bit rate'],
                    ['cbr', 'Constant bit rate'],
                  ]}
                  onChange={(mode) => setVideo({ rate: mode === 'quality' ? { mode, q: 80 } : { mode, mbps: v.rate.mode === 'quality' ? 12 : v.rate.mbps } })}
                  label="Rate control"
                />
                {v.rate.mode === 'quality' ? (
                  <input
                    type="range"
                    min={30}
                    max={100}
                    value={v.rate.q}
                    aria-label="Quality"
                    title={`Quality ${v.rate.q}`}
                    onChange={(e) => setVideo({ rate: { mode: 'quality', q: Number(e.target.value) } })}
                  />
                ) : (
                  <span className="form__pair">
                    <input
                      className="text text--num"
                      type="number"
                      min={1}
                      max={400}
                      value={v.rate.mbps}
                      aria-label="Megabits a second"
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => setVideo({ rate: { mode: v.rate.mode === 'cbr' ? 'cbr' : 'vbr', mbps: Math.max(1, Number(e.target.value) || 1) } })}
                    />
                    Mb/s
                  </span>
                )}
              </div>
              <div className="form__row">
                <span>Encoder</span>
                <Choice
                  value={v.hardware}
                  options={[
                    ['auto', 'Graphics card when there is one'],
                    ['software', 'Software'],
                    ['hardware', 'Graphics card'],
                  ]}
                  onChange={(hardware) => setVideo({ hardware })}
                  label="Encoder"
                />
              </div>
            </>
          )}
          <div className="form__row">
            <span>Color</span>
            {v.codec === 'hevc' && (
              <Choice<8 | 10>
                value={v.bitDepth}
                options={[
                  [8, '8-bit'],
                  [10, '10-bit'],
                ]}
                onChange={(bitDepth) => setVideo({ bitDepth })}
                label="Bit depth"
              />
            )}
            {(v.codec === 'png' || (v.codec === 'prores' && (v.prores === '4444' || v.prores === '4444xq'))) && (
              <label className="check">
                <input type="checkbox" checked={v.alpha} onChange={(e) => setVideo({ alpha: e.target.checked })} /> Keep transparency (alpha)
              </label>
            )}
            {v.codec === 'gif' && (
              <span className="form__pair">
                <input
                  className="text text--num"
                  type="number"
                  min={5}
                  max={30}
                  value={v.fps ?? 15}
                  aria-label="Frames a second"
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => setVideo({ fps: Math.max(5, Math.min(30, Number(e.target.value) || 15)) })}
                />
                frames a second
              </span>
            )}
          </div>
        </>
      )}
      {p.audio && (
        <div className="form__row">
          <span>Sound</span>
          <Choice<AudioCodec>
            value={p.audio.codec}
            options={(v
              ? p.container === 'mov'
                ? (['aac', 'pcm16', 'pcm24'] as AudioCodec[])
                : (['aac'] as AudioCodec[])
              : (['aac', 'mp3', 'pcm16', 'pcm24'] as AudioCodec[])
            ).map((c) => [c, c === 'aac' ? 'AAC' : c === 'mp3' ? 'MP3' : c === 'pcm16' ? 'WAV 16-bit' : 'WAV 24-bit'])}
            onChange={(codec) =>
              setP({
                ...p,
                audio: { codec, kbps: codec === 'mp3' ? 320 : codec === 'aac' ? 256 : 0 },
                container: v ? p.container : codec === 'mp3' ? 'mp3' : codec === 'aac' ? 'm4a' : 'wav',
              })
            }
            label="Sound codec"
          />
          {(p.audio.codec === 'aac' || p.audio.codec === 'mp3') && (
            <select
              className="text"
              value={p.audio.kbps}
              aria-label="Sound bit rate"
              onChange={(e) => p.audio && setP({ ...p, audio: { ...p.audio, kbps: Number(e.target.value) } })}
            >
              {[128, 192, 256, 320].map((k) => (
                <option key={k} value={k}>
                  {k} kb/s
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {p.audio && (
        <div className="form__row">
          <span>Loudness</span>
          <Choice<string>
            value={p.loudness === null ? 'off' : String(p.loudness)}
            options={[
              ['off', 'As mixed'],
              ['-14', '−14 LUFS (web)'],
              ['-16', '−16 LUFS (podcasts)'],
              ['-23', '−23 LUFS (broadcast)'],
              ['-24', '−24 LUFS (ATSC)'],
            ]}
            onChange={(x) => setP({ ...p, loudness: x === 'off' ? null : Number(x), truePeak: Number(x) <= -23 ? -2 : -1 })}
            label="Loudness"
          />
        </div>
      )}
    </div>
  );
}

const STATUS: Record<QueueJob['status'], string> = {
  queued: 'Waiting',
  running: 'Exporting',
  paused: 'Paused',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
};

/** The render queue: every export, with progress, pause, cancel and “show in folder”. */
export function QueuePanel({ onClose }: { onClose: () => void }) {
  const q = useQueue();
  const all = overall(q);
  return (
    <Modal title="Render queue" onClose={onClose} wide>
      <div className="rq">
        <div className="rq__bar">
          <span>
            {q.jobs.length === 0
              ? 'Nothing is queued. Choose Export… and Add to queue.'
              : all.left
                ? `${all.left} to go · ${Math.round(all.done * 100)}% of everything`
                : 'Everything is done.'}
          </span>
          <span className="ed__fill" />
          <button type="button" className="btn btn--sm" onClick={() => renderQueue.hold(!q.holding)} title="Waiting exports don't start while held">
            {q.holding ? 'Start the queue' : 'Hold the queue'}
          </button>
          <button type="button" className="btn btn--sm" disabled={!q.jobs.some(isFinished)} onClick={() => renderQueue.clearFinished()}>
            Clear finished
          </button>
        </div>
        <ul className="rq__list">
          {q.jobs.map((j, i) => (
            <li key={j.id} className={`rq__job is-${j.status}`}>
              <div className="rq__head">
                <b>{j.name}</b>
                <span className="rq__preset">{j.preset}</span>
                <span className="ed__fill" />
                <span className="rq__status">{STATUS[j.status]}</span>
              </div>
              <div className="expo__bar" aria-label={`${Math.round(j.done * 100)}%`}>
                <i style={{ width: `${Math.round(j.done * 100)}%` }} />
              </div>
              <div className="rq__foot">
                <span className="rq__msg" title={j.out}>
                  {j.message}
                  {j.left !== null && isActive(j) ? ` · about ${duration(j.left)} left` : ''}
                </span>
                <span className="ed__fill" />
                {j.status === 'queued' && (
                  <>
                    <button type="button" className="tbtn" aria-label="Earlier" disabled={i === 0} onClick={() => renderQueue.move(j.id, -1)}>
                      ↑
                    </button>
                    <button type="button" className="tbtn" aria-label="Later" disabled={i === q.jobs.length - 1} onClick={() => renderQueue.move(j.id, 1)}>
                      <ArrowDown />
                    </button>
                  </>
                )}
                {j.status === 'running' && (
                  <button type="button" className="btn btn--sm" onClick={() => renderQueue.pause(j.id)}>
                    Pause
                  </button>
                )}
                {j.status === 'paused' && (
                  <button type="button" className="btn btn--sm" onClick={() => renderQueue.resume(j.id)}>
                    Resume
                  </button>
                )}
                {(j.status === 'queued' || isActive(j)) && (
                  <button type="button" className="btn btn--sm" onClick={() => renderQueue.cancel(j.id)}>
                    Cancel
                  </button>
                )}
                {(j.status === 'failed' || j.status === 'canceled') && (
                  <button type="button" className="btn btn--sm" onClick={() => renderQueue.retry(j.id)}>
                    Try again
                  </button>
                )}
                {j.status === 'done' && j.path && inApp() && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => j.path && void native.reveal(j.path.replace(/_%0\dd(\.[a-z0-9]+)$/i, '_00000$1'))}
                  >
                    Open folder
                  </button>
                )}
                {isFinished(j) && (
                  <button type="button" className="tbtn" aria-label="Take off the list" onClick={() => renderQueue.remove(j.id)}>
                    <X />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** In the top bar while exports are being made: how far along, and a way to the queue. Says when each is done. */
export function QueueChip({ ui }: { ui: Ui }) {
  const q = useQueue();
  useEffect(() => {
    renderQueue.onFinished = (j) => ui.note(j.status === 'done' ? `Exported: ${j.name} · ${j.preset}` : `Export failed: ${j.message}`);
    return () => {
      renderQueue.onFinished = () => {};
    };
  }, [ui]);
  const all = useMemo(() => overall(q), [q]);
  if (!all.left && !q.jobs.some((j) => j.status === 'failed')) return null;
  const active = all.active;
  return (
    <button
      type="button"
      className={`rq-chip${q.jobs.some((j) => j.status === 'failed') ? ' is-bad' : ''}`}
      onClick={() => panels.show({ kind: 'queue' })}
      title="Render queue"
    >
      <i style={{ width: `${Math.round(all.done * 100)}%` }} />
      <span>
        {active
          ? `${active.status === 'paused' ? 'Paused' : 'Exporting'} ${Math.round(active.done * 100)}%`
          : all.left
            ? `${all.left} waiting`
            : 'Export failed'}
        {all.left > 1 ? ` · ${all.left - (active ? 1 : 0)} more` : ''}
      </span>
    </button>
  );
}
