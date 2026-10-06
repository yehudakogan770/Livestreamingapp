// The render cache's settings and menu: the mode (Off, Smart, User), where
// files go and how big the cache may grow, the files' size and quality,
// making the film from the cache, and hardware decoding and encoding.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { current } from '../model/seq';
import type { Project } from '../model/types';
import type { Doc } from '../doc';
import { inApp } from '../native';
import { Choice, Modal, type MenuEntry } from '../ui/controls';
import { makeProxies, proxyOptions } from '../ui/importer';
import { renderCache } from './manager';
import { cacheNative, type HwStatus } from './native';
import { bytesText } from './report';
import type { CacheSettings } from './settings';
import './cache.css';

let shown = false;
const listeners = new Set<() => void>();
export function openCacheSettings(v = true) {
  shown = v;
  for (const f of listeners) f();
}
const useShown = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => shown,
  );

let version = 0;
const subscribeCache = (f: () => void) =>
  renderCache.subscribe(() => {
    version++;
    f();
  });

/** The media used by the selected clips (or the whole open sequence, when none are selected). */
function selectedMedia(p: Project, ids: string[]) {
  const s = current(p);
  const clips = ids.length ? s.clips.filter((c) => ids.includes(c.id)) : s.clips;
  const used = new Set<string>();
  for (const c of clips) {
    if (c.source.kind === 'media') used.add(c.source.media);
    if (c.source.kind === 'multicam') {
      const src = c.source;
      const a = p.groups.find((g) => g.id === src.group)?.angles.find((x) => x.id === src.angle);
      if (a) used.add(a.media);
    }
  }
  return p.media.filter((m) => used.has(m.id));
}

/** Render cache and proxy entries for the View menu. */
export function cacheMenu(doc: Doc, selected: string[]): MenuEntry[] {
  const o = renderCache.settings;
  const s = current(doc.project);
  const marked = s.inPoint !== null && s.outPoint !== null && s.outPoint > s.inPoint;
  return [
    {
      label: 'Render cache',
      items: [
        { label: 'Off', checked: o.mode === 'off', run: () => renderCache.set({ mode: 'off' }) },
        { label: 'Smart (heavy stretches)', checked: o.mode === 'smart', run: () => renderCache.set({ mode: 'smart' }) },
        { label: 'User (marked ranges)', checked: o.mode === 'user', run: () => renderCache.set({ mode: 'user' }) },
        {
          label: 'Cache in to out',
          disabled: !marked,
          run: () => {
            renderCache.set({ mode: 'user' });
            renderCache.mark(s.id, [s.inPoint as number, s.outPoint as number]);
          },
        },
        { label: 'Forget marked ranges', disabled: !renderCache.marks(s.id).length, run: () => renderCache.mark(s.id, null) },
        { label: 'Clear render cache', run: () => void renderCache.clear() },
        { label: 'Render cache settings…', run: () => openCacheSettings() },
      ],
    },
    {
      label: selected.length ? 'Generate proxies for selection' : 'Generate proxies for this sequence',
      disabled: !inApp(),
      run: () => makeProxies(doc, selectedMedia(doc.project, selected), true),
    },
  ];
}

export function CacheDialog() {
  const show = useShown();
  useSyncExternalStore(subscribeCache, () => version);
  const [hw, setHw] = useState<HwStatus | null>(null);
  useEffect(() => {
    if (!show || !inApp()) return;
    void cacheNative
      .hwStatus()
      .then(setHw)
      .catch(() => setHw(null));
    void renderCache.reload();
  }, [show]);
  if (!show) return null;
  const o = renderCache.settings;
  const set = (c: Partial<CacheSettings>) => renderCache.set(c);
  const st = renderCache.stats;
  const close = () => openCacheSettings(false);
  return (
    <Modal title="Render cache" onClose={close}>
      <div className="form">
        <p className="insp__note">
          Stretches of the timeline too heavy to play smoothly (many layers, color nodes, AI masks, optical-flow speed changes, nested sequences) are drawn once
          in the background while playback is stopped, and played from the cached files. A red line over the ruler marks what still needs caching, blue what is
          cached. Any change to a clip throws away only the cached stretches it touches.
        </p>
        <label className="form__row">
          <span>Mode</span>
          <Choice
            label="Render cache mode"
            value={o.mode}
            options={[
              ['off', 'Off'],
              ['smart', 'Smart'],
              ['user', 'User'],
            ]}
            onChange={(mode) => set({ mode })}
          />
        </label>
        <label className="form__row">
          <span>Size</span>
          <Choice
            label="Cache file size"
            value={o.size}
            options={[
              ['viewer', 'Viewer (up to 1080)'],
              ['half', 'Half'],
              ['full', 'Full'],
            ]}
            onChange={(size) => set({ size })}
          />
        </label>
        <label className="form__check">
          <input type="checkbox" checked={o.high} onChange={(e) => set({ high: e.target.checked })} /> High quality (bigger files)
        </label>
        <label className="form__check">
          <input type="checkbox" checked={o.forExport} onChange={(e) => set({ forExport: e.target.checked })} /> Make the film from cached pictures when they
          match it (full size, high quality). Off: always from the originals.
        </label>
        <label className="form__row">
          <span>Folder</span>
          <span className="extras__inline">
            <span className="rcache__stat">{renderCache.folder || o.folder || 'The app’s cache folder'}</span>
            <button
              type="button"
              className="btn"
              disabled={!inApp()}
              onClick={() =>
                void openDialog({ directory: true, title: 'Render cache folder' }).then((d) => {
                  if (typeof d === 'string') set({ folder: d });
                })
              }
            >
              Choose…
            </button>
            {o.folder && (
              <button type="button" className="btn" onClick={() => set({ folder: '' })}>
                Default
              </button>
            )}
          </span>
        </label>
        <label className="form__row">
          <span>Size limit</span>
          <span className="extras__inline">
            <input
              className="text"
              type="number"
              min={1}
              max={4096}
              value={o.limitGb}
              onChange={(e) => set({ limitGb: Math.max(1, Math.min(4096, Number(e.target.value) || 1)) })}
            />{' '}
            GB
          </span>
        </label>
        <p className="rcache__stat">
          {st.files} cached file{st.files === 1 ? '' : 's'}, {bytesText(st.bytes)}
          {st.made ? ` · ${st.made} made this session at ${(st.frames / Math.max(0.001, st.ms / 1000)).toFixed(1)} fps` : ''}
        </p>
        <label className="form__check">
          <input type="checkbox" checked={o.hwDecode} onChange={(e) => set({ hwDecode: e.target.checked })} /> Decode with the graphics card (proxies, cache,
          the film’s originals)
          {hw ? ` · ${hw.method ? `using ${hw.method}` : 'none found: software'}${hw.fellBack ? ' (it failed once: software now)' : ''}` : ''}
        </label>
        <label className="form__check">
          <input
            type="checkbox"
            checked={o.hwEncode}
            onChange={(e) => {
              set({ hwEncode: e.target.checked });
              proxyOptions.hardware = e.target.checked;
            }}
          />{' '}
          Encode proxies and cache files with the graphics card’s encoder (when one works)
        </label>
        <div className="form__foot">
          <button type="button" className="btn" onClick={() => void renderCache.clear()}>
            Clear render cache
          </button>
          <button type="button" className="btn btn--primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
