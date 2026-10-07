import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { createEngineClient } from '../engine/client';
import { useEventFonts } from '../engine/fonts';
import { OverlayRenderer } from '../engine/overlayRenderer';
import type { EngineInfo } from '../engine/unified';
import { useShow } from '../engine/useShow';

/**
 * The unified engine's overlay renderer for one screen: a hidden window
 * (src-tauri/src/live.rs opens it) that draws the screen's graphics and
 * sends what changed to the engine. Nothing of it is ever on a display.
 */
export function OverlayView({ screen }: { screen: 'live' | 'back' }) {
  const client = useMemo(createEngineClient, []);
  const { snapshot } = useShow(client);
  useEventFonts(snapshot?.show.event.brand.fonts, client);
  const [renderer, setRenderer] = useState<OverlayRenderer | null>(null);

  useEffect(() => {
    document.title = `Lumora — ${screen} graphics`;
    let alive = true;
    let made: OverlayRenderer | null = null;
    void invoke<EngineInfo>('live_engine_info').then((info) => {
      if (!alive || !info.size) return;
      const { width, height, fps } = info.size;
      made = new OverlayRenderer(client, screen, width, height, fps, (bytes) => invoke('live_engine_graphics', bytes));
      made.start();
      // For the test event and the self-test: how the renderer is doing.
      (window as Window & { lumoraOverlay?: OverlayRenderer }).lumoraOverlay = made;
      setRenderer(made);
    });
    return () => {
      alive = false;
      made?.dispose();
    };
  }, [client, screen]);

  useEffect(() => {
    if (renderer && snapshot) renderer.setShow(snapshot.show);
  }, [renderer, snapshot]);

  return null;
}
