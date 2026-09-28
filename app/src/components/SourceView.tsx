import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import { syncMedia } from '../engine/mediaSync';
import { useCountdown, useStage } from '../engine/CountdownContext';
import { CountdownView } from './CountdownOverlay';

// ---- cameras: one stream per device, shared by every view in this window ----

const cameras = new Map<string, { stream: Promise<MediaStream>; users: number }>();

function acquireCamera(deviceId: string): Promise<MediaStream> {
  let entry = cameras.get(deviceId);
  if (!entry) {
    const stream = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
      },
    });
    entry = { stream, users: 0 };
    cameras.set(deviceId, entry);
    stream.catch(() => cameras.delete(deviceId));
  }
  entry.users++;
  return entry.stream;
}

function releaseCamera(deviceId: string) {
  const entry = cameras.get(deviceId);
  if (!entry) return;
  entry.users--;
  if (entry.users <= 0) {
    cameras.delete(deviceId);
    void entry.stream.then(
      (s) => s.getTracks().forEach((t) => t.stop()),
      () => {},
    );
  }
}

// ---- views ----

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

/** SMPTE-style bars, drawn with CSS so they never need a file. */
const PATTERN =
  'linear-gradient(90deg,#c0c0c0 0 14.28%,#c0c000 0 28.57%,#00c0c0 0 42.85%,#00c000 0 57.14%,#c000c0 0 71.42%,#c00000 0 85.71%,#0000c0 0)';

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
}

/** Draws one source filling its box. */
export function SourceView({
  source,
  client,
  thumb = false,
  reportDuration = false,
  audience = false,
}: SourceViewProps) {
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
    case 'countdown':
      return <CountdownInput background={k.background} logoUrl={k.logo ?? null} client={client} />;
    case 'microphone':
      return (
        <div style={{ ...fill, background: '#101216', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8e9096', fontSize: 28 }} data-kind="microphone">
          🎤
        </div>
      );
    case 'video':
      return (
        <VideoView
          source={source}
          client={client}
          fit={fit}
          thumb={thumb}
          reportDuration={reportDuration}
          audience={audience}
        />
      );
  }
}

function CountdownInput({ background, logoUrl, client }: { background: string; logoUrl: string | null; client: EngineClient }) {
  const c = useCountdown();
  const stage = useStage();
  // At the end: this countdown's own picture, or else the event logo.
  const logo = logoUrl ?? stage?.event.logo ?? null;
  return c ? <CountdownView countdown={c} background={background} logoUrl={logo ? client.mediaUrl(logo) : null} /> : <div style={{ ...fill, background }} />;
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
}: Required<Omit<SourceViewProps, 'source' | 'client'>> & { source: Source; client: EngineClient; fit: 'cover' | 'contain' }) {
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

function Missing({ text, audience }: { text: string; audience: boolean }) {
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
