import type { CSSProperties } from 'react';
import { useEnginePreview } from '../engine/unified';

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

/**
 * A picture from the unified engine (Settings → Engine → Unified): an input
 * (`source/<id>`) or a screen (`program/live`, `next/back`), small and a few
 * times a second. The camera itself is opened by the engine, never here.
 */
export function EnginePreview({ previewKey, fit = 'contain' }: { previewKey: string; fit?: 'cover' | 'contain' }) {
  const url = useEnginePreview(previewKey);
  if (!url) return <div style={{ ...fill, background: '#000' }} data-kind="engine-preview" />;
  return <img src={url} alt="" draggable={false} style={{ ...fill, objectFit: fit, background: '#000' }} data-kind="engine-preview" />;
}
