import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { BrowserInput } from '../engine/types/BrowserInput';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { BrowserView, useBrowserInfo } from '../components/BrowserView';
import { cleanUrl } from '../engine/browser';
import type { Act } from './act';
import './BrowserCard.css';

const SIZES: [string, number, number][] = [
  ['1280 × 720', 1280, 720],
  ['1920 × 1080', 1920, 1080],
  ['1080 × 1080 (square)', 1080, 1080],
  ['1080 × 1920 (tall)', 1080, 1920],
  ['800 × 600', 800, 600],
];
const ZOOMS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];

/**
 * A web page, run live: address, back / forward / reload, zoom, auto
 * refresh, and clicking on the page itself (it has its own window).
 */
export function BrowserCard({ show, source, act, client, onClose }: { show: Show; source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const page = source.kind.type === 'browser' ? source.kind : null;
  const [url, setUrl] = useState(page?.url ?? '');
  const [clicking, setClicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const info = useBrowserInfo(client);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => setUrl(page?.url ?? ''), [page?.url]);
  if (!page) return null;
  const { type: _type, ...current } = page;
  const set = (p: Partial<BrowserInput>) => act({ type: 'updateBrowser', id: source.id, browser: { ...current, ...p } });
  const go = () => {
    const clean = cleanUrl(url);
    if (!clean) return setProblem('That isn’t a web address.');
    setProblem(null);
    set({ url: clean });
  };
  const nav = (how: 'back' | 'forward' | 'reload') => {
    if (how === 'reload') set({ reload: page.reload + 1 });
    else void client.browserNav(source.id, how).catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };
  const click = (front: boolean) =>
    void client.browserPage(source.id, front).then(
      () => setClicking(front),
      (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)),
    );
  const onAir = (['live', 'back'] as const).filter((sc) => show.screens[sc].program === source.id);
  const zi = ZOOMS.indexOf(page.zoom);
  const size = SIZES.findIndex(([, w, h]) => w === page.width && h === page.height);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Web page" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box brc">
        <header className="modal__head">
          <h2>Web page — {source.name}</h2>
          <span className="remote__spacer" />
          {onAir.map((sc) => (
            <span key={sc} className="brc__air">
              ON AIR · {sc === 'live' ? 'LIVE' : 'BACK'}
            </span>
          ))}
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="brc__body">
          <section className="brc__main">
            <form
              className="brc__bar"
              onSubmit={(e) => {
                e.preventDefault();
                go();
              }}
            >
              <button type="button" className="btn" aria-label="Back" title="Back" onClick={() => nav('back')}>
                ‹
              </button>
              <button type="button" className="btn" aria-label="Forward" title="Forward" onClick={() => nav('forward')}>
                ›
              </button>
              <button type="button" className="btn" aria-label="Reload" title="Reload the page" onClick={() => nav('reload')}>
                ⟳
              </button>
              <input className="text brc__url" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Web address" spellCheck={false} />
              <button type="submit" className="btn btn--primary">
                Go
              </button>
            </form>
            <div className="brc__stage" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
              <BrowserView id={source.id} page={page} client={client} fit="contain" />
            </div>
            <div className="brc__status">
              <span>
                {page.width} × {page.height}
              </span>
              <span>Zoom {page.zoom}%</span>
              <span>{info?.captured ? 'Captured from its own window' : 'Shown directly (some sites refuse this)'}</span>
            </div>
            {problem && (
              <p className="field__note field__note--warn" role="alert">
                {problem}
              </p>
            )}
          </section>
          <section className="brc__side">
            <span className="brc__label">CLICKING ON THE PAGE</span>
            {info?.captured ? (
              <>
                <button type="button" className={`btn${clicking ? ' is-on' : ''}`} onClick={() => click(!clicking)} disabled={page.viewOnly}>
                  {clicking ? 'Done — send the page window back' : 'Bring the page window to the front'}
                </button>
                <span className="field__note">Log in, scroll or click on the page in its own window. The screens follow what it shows.</span>
              </>
            ) : (
              <span className="field__note">Click and scroll on the page above.</span>
            )}
            <label className="check">
              <input type="checkbox" checked={page.viewOnly} onChange={(e) => set({ viewOnly: e.target.checked })} /> View only (clicks are blocked)
            </label>

            <span className="brc__label">PAGE</span>
            <div className="brc__row">
              <span>Zoom</span>
              <button
                type="button"
                className="btn"
                aria-label="Zoom out"
                disabled={zi <= 0}
                onClick={() => set({ zoom: ZOOMS[Math.max(0, (zi < 0 ? 7 : zi) - 1)]! })}
              >
                −
              </button>
              <b>{page.zoom}%</b>
              <button
                type="button"
                className="btn"
                aria-label="Zoom in"
                disabled={zi >= ZOOMS.length - 1}
                onClick={() => set({ zoom: ZOOMS[Math.min(ZOOMS.length - 1, (zi < 0 ? 7 : zi) + 1)]! })}
              >
                +
              </button>
              <button type="button" className="btn" onClick={() => set({ zoom: 100 })}>
                100%
              </button>
            </div>
            <div className="brc__row">
              <span>Size</span>
              <select
                value={size}
                onChange={(e) => {
                  const s = SIZES[Number(e.target.value)];
                  if (s) set({ width: s[1], height: s[2] });
                }}
                aria-label="Page size"
              >
                {size < 0 && (
                  <option value={-1}>
                    {page.width} × {page.height}
                  </option>
                )}
                {SIZES.map(([n], i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="brc__row">
              <span>Refresh</span>
              <select value={page.refreshMin} onChange={(e) => set({ refreshMin: Number(e.target.value) })} aria-label="Auto refresh">
                <option value={0}>Only when I press ⟳</option>
                <option value={1}>Every minute</option>
                <option value={5}>Every 5 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={60}>Every hour</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={page.transparent} onChange={(e) => set({ transparent: e.target.checked })} /> See-through background (for pages
              made as overlays)
            </label>
            <span className="field__note">Sound from the page plays through this computer’s speakers.</span>
          </section>
        </div>
      </div>
    </div>
  );
}
