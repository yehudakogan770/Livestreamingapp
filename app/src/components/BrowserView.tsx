import { useEffect, useState, type CSSProperties } from 'react';
import type { EngineClient } from '../engine/client';
import type { BrowserInput } from '../engine/types/BrowserInput';
import { browserInfo, servedUrl, type BrowserInfo } from '../engine/browser';

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

/** Where this window gets web page frames from (null until known). */
export function useBrowserInfo(client: EngineClient) {
  const [info, setInfo] = useState<{ port: number | null; captured: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void browserInfo(() => client.browserInfo()).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [client]);
  return info;
}

/**
 * A web page input. In Lumora on Windows the page lives in its own window and
 * arrives here as a live picture; otherwise the page is shown directly
 * (sites that refuse to be shown inside another page stay blank then).
 */
export function BrowserView({
  id,
  page,
  client,
  fit,
  thumb = false,
  audience = false,
}: {
  id: string;
  page: BrowserInput;
  client: EngineClient;
  fit: 'cover' | 'contain';
  thumb?: boolean;
  audience?: boolean;
}) {
  const info = useBrowserInfo(client);
  const blank = page.url === 'https://';
  if (!info || blank) return <div style={{ ...fill, background: audience ? 'transparent' : '#121212' }} data-kind="browser" />;
  if (info.captured && info.port) return <FramePicture info={info} id={id} fit={fit} kind="browser" />;
  if (thumb) {
    const host = page.url.replace(/^[a-z]+:\/\//i, '').split('/')[0];
    return (
      <div
        style={{ ...fill, background: '#121212', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ababab', fontSize: 11, padding: 6 }}
        data-kind="browser"
      >
        {host}
      </div>
    );
  }
  return <PageFrame page={page} />;
}

/** Live pictures served by the app (web pages, stream inputs). */
export function FramePicture({ info, id, fit, kind }: { info: BrowserInfo; id: string; fit: 'cover' | 'contain'; kind: string }) {
  return <img src={servedUrl(info, `stream/${encodeURIComponent(id)}`) ?? ''} alt="" draggable={false} style={{ ...fill, objectFit: fit }} data-kind={kind} />;
}

/** A stream input (SRT, RTMP, RTSP, HLS…): black until its pictures arrive. */
export function StreamView({
  id,
  client,
  fit,
  audience = false,
  note = 'Streams show in the Lumora app',
}: {
  id: string;
  client: EngineClient;
  fit: 'cover' | 'contain';
  audience?: boolean;
  note?: string;
}) {
  const info = useBrowserInfo(client);
  return (
    <div style={{ ...fill, background: audience ? 'transparent' : '#000' }} data-kind="stream">
      {info?.port ? (
        <FramePicture info={info} id={id} fit={fit} kind="stream" />
      ) : (
        !audience &&
        info && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#909090', fontSize: 12 }}>{note}</span>
      )}
    </div>
  );
}

/** The page itself, at its size and zoom, scaled to fill the box. */
function PageFrame({ page }: { page: BrowserInput }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!box) return;
    const fit = () => setScale(Math.min(box.clientWidth / page.width, box.clientHeight / page.height) || 1);
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [box, page.width, page.height]);
  const z = page.zoom / 100;
  return (
    <div ref={setBox} style={{ ...fill, overflow: 'hidden', background: page.transparent ? 'transparent' : '#fff' }} data-kind="browser">
      <iframe
        key={page.reload}
        src={page.url}
        title="Web page"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: page.width / z,
          height: page.height / z,
          border: 0,
          background: 'transparent',
          transform: `translate(-50%, -50%) scale(${scale * z})`,
          pointerEvents: page.viewOnly ? 'none' : undefined,
        }}
      />
    </div>
  );
}
