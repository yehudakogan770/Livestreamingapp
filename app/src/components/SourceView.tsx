import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReportProblem } from '../problems/problems';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import { syncMedia } from '../engine/mediaSync';
import { useStage } from '../engine/CountdownContext';
import type { Countdown } from '../engine/types/Countdown';
import { CountdownView } from './CountdownOverlay';
import { PesukimView } from './PesukimView';
import { TextView } from './TextView';
import { CreditsView } from './CreditsView';
import { acquireCamera, releaseCamera } from '../engine/cameras';

// ---- views ----

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
  /** Report failures to the problem centre (off for previews of something not added yet). */
  report?: boolean;
}

/** Draws one source filling its box. */
export function SourceView(props: SourceViewProps) {
  const { source, report = true } = props;
  // Lets a failure below say which input it is about (for the problem centre).
  return (
    <Who.Provider value={report ? { id: source.id, name: source.name, kind: source.kind.type } : null}>
      <SourceBody {...props} />
    </Who.Provider>
  );
}

const Who = createContext<{ id: string; name: string; kind: Source['kind']['type'] } | null>(null);

function SourceBody({ source, client, thumb = false, reportDuration = false, audience = false }: SourceViewProps) {
  const fit = source.fit === 'cover' ? 'cover' : 'contain';
  const k = source.kind;
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
      return <CameraView deviceId={k.deviceId} fit={fit} audience={audience} />;
    case 'text':
      return <TextView t={k} />;
    case 'credits':
      return <CreditsView c={k} />;
    case 'slideshow':
      return <SlideshowInput source={source} client={client} thumb={thumb} audience={audience} />;
    case 'split':
      return <SplitInput source={source} client={client} thumb={thumb} audience={audience} />;
    case 'pesukim':
      return <PesukimInput source={source} client={client} thumb={thumb} audience={audience} />;
    case 'countdown':
      return <CountdownInput timer={k.timer} background={k.background} logoUrl={k.logo ?? null} client={client} />;
    case 'microphone':
      return (
        <div
          style={{ ...fill, background: '#101216', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8e9096', fontSize: 28 }}
          data-kind="microphone"
        >
          🎤
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
        {slide && (
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
              background: '#000',
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
      behind={behind && behind.kind.type !== 'pesukim' ? <SourceBody source={behind} client={client} thumb={thumb} audience={audience} /> : null}
    />
  );
}

function CountdownInput({ timer, background, logoUrl, client }: { timer: Countdown; background: string; logoUrl: string | null; client: EngineClient }) {
  const stage = useStage();
  // At the end: this countdown's own picture, or else the event logo.
  const logo = logoUrl ?? stage?.event.logo ?? null;
  return <CountdownView countdown={timer} background={background} logoUrl={logo ? client.mediaUrl(logo) : null} />;
}

/** What the audience sees instead of something broken: black, or the event logo if chosen in the event setup. */
export function SafeScreenView({ reason = 'failure' }: { reason?: 'failure' | 'panic' }) {
  const stage = useStage();
  const ev = stage?.event;
  const choice = reason === 'panic' ? ev?.panicShows : ev?.onFailure;
  const logo = choice === 'logo' ? ev?.logo : null;
  return (
    <div style={{ ...fill, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-failed>
      {logo && stage && <img src={stage.mediaUrl(logo)} alt="" draggable={false} style={{ maxWidth: '50%', maxHeight: '50%', objectFit: 'contain' }} />}
    </div>
  );
}

function ImageView({ url, fit, audience }: { url: string; fit: 'cover' | 'contain'; audience: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (failed) return <Missing text="Picture file not found" audience={audience} />;
  return <img src={url} alt="" draggable={false} style={{ ...fill, objectFit: fit }} data-kind="image" onError={() => setFailed(true)} />;
}

function CameraView({ deviceId, fit, audience }: { deviceId: string; fit: 'cover' | 'contain'; audience: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed(true);
      return;
    }
    acquireCamera(deviceId).then(
      (stream) => {
        if (!alive || !ref.current) return;
        // Unplugged during the show: the track ends and the screen goes black.
        const tracks = stream.getVideoTracks();
        if (tracks.length === 0 || tracks.every((t) => t.readyState === 'ended')) return setFailed(true);
        tracks.forEach((t) => t.addEventListener('ended', () => alive && setFailed(true)));
        ref.current.srcObject = stream;
        void ref.current.play().catch(() => {});
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      releaseCamera(deviceId);
    };
  }, [deviceId]);
  if (failed) return <Missing text="Camera not found or unplugged" audience={audience} />;
  return <video ref={ref} muted playsInline autoPlay style={{ ...fill, objectFit: fit, background: '#000' }} data-kind="camera" />;
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
