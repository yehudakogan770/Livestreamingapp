import { defaultFundraiser, defaultRaffle } from '../engine/audience';
import { defaultWall } from '../engine/wall';
import { defaultAuction } from '../engine/auction';
import { defaultScripture } from '../engine/tanach';
import { defaultTrivia } from '../engine/trivia';
import { defaultSeating } from '../engine/seating';
import { fromTemplate } from '../engine/graphic';
import { newRoom } from '../engine/guest';
import { defaultPoll } from '../engine/poll';
import { defaultLyrics, sections } from '../engine/lyrics';
import { CapturePicker } from './CapturePicker';
import type { ScreenCapture } from '../engine/types/ScreenCapture';
import { defaultFilters } from '../engine/audio';
import { defaultScoreboard } from '../engine/score';
import { cleanStreamUrl, streamName } from '../engine/stream';
import { cleanUrl, defaultBrowser } from '../engine/browser';
import { sendCommand } from './commands';
import { useEffect, useState } from 'react';
import { defaultCountdown, type EngineClient } from '../engine/client';
import { defaultAdjust, defaultAutoFrame, defaultBackground, defaultKey } from '../engine/chroma';
import type { NewSource } from '../engine/types/NewSource';
import type { SourceKind } from '../engine/types/SourceKind';
import type { Source } from '../engine/types/Source';
import { SourceView } from '../components/SourceView';
import { defaultPesukim } from '../engine/pesukim';
import type { ScreenId } from '../engine/types/ScreenId';
import { JEWISH_KINDS, jewishToolsOn } from '../engine/jewishTools';
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
  { kind: 'color', name: 'Color', hint: 'A solid color' },
  { kind: 'pattern', name: 'Test pattern', hint: 'Color bars for setup' },
  { kind: 'countdown', name: 'Countdown', hint: 'The show countdown, big' },
  { kind: 'pesukim', name: '12 Pesukim', hint: 'One word at a time, the crowd repeats' },
  { kind: 'text', name: 'Text / title', hint: 'Lower third, title, ticker, message' },
  { kind: 'credits', name: 'Credits / thank-you', hint: 'Rolling names at the end' },
  { kind: 'split', name: 'Split screen', hint: '2 – 4 inputs at once, picture-in-picture' },
  { kind: 'slideshow', name: 'Slideshow', hint: 'Pictures, PDF, videos between slides' },
  { kind: 'stream', name: 'Stream / IP / NDI camera', hint: 'NDI, SRT, RTMP, RTSP camera, HLS link…' },
  { kind: 'raffle', name: 'Raffle', hint: 'People enter from their phones; the draw is on screen' },
  { kind: 'fundraiser', name: 'Fundraiser', hint: 'Goal, total and donors on screen; pledges from phones' },
  { kind: 'graphic', name: 'Designed title', hint: 'Your own title: text, boxes and pictures anywhere (the title designer)' },
  { kind: 'seating', name: 'Table finder', hint: 'Guests type their name on their phone and see their table' },
  { kind: 'trivia', name: 'Trivia game', hint: 'Questions on screen, answers from phones, a leaderboard' },
  { kind: 'scripture', name: 'Tanach & Tehillim', hint: 'Any passage, a verse at a time, Hebrew and English (offline)' },
  { kind: 'zmanim', name: 'Hebrew date & zmanim', hint: 'Today’s zmanim, candle lighting countdown, the Hebrew date' },
  { kind: 'auction', name: 'Live auction', hint: 'Items, bids from phones or the room, the highest bid on screen' },
  { kind: 'wall', name: 'Messages wall', hint: 'Messages, dedications and photos from phones, on screen' },
  { kind: 'guest', name: 'Guest by link', hint: 'Someone joins from their phone or computer, anywhere' },
  { kind: 'comment', name: 'Chat comments', hint: 'Comments from the YouTube or Twitch live chat, on screen' },
  { kind: 'poll', name: 'Audience poll', hint: 'People vote from their phones; live results on screen' },
  { kind: 'lyrics', name: 'Song lyrics', hint: 'The words of a song, a verse at a time' },
  { kind: 'screen', name: 'Screen capture', hint: 'A display or one window of this computer' },
  { kind: 'scoreboard', name: 'Scoreboard', hint: 'Teams, scores, period and game clock' },
  { kind: 'browser', name: 'Web page', hint: 'A website: scores, live results, social wall…' },
  { kind: 'logo3d', name: '3D logo', hint: 'Your logo in 3D, turning (the logo maker)' },
  { kind: 'visuals', name: 'Stage visuals', hint: 'Music visuals on the beat, for the Back Screen' },
  { kind: 'microphone', name: 'Microphone', hint: 'Mic, sound desk or line in' },
  { kind: 'sound', name: 'Sound / music file', hint: 'MP3, WAV… music and effects' },
];

/** What each input is for: the list is shown in these groups. */
const GROUPS: { name: string; kinds: Kind[] }[] = [
  { name: 'Cameras and people', kinds: ['camera', 'stream', 'guest', 'screen'] },
  { name: 'Videos, pictures and slides', kinds: ['video', 'image', 'slideshow', 'browser', 'color', 'pattern'] },
  { name: 'Text and titles', kinds: ['text', 'graphic', 'credits', 'lyrics', 'countdown', 'scoreboard', 'comment', 'pesukim', 'scripture', 'zmanim'] },
  { name: 'The audience’s phones', kinds: ['poll', 'raffle', 'trivia', 'wall', 'fundraiser', 'auction', 'seating'] },
  { name: 'Layouts and visuals', kinds: ['split', 'visuals', 'logo3d'] },
  { name: 'Sound', kinds: ['microphone', 'sound'] },
];

/** For each screen: the best inputs for it (shown first), then the groups in the order that suits it. */
const FOR_SCREEN: Record<ScreenId, { title: string; best: Kind[]; order: number[]; note?: string }> = {
  live: { title: 'Best for the Live Screen', best: ['camera', 'text', 'countdown', 'guest', 'video', 'split'], order: [0, 2, 1, 4, 3, 5] },
  back: { title: 'Best for the Back Screen', best: ['slideshow', 'visuals', 'video', 'image', 'countdown', 'wall'], order: [1, 4, 2, 3, 0, 5] },
  monitor: {
    title: 'Goes with the Monitor',
    best: ['countdown', 'lyrics', 'text'],
    order: [2, 1, 0, 3, 4, 5],
    note: 'The Monitor shows words only (messages, the clock, the countdown, song lines). What you add here is ready for the Live and Back Screens.',
  },
};

const SWATCHES = ['#000000', '#ffffff', '#1f6f79', '#0b2545', '#3b1c32', '#c7372f', '#d4a017', '#2f8f4e'];

/** Choose what kind of input to add, set it up, and add it. */
export function AddInput({
  client,
  onAdd,
  onClose,
  sources = [],
  initialKind,
  initialTemplate,
  screen = 'live',
}: {
  client: EngineClient;
  onAdd: (source: NewSource) => void;
  onClose: () => void;
  /** Inputs already added (to put in a split screen's boxes). */
  sources?: Source[];
  /** Open on this kind (from the menu bar). */
  initialKind?: string;
  initialTemplate?: number;
  /** The screen being controlled: the inputs that suit it come first. */
  screen?: ScreenId;
}) {
  const forScreen = FOR_SCREEN[screen];
  const [kind, setKind] = useState<Kind>(() => (KINDS.some((k) => k.kind === initialKind) ? (initialKind as Kind) : forScreen.best[0]!));
  // The Jewish event tools only when switched on (Settings) or already used.
  const kinds = jewishToolsOn({ sources }) ? KINDS : KINDS.filter((k) => !JEWISH_KINDS.includes(k.kind) || k.kind === initialKind);
  // The best for this screen first, then each group (without repeating those).
  const pick = (list: Kind[]) => list.map((id) => kinds.find((k) => k.kind === id)).filter((k) => k !== undefined);
  const kindGroups = [
    { name: forScreen.title, best: true, items: pick(forScreen.best) },
    ...forScreen.order.map((g) => ({ name: GROUPS[g]!.name, best: false, items: pick(GROUPS[g]!.kinds.filter((x) => !forScreen.best.includes(x))) })),
  ].filter((sec) => sec.items.length);
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
  const [screenCap, setScreenCap] = useState<ScreenCapture | null>(null);
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
        return { name: n || 'Color', kind: { type: 'color', color } };
      case 'microphone':
        return cam ? { name: n || cam.label || 'Microphone', kind: { type: 'microphone', deviceId: cam.deviceId, label: cam.label } } : null;
      case 'sound':
        return path
          ? {
              name: n || 'Music',
              kind: { type: 'video', path, durationS: 0, playback: { playing: false, posS: 0, at: 0 } },
              looping,
              // Music and effects are heard whenever they play, not only "on air".
              audio: { follow: false, toMaster: true, toA: true, toB: true, delayMs: 0, filters: defaultFilters() },
            }
          : null;
      case 'pattern':
        return { name: n || 'Test pattern', kind: { type: 'pattern' } };
      case 'visuals':
        return { name: n || 'Stage visuals', kind: { type: 'visuals' } };
      case 'logo3d':
        // Made in the 3D logo maker.
        return null;
      case 'raffle':
        return { name: n || 'Raffle', kind: { type: 'raffle', ...defaultRaffle(), title: n || 'Raffle', prize: words.trim() } };
      case 'fundraiser': {
        const goal = Math.floor(Number(subWords.replace(/[^0-9.]/g, '')));
        return {
          name: n || 'Fundraiser',
          kind: { type: 'fundraiser', ...defaultFundraiser(), title: words.trim() || defaultFundraiser().title, goal: goal > 0 ? goal : 10_000 },
        };
      }
      case 'graphic':
        return { name: n || 'Designed title', kind: { type: 'graphic', ...fromTemplate(0) } };
      case 'seating':
        return { name: n || 'Table finder', kind: { type: 'seating', ...defaultSeating() } };
      case 'trivia':
        return { name: n || 'Trivia', kind: { type: 'trivia', ...defaultTrivia(), title: n || 'Trivia' } };
      case 'scripture':
        return { name: n || 'Tehillim', kind: { type: 'scripture', ...defaultScripture() } };
      case 'zmanim':
        return { name: n || 'Zmanim', kind: { type: 'zmanim', style: 'card' } };
      case 'auction':
        return { name: n || 'Auction', kind: { type: 'auction', ...defaultAuction(), title: n || 'Live auction' } };
      case 'wall':
        return { name: n || 'Messages', kind: { type: 'wall', ...defaultWall(), title: n || 'Messages', prompt: words.trim() || defaultWall().prompt } };
      case 'guest':
        return { name: n || 'Guest', kind: { type: 'guest', room: newRoom(), reload: 0 } };
      case 'comment':
        return { name: n || 'Chat comments', kind: { type: 'comment', comment: null, changedAt: 0, place: 'low', accent: '#2f80ed' } };
      case 'poll': {
        const options = subWords
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean)
          .slice(0, 8);
        return words.trim() && options.length >= 2
          ? { name: n || words.trim().slice(0, 40), kind: { type: 'poll', ...defaultPoll(), question: words.trim(), options, votes: options.map(() => 0) } }
          : null;
      }
      case 'lyrics':
        return sections(words).length
          ? { name: n || words.trim().split('\n')[0]!.slice(0, 40), kind: { type: 'lyrics', ...defaultLyrics(), title: n, text: words } }
          : null;
      case 'screen':
        return screenCap
          ? {
              name: n || (screenCap.target.type === 'display' ? screenCap.target.name.replace(/ \(.*\)$/, '') : screenCap.target.title.slice(0, 40)),
              kind: { type: 'screen', ...screenCap },
            }
          : null;
      case 'scoreboard':
        return { name: n || 'Scoreboard', kind: { type: 'scoreboard', ...defaultScoreboard() } };
      case 'stream': {
        const url = cleanStreamUrl(words);
        return url ? { name: n || streamName(url), kind: { type: 'stream', url, bufferMs: 500 } } : null;
      }
      case 'browser': {
        const url = cleanUrl(words);
        return url ? { name: n || url.replace(/^https?:\/\//, '').split('/')[0] || 'Web page', kind: { type: 'browser', ...defaultBrowser(), url } } : null;
      }
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
        adjust: defaultAdjust(),
        background: defaultBackground(),
        autoFrame: defaultAutoFrame(),
        volume: 1,
        muted: true,
        looping: false,
        fit: 'contain' as const,
        audio: { follow: true, toMaster: true, toA: true, toB: true, delayMs: 0, filters: defaultFilters() },
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
            {forScreen.note && <p className="addinput__note">{forScreen.note}</p>}
            {kindGroups.map((sec) => [
              <h3 key={sec.name} className={`addinput__group${sec.best ? ' addinput__group--best' : ''}`}>
                {sec.name}
              </h3>,
              ...sec.items.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  className="addinput__kind"
                  title={k.hint}
                  aria-pressed={kind === k.kind}
                  onClick={() => {
                    if (k.kind === 'logo3d') {
                      // Made in its own window.
                      onClose();
                      sendCommand({ type: 'logoMaker' });
                      return;
                    }
                    setKind(k.kind);
                    setPath(null);
                    setName('');
                    setCams(null);
                    setCam(null);
                    setCamErr(null);
                  }}
                >
                  <strong>{k.name}</strong>
                </button>
              )),
            ])}
          </nav>
          <div className="addinput__setup">
            <p className="addinput__what">
              <b>{KINDS.find((k) => k.kind === kind)?.name}</b> · {KINDS.find((k) => k.kind === kind)?.hint}
            </p>
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
                <span className="field__label">{kind === 'countdown' ? 'Background' : 'Color'}</span>
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
                  <input type="color" aria-label="Any color" value={color} onChange={(e) => setColor(e.target.value)} />
                </div>
              </div>
            )}

            {kind === 'split' && <SplitPicker split={split} sources={sources} onChange={setSplit} />}
            {kind === 'slideshow' && (
              <SlideshowSetup sh={slideshow} sources={sources.filter((x) => x.kind.type !== 'slideshow')} client={client} onChange={setSlideshow} />
            )}

            {kind === 'raffle' && (
              <label className="field">
                <span className="field__label">The prize (optional; the name above is the raffle's title)</span>
                <input className="text" dir="auto" value={words} onChange={(e) => setWords(e.target.value)} aria-label="Prize" autoFocus />
              </label>
            )}
            {kind === 'wall' && (
              <label className="field">
                <span className="field__label">What people are asked on their phones</span>
                <input
                  className="text"
                  dir="auto"
                  value={words}
                  placeholder="Write a blessing for the couple"
                  onChange={(e) => setWords(e.target.value)}
                  aria-label="What people are asked"
                  autoFocus
                />
              </label>
            )}
            {kind === 'fundraiser' && (
              <>
                <label className="field">
                  <span className="field__label">What it is for (shown as the title)</span>
                  <input className="text" dir="auto" value={words} onChange={(e) => setWords(e.target.value)} aria-label="Cause" autoFocus />
                </label>
                <label className="field">
                  <span className="field__label">The goal</span>
                  <input
                    className="text"
                    inputMode="numeric"
                    value={subWords}
                    placeholder="10,000"
                    onChange={(e) => setSubWords(e.target.value)}
                    aria-label="Goal"
                  />
                </label>
              </>
            )}
            {kind === 'guest' && (
              <p className="field__note">
                Give the guest a name above. After adding, open the guest's ⋯ menu → “Guest link…” and send them the link. They open it on their phone or
                computer, allow the camera and microphone, and appear here with their sound in the mixer. This uses the internet (VDO.Ninja, free, no account),
                only while the guest input exists.
              </p>
            )}
            {kind === 'poll' && (
              <>
                <label className="field">
                  <span className="field__label">Question</span>
                  <input className="text" dir="auto" value={words} onChange={(e) => setWords(e.target.value)} aria-label="Question" autoFocus />
                </label>
                <label className="field">
                  <span className="field__label">Answers, one on each line (2 – 8)</span>
                  <textarea className="text" dir="auto" rows={5} value={subWords} onChange={(e) => setSubWords(e.target.value)} aria-label="Answers" />
                </label>
                <span className="field__note">
                  People vote from their phones on the venue Wi-Fi — the phone remote has to be on (Settings → Phone remote). The code to scan shows on screen
                  while voting is open.
                </span>
              </>
            )}
            {kind === 'lyrics' && (
              <label className="field">
                <span className="field__label">The words (a blank line starts the next slide)</span>
                <textarea
                  className="text"
                  rows={10}
                  dir="auto"
                  value={words}
                  placeholder={'Verse one, line one\nVerse one, line two\n\nChorus, line one\nChorus, line two'}
                  onChange={(e) => setWords(e.target.value)}
                  aria-label="Song words"
                  autoFocus
                />
                <span className="field__note">{sections(words).length} slides. The name above is the song's title.</span>
              </label>
            )}
            {kind === 'screen' && <CapturePicker client={client} value={screenCap} onChange={setScreenCap} />}
            {kind === 'stream' && (
              <label className="field">
                <span className="field__label">Stream address</span>
                <input
                  className="text"
                  value={words}
                  placeholder="srt://10.0.0.20:9000  ·  rtsp://camera.local/stream1  ·  https://…/live.m3u8"
                  onChange={(e) => setWords(e.target.value)}
                  aria-label="Stream address"
                  spellCheck={false}
                  autoFocus
                />
                <span className="field__note">
                  From another computer, a phone app, an encoder or an IP camera. If it needs a password, put it in the address (rtsp://name:password@…). Its
                  sound comes into the mixer.
                </span>
                <NdiPicker client={client} onPick={(name) => setWords(`ndi://${name}`)} />
              </label>
            )}
            {kind === 'browser' && (
              <label className="field">
                <span className="field__label">Web address</span>
                <input
                  className="text"
                  value={words}
                  placeholder="e.g. scores.example.com"
                  onChange={(e) => setWords(e.target.value)}
                  aria-label="Web address"
                  autoFocus
                />
                <span className="field__note">
                  The page opens in its own window, where you can click on it and log in; the screens show it live. It needs the internet (or a page on this
                  network).
                </span>
              </label>
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
                  Fonts, colors, the box and more: “Edit text…” on its tile after adding. Put it on an overlay button to show it over what is on air.
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

/** NDI sources on the network: pick one to take it in. */
function NdiPicker({ client, onPick }: { client: EngineClient; onPick: (name: string) => void }) {
  const [found, setFound] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ips, setIps] = useState('');
  const look = () => {
    setBusy(true);
    setProblem(null);
    client
      .ndiSources(ips)
      .then(setFound, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="ndi-pick">
      <div className="ndi-pick__row">
        <button type="button" className="btn" onClick={look} disabled={busy}>
          {busy ? 'Looking…' : found ? 'Look again' : 'Find NDI sources on the network'}
        </button>
        <input
          className="text"
          value={ips}
          onChange={(e) => setIps(e.target.value)}
          placeholder="Other computers’ addresses (optional)"
          aria-label="NDI computers to ask"
        />
      </div>
      {problem && <span className="field__note field__note--warn">{problem}</span>}
      {found && found.length === 0 && <span className="field__note">None found. Check the NDI device is on and on the same network.</span>}
      {found && found.length > 0 && (
        <div className="ndi-pick__list">
          {found.map((n) => (
            <button key={n} type="button" className="seg" onClick={() => onPick(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
