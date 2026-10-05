import { FundraiserCard, RaffleCard, WallCard } from './AudienceCards';
import { AuctionCard } from './AuctionCard';
import { ZmanimDialog } from './ZmanimDialog';
import { ScriptureCard } from './ScriptureCard';
import { TriviaCard } from './TriviaCard';
import { SeatingCard } from './SeatingCard';
import { GraphicCard } from './GraphicCard';
import { GuestCard } from './GuestCard';
import { PtzCard } from './PtzCard';
import { PollCard } from './PollCard';
import { LyricsCard } from './LyricsCard';
import { ScreenCard } from './ScreenCard';
import { ScoreCard } from './ScoreCard';
import { PlaylistEditor } from './PlaylistEditor';
import type { Transition } from '../engine/types/Transition';
import { transitionName } from './SwitchPanel';
import { sendCommand } from './commands';
import { useEffect, useRef, useState } from 'react';
import { isSoundFile, type EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { SourcePatch } from '../engine/types/SourcePatch';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';
import { useProblems, useReportProblem } from '../problems/problems';
import { TextEditor } from './TextEditor';
import { SplitEditor } from './SplitEditor';
import { SlideshowEditor } from './SlideshowEditor';
import { SaveToLibrary } from './LibraryDialog';
import { GreenScreenDialog } from './GreenScreenDialog';
import { InputSettings } from './InputSettings';
import { BrowserCard } from './BrowserCard';
import { StreamCard, useStreamStatus } from './StreamCard';
import { isAdjusted } from '../engine/chroma';
import { inputItem } from '../engine/library';

const KIND_NAME: Record<Source['kind']['type'], string> = {
  camera: 'Camera',
  video: 'Video',
  image: 'Picture',
  color: 'Color',
  pattern: 'Test pattern',
  microphone: 'Microphone',
  countdown: 'Countdown',
  pesukim: '12 Pesukim',
  text: 'Text',
  credits: 'Credits',
  split: 'Split screen',
  slideshow: 'Slideshow',
  visuals: 'Stage visuals',
  logo3d: '3D logo',
  browser: 'Web page',
  stream: 'Stream',
  scoreboard: 'Scoreboard',
  screen: 'Screen capture',
  lyrics: 'Song',
  poll: 'Poll',
  comment: 'Chat comment',
  guest: 'Guest',
  raffle: 'Raffle',
  fundraiser: 'Fundraiser',
  wall: 'Messages wall',
  auction: 'Auction',
  zmanim: 'Zmanim',
  scripture: 'Tanach',
  trivia: 'Trivia',
  seating: 'Table finder',
  graphic: 'Designed title',
};

/** Every input as a tile. Click lines it up next; double-click sends it straight to air. */
export function InputGrid({
  show,
  screen,
  client,
  act,
  onAdd,
  only = null,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
  act: Act;
  onAdd: () => void;
  /** Show only these inputs (the picked preset's), in this order. */
  only?: string[] | null;
}) {
  const sc = show.screens[screen];
  const problemIds = new Set(useProblems().flatMap((p) => (p.sourceId ? [p.sourceId] : [])));
  const [menu, setMenu] = useState<string | null>(null);
  // An input waiting for a second click to be removed.
  const [removing, setRemoving] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editingText = show.sources.find((x) => x.id === editing && x.kind.type === 'text');
  const editingSplit = show.sources.find((x) => x.id === editing && x.kind.type === 'split');
  const editingSlides = show.sources.find((x) => x.id === editing && x.kind.type === 'slideshow');
  const editingPage = show.sources.find((x) => x.id === editing && x.kind.type === 'browser');
  const editingStream = show.sources.find((x) => x.id === editing && x.kind.type === 'stream');
  const editingList = show.sources.find((x) => x.id === editing && x.kind.type === 'video');
  const editingScore = show.sources.find((x) => x.id === editing && x.kind.type === 'scoreboard');
  const editingScreen = show.sources.find((x) => x.id === editing && x.kind.type === 'screen');
  const editingSong = show.sources.find((x) => x.id === editing && x.kind.type === 'lyrics');
  const editingPoll = show.sources.find((x) => x.id === editing && x.kind.type === 'poll');
  const editingGuest = show.sources.find((x) => x.id === editing && x.kind.type === 'guest');
  const editingRaffle = show.sources.find((x) => x.id === editing && x.kind.type === 'raffle');
  const editingFund = show.sources.find((x) => x.id === editing && x.kind.type === 'fundraiser');
  const editingWall = show.sources.find((x) => x.id === editing && x.kind.type === 'wall');
  const editingAuction = show.sources.find((x) => x.id === editing && x.kind.type === 'auction');
  const editingZmanim = show.sources.find((x) => x.id === editing && x.kind.type === 'zmanim');
  const editingScripture = show.sources.find((x) => x.id === editing && x.kind.type === 'scripture');
  const editingTrivia = show.sources.find((x) => x.id === editing && x.kind.type === 'trivia');
  const editingSeating = show.sources.find((x) => x.id === editing && x.kind.type === 'seating');
  const editingGraphic = show.sources.find((x) => x.id === editing && x.kind.type === 'graphic');
  const [keeping, setKeeping] = useState<string | null>(null);
  const [keying, setKeying] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [steering, setSteering] = useState<string | null>(null);
  const ptzSource = show.sources.find((x) => x.id === steering);
  const adjustSource = show.sources.find((x) => x.id === adjusting);
  const keySource = show.sources.find((x) => x.id === keying);
  const keepSource = show.sources.find((x) => x.id === keeping);
  const textOnly = screen === 'monitor';
  const fill = useFillTiles();
  return (
    <div className="inputs" aria-label="Inputs" ref={fill}>
      {(only ? only.map((id) => show.sources.find((s) => s.id === id)).filter((s) => s !== undefined) : show.sources).map((src) => {
        const i = show.sources.indexOf(src);
        const onAir = sc.program === src.id;
        const next = sc.preview === src.id && !onAir;
        // Microphones and music files are heard, never shown: they live in the mixer.
        const soundFile = src.kind.type === 'video' && isSoundFile(src.kind.path);
        const soundOnly = soundFile || src.kind.type === 'microphone';
        const playing = src.kind.type === 'video' && src.kind.playback.playing;
        return (
          <div key={src.id} className={`tile${onAir ? ' tile--pgm' : ''}${next ? ' tile--pvw' : ''}`}>
            <button
              type="button"
              className="tile__pick"
              disabled={textOnly || soundOnly}
              aria-label={`${i + 1} ${src.name}`}
              title={soundOnly ? 'Sound only: use the mixer' : 'Click: line up next · Double-click: straight to air'}
              onClick={() => act({ type: 'setPreview', screen, sourceId: src.id })}
              onDoubleClick={() => act({ type: 'cutTo', screen, sourceId: src.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(src.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Delete') {
                  e.preventDefault();
                  setRemoving(src.id);
                }
              }}
            >
              <span className="tile__thumb">
                {soundFile ? (
                  <span className="tile__sound">♪</span>
                ) : (
                  // The picture keeps the screen's shape (16:9), so nothing in it is cut off.
                  <span className="tile__frame">
                    <SourceView source={src} client={client} thumb />
                  </span>
                )}
              </span>
              <span className="tile__num">{i + 1}</span>
              {problemIds.has(src.id) && (
                <span className="tile__warn" title="Something is wrong with this input: see the problem light">
                  ⚠
                </span>
              )}
              {onAir && <span className="tile__badge tile__badge--pgm">ON AIR</span>}
              {next && <span className="tile__badge tile__badge--pvw">NEXT</span>}
              <span className="tile__name">{src.name}</span>
              <span className="tile__kind">
                {soundFile ? 'Sound' : KIND_NAME[src.kind.type]}
                {src.kind.type === 'video' && src.playlist ? ` · ${src.playlist.current + 1}/${src.playlist.items.length}` : ''}
                {src.kind.type === 'video' && src.looping ? ' · loop' : ''}
              </span>
            </button>
            {soundFile && (
              <button
                type="button"
                className={`tile__play${playing ? ' is-on' : ''}`}
                aria-label={playing ? `Pause ${src.name}` : `Play ${src.name}`}
                onClick={() => act({ type: playing ? 'pause' : 'play', id: src.id })}
              >
                {playing ? '❚❚' : '▶'}
              </button>
            )}
            <button
              type="button"
              className={`tile__remove${removing === src.id ? ' is-armed' : ''}`}
              aria-label={removing === src.id ? `Click again to remove ${src.name}` : `Remove ${src.name}`}
              title={removing === src.id ? 'Click again to remove' : 'Remove this input'}
              onClick={() => {
                if (removing === src.id) {
                  setRemoving(null);
                  act({ type: 'removeSource', id: src.id });
                } else setRemoving(src.id);
              }}
              onBlur={() => setRemoving((r) => (r === src.id ? null : r))}
            >
              {removing === src.id ? 'Remove?' : '✕'}
            </button>
            <button type="button" className="tile__more" aria-label={`Options for ${src.name}`} onClick={() => setMenu(menu === src.id ? null : src.id)}>
              ⋯
            </button>
            {menu === src.id && (
              <TileMenu
                source={src}
                act={act}
                onClose={() => setMenu(null)}
                onEditText={() => setEditing(src.id)}
                onKeep={() => setKeeping(src.id)}
                onKey={() => setKeying(src.id)}
                onAdjust={() => setAdjusting(src.id)}
                onPtz={() => setSteering(src.id)}
                playNow={
                  textOnly || soundOnly
                    ? null
                    : (t) => {
                        setMenu(null);
                        act({ type: 'playNow', screen, sourceId: src.id, transition: t });
                      }
                }
                favourites={show.settings.favouriteTransitions}
              />
            )}
          </div>
        );
      })}
      <button type="button" className="tile tile--add" onClick={onAdd}>
        <span className="tile--add__plus">+</span>
        Add input
      </button>
      {editingRaffle && <RaffleCard source={editingRaffle} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingGraphic && <GraphicCard source={editingGraphic} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingSeating && <SeatingCard source={editingSeating} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingTrivia && <TriviaCard source={editingTrivia} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingScripture && <ScriptureCard source={editingScripture} act={act} onClose={() => setEditing(null)} />}
      {editingZmanim && <ZmanimDialog show={show} act={act} source={editingZmanim} onClose={() => setEditing(null)} />}
      {editingAuction && <AuctionCard source={editingAuction} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingWall && <WallCard source={editingWall} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingFund && <FundraiserCard source={editingFund} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingGuest && <GuestCard source={editingGuest} act={act} client={client} onClose={() => setEditing(null)} />}
      {ptzSource && <PtzCard source={ptzSource} act={act} client={client} onClose={() => setSteering(null)} />}
      {editingPoll && <PollCard source={editingPoll} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingSong && <LyricsCard source={editingSong} act={act} onClose={() => setEditing(null)} />}
      {editingScreen && <ScreenCard source={editingScreen} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingScore && <ScoreCard source={editingScore} act={act} onClose={() => setEditing(null)} />}
      {editingList && <PlaylistEditor source={editingList} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingText && <TextEditor source={editingText} act={act} onClose={() => setEditing(null)} />}
      {editingStream && <StreamCard show={show} source={editingStream} act={act} client={client} onClose={() => setEditing(null)} />}
      <StreamProblems show={show} client={client} />
      {editingPage && <BrowserCard show={show} source={editingPage} act={act} client={client} onClose={() => setEditing(null)} />}
      {adjustSource && <InputSettings show={show} source={adjustSource} act={act} client={client} onSwitch={setAdjusting} onClose={() => setAdjusting(null)} />}
      {keySource && <GreenScreenDialog show={show} source={keySource} act={act} client={client} onClose={() => setKeying(null)} />}
      {keepSource && <SaveToLibrary client={client} item={inputItem(keepSource, '')} onClose={() => setKeeping(null)} />}
      {editingSlides && <SlideshowEditor source={editingSlides} sources={show.sources} act={act} client={client} onClose={() => setEditing(null)} />}
      {editingSplit && <SplitEditor source={editingSplit} sources={show.sources} act={act} client={client} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TileMenu({
  source,
  act,
  onClose,
  onEditText,
  onKeep,
  onKey,
  onAdjust,
  onPtz,
  playNow,
  favourites,
}: {
  source: Source;
  act: Act;
  onClose: () => void;
  onEditText: () => void;
  onKeep: () => void;
  onKey: () => void;
  onAdjust: () => void;
  onPtz: () => void;
  /** Quick play: straight to air with this transition (null: can't go on air). */
  playNow: ((t: Transition) => void) | null;
  favourites: Transition[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  // Everything is changed here first and applied on Done; clicking away or Esc cancels.
  const colour = source.kind.type === 'color' ? source.kind.color : source.kind.type === 'countdown' ? source.kind.background : null;
  const [draft, setDraft] = useState({
    name: source.name,
    color: colour,
    fit: source.fit,
    looping: source.looping,
    volume: source.volume,
    muted: source.muted,
  });
  const set = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const done = () => {
    const patch: SourcePatch = {};
    if (draft.name.trim() && draft.name !== source.name) patch.name = draft.name;
    if (draft.color !== null && draft.color !== colour) patch.color = draft.color;
    if (draft.fit !== source.fit) patch.fit = draft.fit;
    if (draft.looping !== source.looping) patch.looping = draft.looping;
    if (draft.volume !== source.volume) patch.volume = draft.volume;
    if (draft.muted !== source.muted) patch.muted = draft.muted;
    if (Object.keys(patch).length) act({ type: 'updateSource', id: source.id, patch });
    onClose();
  };

  const k = source.kind.type;
  return (
    <div ref={ref} className="menu" role="dialog" aria-label={`Options for ${source.name}`}>
      {playNow && (
        <div className="menu__row menu__play">
          Play now
          <span className="segs">
            {favourites.map((t, i) => (
              <button key={i} type="button" className="seg" title={`Straight to air with ${transitionName(t)}`} onClick={() => playNow(t)}>
                {transitionName(t)}
              </button>
            ))}
          </span>
        </div>
      )}
      <label className="menu__row">
        Name
        <input value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && done()} />
      </label>
      {draft.color !== null && (
        <label className="menu__row">
          {k === 'countdown' ? 'Background' : 'Color'}
          <input type="color" value={draft.color} onChange={(e) => set({ color: e.target.value })} />
        </label>
      )}
      {(k === 'video' || k === 'image' || k === 'camera') && (
        <div className="menu__row">
          Picture
          <span className="segs">
            <button type="button" className="seg" aria-pressed={draft.fit === 'contain'} onClick={() => set({ fit: 'contain' })}>
              Whole
            </button>
            <button type="button" className="seg" aria-pressed={draft.fit === 'cover'} onClick={() => set({ fit: 'cover' })}>
              Fill
            </button>
          </span>
        </div>
      )}
      {k === 'video' && (
        <label className="menu__row menu__row--check">
          <input type="checkbox" checked={draft.looping} onChange={(e) => set({ looping: e.target.checked })} /> Loop at the end
        </label>
      )}
      {(k === 'video' || k === 'microphone') && (
        <>
          <label className="menu__row">
            Volume
            <input type="range" min={0} max={100} value={Math.round(draft.volume * 100)} onChange={(e) => set({ volume: Number(e.target.value) / 100 })} />
          </label>
          <label className="menu__row menu__row--check">
            <input type="checkbox" checked={draft.muted} onChange={(e) => set({ muted: e.target.checked })} /> Mute
          </label>
        </>
      )}
      {k === 'logo3d' && (
        <button
          type="button"
          className="btn menu__wide"
          onClick={() => {
            onClose();
            sendCommand({ type: 'logoMaker', id: source.id });
          }}
        >
          Edit 3D logo…
        </button>
      )}
      {(k === 'text' ||
        k === 'split' ||
        k === 'slideshow' ||
        k === 'browser' ||
        k === 'stream' ||
        k === 'scoreboard' ||
        k === 'screen' ||
        k === 'lyrics' ||
        k === 'poll' ||
        k === 'guest' ||
        k === 'raffle' ||
        k === 'fundraiser' ||
        k === 'wall' ||
        k === 'auction' ||
        k === 'zmanim' ||
        k === 'scripture' ||
        k === 'trivia' ||
        k === 'seating' ||
        k === 'graphic') && (
        <button
          type="button"
          className="btn menu__wide"
          onClick={() => {
            onClose();
            onEditText();
          }}
        >
          {k === 'text'
            ? 'Edit text…'
            : k === 'split'
              ? 'Edit split screen…'
              : k === 'browser'
                ? 'Control web page…'
                : k === 'stream'
                  ? 'Stream settings…'
                  : k === 'scoreboard'
                    ? 'Scores and clock…'
                    : k === 'screen'
                      ? 'Change what is captured…'
                      : k === 'lyrics'
                        ? 'Run the song…'
                        : k === 'poll'
                          ? 'Run the poll…'
                          : k === 'guest'
                            ? 'Guest link…'
                            : k === 'raffle'
                              ? 'Run the raffle…'
                              : k === 'fundraiser'
                                ? 'Run the fundraiser…'
                                : k === 'wall'
                                  ? 'Run the messages wall…'
                                  : k === 'auction'
                                    ? 'Run the auction…'
                                    : k === 'zmanim'
                                      ? 'Look, city and Shabbos…'
                                      : k === 'scripture'
                                        ? 'Choose the passage…'
                                        : k === 'trivia'
                                          ? 'Run the game…'
                                          : k === 'seating'
                                            ? 'Guest list and tables…'
                                            : k === 'graphic'
                                              ? 'Design…'
                                              : 'Edit slides…'}
        </button>
      )}
      <button
        type="button"
        className="btn menu__wide"
        onClick={() => {
          onClose();
          onKeep();
        }}
      >
        Save to library…
      </button>
      {k === 'camera' && (
        <button
          type="button"
          className={`btn menu__wide${source.ptz ? ' is-on' : ''}`}
          onClick={() => {
            onClose();
            onPtz();
          }}
        >
          {source.ptz ? 'Move the camera (PTZ)…' : 'PTZ camera control…'}
        </button>
      )}
      {k === 'video' && (
        <button
          type="button"
          className={`btn menu__wide${source.playlist ? ' is-on' : ''}`}
          onClick={() => {
            onClose();
            onEditText();
          }}
        >
          {source.playlist ? `Playlist (${source.playlist.items.length} videos)…` : 'Make a playlist…'}
        </button>
      )}
      {(k === 'camera' || k === 'video' || k === 'image') && (
        <button
          type="button"
          className={`btn menu__wide${source.key.enabled ? ' is-on' : ''}`}
          onClick={() => {
            onClose();
            onKey();
          }}
        >
          Green screen{source.key.enabled ? ' (on)' : ''}…
        </button>
      )}
      {(k === 'camera' || k === 'video' || k === 'image') && (
        <button
          type="button"
          className={`btn menu__wide${isAdjusted(source.adjust) ? ' is-on' : ''}`}
          onClick={() => {
            onClose();
            onAdjust();
          }}
        >
          Adjust picture{isAdjusted(source.adjust) ? ' (on)' : ''}…
        </button>
      )}
      <div className="menu__foot">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={done}>
          Done
        </button>
      </div>
      <button
        type="button"
        className={`menu__remove${confirm ? ' is-armed' : ''}`}
        onClick={() => {
          if (!confirm) setConfirm(true);
          else {
            act({ type: 'removeSource', id: source.id });
            onClose();
          }
        }}
      >
        {confirm ? 'Click again to remove' : 'Remove input'}
      </button>
    </div>
  );
}

/** Tells the problem center when a stream input isn't coming in. */
function StreamProblems({ show, client }: { show: Show; client: EngineClient }) {
  const streams = show.sources.filter((s) => s.kind.type === 'stream');
  const status = useStreamStatus(client);
  return (
    <>
      {streams.map((s) => (
        <StreamProblem key={s.id} source={s} problem={status[s.id]?.live === false ? (status[s.id]?.problem ?? 'Not connected') : null} />
      ))}
    </>
  );
}

function StreamProblem({ source, problem }: { source: Source; problem: string | null }) {
  useReportProblem(
    problem
      ? {
          key: `stream:${source.id}`,
          level: 'warning',
          title: `${source.name}: the stream isn’t coming in`,
          detail: problem,
          fix: 'Check the address (⋯ → Stream settings…) and that the stream is running. Lumora keeps trying by itself.',
          sourceId: source.id,
        }
      : null,
  );
  return null;
}

/**
 * The tiles share out all the room they have: as many columns as keeps each
 * tile about the shape of a picture with its name, then the rows and columns
 * stretch to fill it. No gaps around them and never a scroll bar.
 */
function useFillTiles() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = '';
    const fit = () => {
      const n = el.querySelectorAll(':scope > .tile').length;
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!n || !W || !H) return;
      const gap = 8;
      const shape = 1.45; // width / height of a tile
      // As many rows as gives the biggest tiles of about that shape…
      let rows = 1;
      let best = 0;
      for (let r = 1; r <= n; r++) {
        const c = Math.ceil(n / r);
        const w = Math.min((W - gap * (c - 1)) / c, ((H - gap * (r - 1)) / r) * shape);
        if (w > best + 0.5) {
          best = w;
          rows = r;
        }
      }
      // …not giant tiles when there are only a few (about 380px wide at most)…
      let cols = Math.min(n, Math.max(Math.ceil(n / rows), Math.ceil((W + gap) / (380 + gap))));
      rows = Math.ceil(n / cols);
      // …and the rows evened out (5 tiles: 3 and 2, not 4 and 1). Each row
      // stretches across, so there is no empty space.
      cols = Math.ceil(n / rows);
      const key = `${cols}x${rows}x${W}x${H}`;
      if (key === last) return;
      last = key;
      el.style.setProperty('--tile-w', `${Math.floor((W - gap * (cols - 1)) / cols) - 1}px`);
      el.style.setProperty('--tile-h', `${Math.floor((H - gap * (rows - 1)) / rows)}px`);
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(fit);
    mo?.observe(el, { childList: true });
    return () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);
  return ref;
}
