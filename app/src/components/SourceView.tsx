import { AuctionView, FundraiserView, RaffleView, WallView } from './AudienceViews';
import { eventLogo } from '../engine/brand';
import { guestPage } from '../engine/guest';
import { CommentView } from './CommentView';
import { ZmanimView } from './ZmanimView';
import { ScriptureView } from './ScriptureView';
import { TriviaView } from './TriviaView';
import { SeatingView } from './SeatingView';
import { GraphicView } from './GraphicView';
import { PollView } from './PollView';
import { LyricsView } from './LyricsView';
import { ScoreboardView } from './ScoreboardView';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TitlerView } from '../titler/TitlerView';
import { showFromStage } from '../titler/titlerSource';
import { useReportProblem } from '../problems/problems';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import { syncMedia } from '../engine/mediaSync';
import { useStage } from '../engine/CountdownContext';
import { onAir } from '../engine/timing';
import type { Countdown } from '../engine/types/Countdown';
import { CountdownView } from './CountdownOverlay';
import { ChromaKeyer, defaultAdjust, defaultAutoFrame, defaultBackground, needsProcessing, type Smarts } from '../engine/chroma';
import { InputVision, shotToView, usesVision } from '../engine/vision';
import { currentSet } from '../visuals/sets';
import type { Adjust } from '../engine/types/Adjust';
import type { AutoFrame } from '../engine/types/AutoFrame';
import type { Background } from '../engine/types/Background';
import type { ChromaKey } from '../engine/types/ChromaKey';
import { PesukimView } from './PesukimView';
import { TextView } from './TextView';
import { withData } from '../engine/data';
import { CreditsView } from './CreditsView';
import { VisualsView } from './VisualsView';
import { Logo3dView } from './Logo3dView';
import { BrowserView, StreamView } from './BrowserView';
import type { Logo3d } from '../engine/types/Logo3d';
import { defaultVisuals } from '../engine/visuals';
import { acquireCamera, cameraProblem, fullResolution, rememberCameraName, releaseCamera, setCameraValues, type CameraValues } from '../engine/cameras';
import { FrameDelay } from '../engine/frameDelay';
import { inputHealth, watchFrames } from '../engine/inputHealth';
import { useUnifiedOn } from '../engine/unified';
import { EnginePreview } from './EnginePreview';

// ---- views ----

/** A title with its {Column}s filled from the data file. */
function DataText({ t }: { t: import('../engine/types/TextInput').TextInput }) {
  return <TextView t={withData(t, useStage()?.data)} />;
}

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

/** SMPTE-style bars, drawn with CSS so they never need a file. */
const PATTERN = 'linear-gradient(90deg,#c0c0c0 0 14.28%,#c0c000 0 28.57%,#00c0c0 0 42.85%,#00c000 0 57.14%,#c000c0 0 71.42%,#c00000 0 85.71%,#0000c0 0)';

export interface SourceViewProps {
  source: Source;
  client: EngineClient;
  /** Small, still preview for the input grid: videos show their first frame. */
  thumb?: boolean;
  /** Tell the engine a video's length once it is known (control window only). */
  reportDuration?: boolean;
  /**
   * Drawn on a screen the audience sees. If the source fails (camera
   * unplugged, file missing or broken) it shows plain black here, never an
   * error message; the control window shows the warning instead.
   */
  audience?: boolean;
  /** Report failures to the problem center (off for previews of something not added yet). */
  report?: boolean;
}

/** Draws one source filling its box. */
export function SourceView(props: SourceViewProps) {
  const { source, report = true } = props;
  // Lets a failure below say which input it is about (for the problem center).
  return (
    <Who.Provider value={report ? { id: source.id, name: source.name, kind: source.kind.type } : null}>
      <SourceBody {...props} />
      {props.audience && <NoSignalCover id={source.id} />}
    </Who.Provider>
  );
}

/**
 * An input the control window sees has lost its picture: the audience sees the
 * safe screen (the logo) instead of a frozen picture. The input stays open
 * underneath, so it shows again the moment its picture returns.
 */
function NoSignalCover({ id }: { id: string }) {
  const stage = useStage();
  return stage?.noSignal?.includes(id) ? <SafeScreenView /> : null;
}

/** A Lumora Titler graphic, with what this window knows of the show (fields filled from the scoreboard, countdown, data file). */
function TitlerInput({ source, client, thumb }: { source: Source; client: EngineClient; thumb: boolean }) {
  const stage = useStage();
  const show = useMemo(() => showFromStage(stage), [stage]);
  return <TitlerView source={source} show={show} urlFor={(p) => client.mediaUrl(p)} thumb={thumb} />;
}

const Who = createContext<{ id: string; name: string; kind: Source['kind']['type'] } | null>(null);

function SourceBody({ source, client, thumb = false, reportDuration = false, audience = false }: SourceViewProps) {
  // A camera that auto-framing zooms into opens at full resolution (sharp close shots).
  const sharpCam = source.kind.type === 'camera' && !!source.autoFrame?.enabled && !source.ptz ? source.kind.deviceId : null;
  useEffect(() => {
    if (!sharpCam) return;
    const holder = `view:${source.id}:${Math.random()}`;
    fullResolution(holder, sharpCam, true);
    return () => fullResolution(holder, sharpCam, false);
  }, [sharpCam, source.id]);
  const fit = source.fit === 'cover' ? 'cover' : 'contain';
  const k = source.kind;
  // Settings → Engine → Unified (beta): the engine opened the camera; this is its preview.
  const unified = useUnifiedOn();
  if (unified && k.type === 'camera') return <EnginePreview previewKey={`source/${source.id}`} />;
  const keyed =
    needsProcessing(source.key, source.adjust, source.background, source.autoFrame) && (k.type === 'image' || k.type === 'camera' || k.type === 'video');
  if (keyed) {
    // Green screen and adjustments: the picture is drawn through the processor.
    return (
      <Keyed
        keyCfg={source.key}
        adjust={source.adjust}
        background={source.background}
        autoFrame={source.ptz && source.autoFrame ? { ...source.autoFrame, enabled: false } : source.autoFrame}
        pictureUrl={source.background?.mode === 'picture' && source.background.picture ? client.mediaUrl(source.background.picture) : null}
        fit={fit}
        audience={audience}
      >
        <SourceBody
          source={{
            ...source,
            key: { ...source.key, enabled: false },
            adjust: defaultAdjust(),
            background: defaultBackground(),
            autoFrame: defaultAutoFrame(),
          }}
          client={client}
          thumb={thumb}
          reportDuration={reportDuration}
          audience={audience}
        />
      </Keyed>
    );
  }
  switch (k.type) {
    case 'color':
      return <div style={{ ...fill, background: k.color }} data-kind="color" />;
    case 'pattern':
      return (
        <div style={{ ...fill, background: PATTERN }} data-kind="pattern">
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '22%',
              background:
                'linear-gradient(90deg,#0000c0 0 14.28%,#131313 0 28.57%,#c000c0 0 42.85%,#131313 0 57.14%,#00c0c0 0 71.42%,#131313 0 85.71%,#c0c0c0 0)',
            }}
          />
        </div>
      );
    case 'image':
      return <ImageView url={client.mediaUrl(k.path)} fit={fit} audience={audience} />;
    case 'camera':
      return (
        <CameraView deviceId={k.deviceId} label={k.label} fit={fit} audience={audience} delayMs={source.videoDelayMs ?? 0} values={source.camera?.values} />
      );
    case 'text':
      return <DataText t={k} />;
    case 'credits':
      return <CreditsView c={k} />;
    case 'slideshow':
      return <SlideshowInput source={source} client={client} thumb={thumb} audience={audience} />;
    case 'split':
      return <SplitInput source={source} client={client} thumb={thumb} audience={audience} />;
    case 'pesukim':
      return <PesukimInput source={source} client={client} thumb={thumb} audience={audience} />;
    case 'visuals':
      return <VisualsInput thumb={thumb} audience={audience} />;
    case 'logo3d':
      return <Logo3dInput logo={k} thumb={thumb} audience={audience} />;
    case 'scoreboard':
      return <ScoreboardView sb={k} />;
    case 'raffle':
      return <RaffleView r={k} thumb={thumb} />;
    case 'fundraiser':
      return <FundraiserView f={k} thumb={thumb} />;
    case 'graphic':
      return <GraphicView g={k} url={(p) => client.mediaUrl(p)} thumb={thumb} />;
    case 'titler':
      return <TitlerInput source={source} client={client} thumb={thumb} />;
    case 'seating':
      return <SeatingView s={k} thumb={thumb} />;
    case 'trivia':
      return <TriviaView t={k} thumb={thumb} />;
    case 'scripture':
      return <ScriptureView s={k} />;
    case 'zmanim':
      return <ZmanimView z={k} />;
    case 'auction':
      return <AuctionView a={k} url={(p) => client.mediaUrl(p)} thumb={thumb} />;
    case 'wall':
      return <WallView w={k} url={(p) => client.mediaUrl(p)} thumb={thumb} />;
    case 'guest':
      // Shown directly (outside the Windows app) in every window, so silent there: the mixer isn't fed that way.
      return (
        <BrowserView
          id={source.id}
          page={{ ...guestPage(k), url: `${guestPage(k).url}&noaudio` }}
          client={client}
          fit={fit}
          thumb={thumb}
          audience={audience}
        />
      );
    case 'comment':
      return <CommentView c={k} />;
    case 'poll':
      return <PollView p={k} thumb={thumb} />;
    case 'lyrics':
      return <LyricsView l={k} />;
    case 'screen':
      return <StreamView id={source.id} client={client} fit={fit} audience={audience} note="Screen capture works in the Windows app" />;
    case 'stream':
      return <StreamView id={source.id} client={client} fit={fit} audience={audience} />;
    case 'browser':
      return <BrowserView id={source.id} page={k} client={client} fit={fit} thumb={thumb} audience={audience} />;
    case 'countdown':
      return <CountdownInput id={source.id} timer={k.timer} background={k.background} logoUrl={k.logo ?? null} client={client} />;
    case 'microphone':
      return (
        <div
          style={{
            ...fill,
            background: '#121212',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#909090',
            fontSize: 16,
            fontWeight: 600,
          }}
          data-kind="microphone"
        >
          Microphone
        </div>
      );
    case 'video':
      return <VideoView source={source} client={client} fit={fit} thumb={thumb} reportDuration={reportDuration} audience={audience} />;
  }
}

/**
 * A slideshow: the slide showing (a picture, or another input such as a
 * video), in its area, over what is behind. Each new slide fades in.
 */
function SlideshowInput({ source, client, thumb, audience }: { source: Source; client: EngineClient; thumb: boolean; audience: boolean }) {
  const stage = useStage();
  if (source.kind.type !== 'slideshow') return null;
  const sh = source.kind;
  const find = (id: string | null) => (id ? stage?.sources?.find((s) => s.id === id && s.kind.type !== 'slideshow') : undefined);
  const behind = find(sh.behind);
  const slide = sh.slides[sh.current];
  const inner = slide?.type === 'input' ? find(slide.sourceId) : undefined;
  const fit = sh.fit === 'cover' ? 'cover' : 'contain';
  return (
    <div style={{ ...fill, background: sh.background, overflow: 'hidden' }} data-kind="slideshow">
      {behind && <SourceBody source={behind} client={client} thumb={thumb} audience={audience} />}
      <div style={{ position: 'absolute', left: `${sh.area.x}%`, top: `${sh.area.y}%`, width: `${sh.area.w}%`, height: `${sh.area.h}%`, overflow: 'hidden' }}>
        {sh.black && <div style={{ ...fill, background: '#000' }} data-black="true" />}
        {slide && !sh.black && (
          <div key={`${sh.current}:${sh.changedAt}`} style={{ ...fill, animation: sh.fade && !thumb ? 'slide-in 0.4s ease-out both' : undefined }}>
            {slide.type === 'image' ? (
              <ImageView url={client.mediaUrl(slide.path)} fit={fit} audience={audience} />
            ) : (
              inner && <SourceBody source={inner} client={client} thumb={thumb} audience={audience} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A split screen: each box draws its input; boxes glide when the layout changes. */
function SplitInput({ source, client, thumb, audience }: { source: Source; client: EngineClient; thumb: boolean; audience: boolean }) {
  const stage = useStage();
  if (source.kind.type !== 'split') return null;
  const sp = source.kind;
  return (
    <div style={{ ...fill, background: sp.background, overflow: 'hidden' }} data-kind="split">
      {sp.boxes.map((b, i) => {
        const inner = b.sourceId ? stage?.sources?.find((s) => s.id === b.sourceId) : undefined;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${b.frame.x}%`,
              top: `${b.frame.y}%`,
              width: `${b.frame.w}%`,
              height: `${b.frame.h}%`,
              overflow: 'hidden',
              boxShadow: sp.border ? `inset 0 0 0 2px ${sp.borderColor}` : undefined,
              transition: 'left 0.5s ease, top 0.5s ease, width 0.5s ease, height 0.5s ease',
            }}
          >
            {inner && inner.kind.type !== 'split' && <SourceBody source={inner} client={client} thumb={thumb} audience={audience} />}
            {sp.border && <div style={{ ...fill, boxShadow: `inset 0 0 0 2px ${sp.borderColor}`, pointerEvents: 'none' }} />}
          </div>
        );
      })}
    </div>
  );
}

function PesukimInput({ source, client, thumb, audience }: { source: Source; client: EngineClient; thumb: boolean; audience: boolean }) {
  const stage = useStage();
  if (source.kind.type !== 'pesukim') return null;
  const id = source.kind.look.behind;
  const behind = id ? stage?.sources?.find((s) => s.id === id) : undefined;
  return (
    <PesukimView
      data={source.kind}
      url={(p) => client.mediaUrl(p)}
      behind={behind && behind.kind.type !== 'pesukim' ? <SourceBody source={behind} client={client} thumb={thumb} audience={audience} /> : null}
    />
  );
}

function CountdownInput({
  id,
  timer,
  background,
  logoUrl,
  client,
}: {
  id: string;
  timer: Countdown;
  background: string;
  logoUrl: string | null;
  client: EngineClient;
}) {
  const stage = useStage();
  // At the end: this countdown's own picture, or else the event logo (Lumora's until it has one).
  const logo = logoUrl ?? eventLogo(stage?.event);
  return <CountdownView countdown={timer} background={background} logoUrl={client.mediaUrl(logo)} onAir={onAir(stage?.screens, id)} />;
}

/** What the audience sees instead of something broken: black, or the logo (the event's, else Lumora's) as chosen in the event setup. */
export function SafeScreenView({ reason = 'failure' }: { reason?: 'failure' | 'panic' }) {
  const stage = useStage();
  const ev = stage?.event;
  const choice = reason === 'panic' ? ev?.panicShows : ev?.onFailure;
  const logo = choice === 'logo' ? eventLogo(ev) : null;
  return (
    <div style={{ ...fill, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-failed>
      {logo && stage && <img src={stage.mediaUrl(logo)} alt="" draggable={false} style={{ maxWidth: '50%', maxHeight: '50%', objectFit: 'contain' }} />}
    </div>
  );
}

/** The stage visuals, from the show (all visuals inputs show the same). */
function VisualsInput({ thumb, audience }: { thumb: boolean; audience: boolean }) {
  const stage = useStage();
  const who = useContext(Who);
  const [failed, setFailed] = useState(false);
  useReportProblem(
    failed && !audience && who
      ? {
          key: `visuals:${who.id}`,
          level: 'warning',
          title: 'Stage visuals can’t be drawn on this computer',
          detail: 'They need the graphics card (WebGL), which isn’t available here.',
          fix: 'Update the graphics driver; on Windows this works on almost every computer.',
          sourceId: who.id,
        }
      : null,
  );
  const logo = stage?.event.logo;
  return (
    <VisualsView
      v={stage?.visuals ?? DEFAULT_VISUALS}
      logoUrl={logo ? stage.mediaUrl(logo) : null}
      thumb={thumb}
      audience={audience}
      onFail={() => setFailed(true)}
    />
  );
}
const DEFAULT_VISUALS = defaultVisuals();

/** A 3D logo: its own picture, or the event logo. */
function Logo3dInput({ logo, thumb, audience }: { logo: Logo3d; thumb: boolean; audience: boolean }) {
  const stage = useStage();
  const who = useContext(Who);
  const [problem, setProblem] = useState<string | null>(null);
  const path = logo.path || stage?.event.logo || null;
  const url = path ? (stage?.mediaUrl(path) ?? null) : null;
  useReportProblem(
    problem && !audience && who
      ? { key: `logo3d:${who.id}`, level: 'warning', title: `${who.name}: ${problem}`, detail: 'The 3D logo shows a stand-in instead.', sourceId: who.id }
      : null,
  );
  if (thumb) {
    // A still, tilted picture: the grid never spends the graphics card on thumbnails.
    return (
      <div
        style={{
          ...fill,
          background: logo.background === 'colour' ? logo.bgColor : '#121212',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          perspective: 300,
        }}
        data-kind="logo3d"
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            style={{ maxWidth: '60%', maxHeight: '60%', transform: 'rotateY(-25deg)', filter: 'drop-shadow(4px 3px 0 rgba(0,0,0,.6))' }}
          />
        ) : (
          <b style={{ color: '#bebebe', transform: 'rotateY(-25deg)', fontSize: 14 }}>3D LOGO</b>
        )}
      </div>
    );
  }
  return <Logo3dView logo={logo} url={url} audience={audience} onFail={setProblem} />;
}

/**
 * Green screen: the video or picture inside is hidden and drawn again on a
 * canvas with its key color taken out, every frame, on the graphics card.
 * Without WebGL the picture shows as it is (and the operator is told).
 */
function Keyed({
  keyCfg,
  adjust,
  background,
  autoFrame,
  pictureUrl,
  fit,
  audience,
  children,
}: {
  keyCfg: ChromaKey;
  adjust: Adjust;
  background?: Background;
  autoFrame?: AutoFrame;
  pictureUrl: string | null;
  fit: 'cover' | 'contain';
  audience: boolean;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [works, setWorks] = useState(true);
  const latest = useRef({ keyCfg, adjust, background, autoFrame, pictureUrl });
  latest.current = { keyCfg, adjust, background, autoFrame, pictureUrl };
  const who = useContext(Who);
  useReportProblem(
    !works && !audience && who
      ? {
          key: `key:${who.id}`,
          level: 'warning',
          title: `${who.name}: green screen and picture adjustments can’t work on this computer`,
          detail: 'They need the graphics card (WebGL), which isn’t available here, so the picture shows as it is.',
          fix: 'On Windows this works on almost every computer; update the graphics driver if it doesn’t.',
          sourceId: who.id,
        }
      : null,
  );
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const keyer = new ChromaKeyer(c);
    if (!keyer.works) {
      setWorks(false);
      return;
    }
    let id = 0;
    const vision = new InputVision();
    let picture: HTMLImageElement | null = null;
    const frame = () => {
      const el = box.current?.querySelector('video, img');
      const { keyCfg: kc, adjust: ad, background: bg, autoFrame: af, pictureUrl: pu } = latest.current;
      const video = el instanceof HTMLVideoElement && el.readyState >= 2 ? el : null;
      const img = el instanceof HTMLImageElement && el.complete ? el : null;
      const pic = video ?? img;
      if (pic) {
        const w = video ? video.videoWidth : img!.naturalWidth;
        const h = video ? video.videoHeight : img!.naturalHeight;
        let smarts: Smarts | null = null;
        if (bg && af && usesVision(bg, af)) {
          vision.update(pic, w, h, bg, af, box.current?.clientWidth ? box.current.clientWidth * devicePixelRatio : 1920);
          if (pu && picture?.src !== pu) {
            picture = new Image();
            picture.crossOrigin = 'anonymous';
            picture.src = pu;
          }
          const set = bg.mode === 'set' ? currentSet(bg.set) : null;
          smarts = {
            mask: vision.mask,
            bg,
            picture: set ? set.back : pu ? picture : null,
            front: set?.front ?? null,
            view: af.enabled ? shotToView(vision.shot) : null,
          };
        }
        keyer.draw(pic, w, h, kc, ad, 1920, smarts);
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div ref={box} className={works ? 'keyed' : undefined} style={fill}>
      {children}
      <canvas ref={canvas} style={{ ...fill, objectFit: fit, pointerEvents: 'none' }} />
    </div>
  );
}

function ImageView({ url, fit, audience }: { url: string; fit: 'cover' | 'contain'; audience: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (failed) return <Missing text="Picture file not found" audience={audience} />;
  // crossOrigin: so the green screen may read the picture (the app's file server allows it).
  return (
    <img src={url} alt="" crossOrigin="anonymous" draggable={false} style={{ ...fill, objectFit: fit }} data-kind="image" onError={() => setFailed(true)} />
  );
}

function CameraView({
  deviceId,
  label,
  fit,
  audience,
  delayMs = 0,
  values,
}: {
  deviceId: string;
  label?: string;
  fit: 'cover' | 'contain';
  audience: boolean;
  delayMs?: number;
  values?: CameraValues;
}) {
  if (label) rememberCameraName(deviceId, label);
  const ref = useRef<HTMLVideoElement>(null);
  // The camera's own settings (zoom, focus…), kept with the event.
  useEffect(() => {
    if (values) setCameraValues(deviceId, values);
  }, [deviceId, values]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // A camera that failed is tried again every few seconds (it may be free again, or plugged back in).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!failed) return;
    const id = setTimeout(() => setAttempt((n) => n + 1), 3000);
    return () => clearTimeout(id);
  }, [failed, attempt]);
  const delayed = delayMs > 0;
  // Held back: the camera plays hidden and its frames from `delayMs` ago are drawn.
  useEffect(() => {
    const v = ref.current;
    const c = canvas.current;
    if (!delayed || !v || !c) return;
    const d = new FrameDelay(v, delayMs);
    let raf = requestAnimationFrame(function draw() {
      const f = d.frame();
      const g = c.getContext('2d');
      if (f && g) {
        if (c.width !== f.width || c.height !== f.height) {
          c.width = f.width;
          c.height = f.height;
        }
        g.drawImage(f, 0, 0);
      }
      raf = requestAnimationFrame(draw);
    });
    return () => {
      cancelAnimationFrame(raf);
      d.dispose();
    };
  }, [delayed, delayMs]);
  useEffect(() => {
    let alive = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed('Camera not found or unplugged');
      return;
    }
    const opening = acquireCamera(deviceId);
    opening.then(
      (stream) => {
        if (!alive || !ref.current) return;
        // Unplugged during the show: the track ends and the screen goes black.
        const tracks = stream.getVideoTracks();
        if (tracks.length === 0 || tracks.every((t) => t.readyState === 'ended')) return setFailed('Camera not found or unplugged');
        tracks.forEach((t) =>
          t.addEventListener('ended', () => {
            if (alive) setFailed('Camera not found or unplugged');
          }),
        );
        setFailed(null);
        ref.current.srcObject = stream;
        void ref.current.play().catch(() => {});
      },
      () => alive && setFailed(cameraProblem(deviceId) ?? 'Camera not found or unplugged'),
    );
    return () => {
      alive = false;
      releaseCamera(deviceId, opening);
    };
  }, [deviceId, attempt]);
  // The control window counts the camera's frames, so a picture that stops is noticed (the backup lineup).
  const who = useContext(Who);
  const counting = !audience && who ? who.id : null;
  useEffect(() => {
    const v = ref.current;
    if (!counting || failed || !v) return;
    return watchFrames(counting, v);
  }, [counting, failed]);
  if (failed) return <Missing text={failed} audience={audience} />;
  // One video element either way, so turning the delay on or off keeps the camera.
  return (
    <>
      <video
        ref={ref}
        muted
        playsInline
        autoPlay
        style={delayed ? { ...fill, opacity: 0 } : { ...fill, objectFit: fit, background: '#000' }}
        data-kind={delayed ? undefined : 'camera'}
      />
      {delayed && <canvas ref={canvas} style={{ ...fill, objectFit: fit, background: '#000' }} data-kind="camera" />}
    </>
  );
}

function VideoView({
  source,
  client,
  fit,
  thumb,
  reportDuration,
  audience,
}: Required<Omit<SourceViewProps, 'source' | 'client' | 'report'>> & { source: Source; client: EngineClient; fit: 'cover' | 'contain' }) {
  const ref = useRef<HTMLVideoElement>(null);
  const latest = useRef(source);
  latest.current = source;
  const [failed, setFailed] = useState(false);
  const path = source.kind.type === 'video' ? source.kind.path : '';

  // Keep the element on the engine's clock (see syncMedia).
  useEffect(() => {
    if (thumb) return;
    const sync = () => ref.current && syncMedia(ref.current, latest.current, Date.now());
    sync();
    const id = setInterval(sync, 200);
    return () => clearInterval(id);
  }, [thumb, path]);

  useEffect(() => setFailed(false), [path]);
  if (failed) return <Missing text="Video file not found or can't be played" audience={audience} />;
  return (
    <video
      ref={ref}
      src={client.mediaUrl(path)}
      crossOrigin="anonymous"
      preload={thumb ? 'metadata' : 'auto'}
      muted
      playsInline
      disablePictureInPicture
      style={{ ...fill, objectFit: fit, background: '#000' }}
      data-kind="video"
      onError={() => setFailed(true)}
      onLoadedMetadata={(e) => {
        const d = e.currentTarget.duration;
        if (thumb) e.currentTarget.currentTime = Math.min(1, d / 10 || 0);
        if (reportDuration && source.kind.type === 'video' && Number.isFinite(d) && d > 0 && Math.abs(d - source.kind.durationS) > 0.01) {
          void client.dispatch({ type: 'setDuration', id: source.id, durationS: d }).catch(() => {});
        }
      }}
    />
  );
}

const FIX: Partial<Record<Source['kind']['type'], string>> = {
  camera: 'Check its cable and that no other program is using it. Unplugging and plugging it back in usually brings it back.',
  microphone: 'Check its cable and that Lumora is allowed to use it.',
  video: 'The file was moved, renamed or deleted. Remove this input and add the file again from its new place.',
  image: 'The file was moved, renamed or deleted. Remove this input and add the picture again from its new place.',
};

function Missing({ text, audience }: { text: string; audience: boolean }) {
  const who = useContext(Who);
  const stage = useStage();
  // The backup lineup hears of it too (control window only).
  const reporter = useRef(Symbol('view')).current;
  const failedId = who && !audience ? who.id : null;
  useEffect(() => {
    if (!failedId) return;
    inputHealth.report(failedId, reporter, text);
    return () => inputHealth.report(failedId, reporter, null);
  }, [failedId, reporter, text]);
  // Tell the operator straight away (control window only; outputs stay quiet).
  useReportProblem(
    who && !audience
      ? {
          key: `source:${who.id}`,
          level: 'error',
          title: `${who.name}: ${text.toLowerCase()}`,
          detail: `Screens showing it show ${stage?.event.onFailure === 'logo' && stage.event.logo ? 'your event logo' : 'black'} instead.`,
          fix: FIX[who.kind],
          sourceId: who.id,
        }
      : null,
  );
  if (audience) return <SafeScreenView />;
  return (
    <div
      data-failed
      style={{
        ...fill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a0f10',
        color: '#e0847b',
        fontSize: 12,
        textAlign: 'center',
        padding: 8,
      }}
    >
      {text}
    </div>
  );
}
