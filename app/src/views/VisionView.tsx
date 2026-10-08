import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { createEngineClient } from '../engine/client';
import type { EngineInfo } from '../engine/unified';
import { useShow } from '../engine/useShow';
import { makeBackdrop, VisionWorker } from '../engine/visionWorker';

/**
 * The unified engine's vision worker: a hidden window (src-tauri/src/live.rs
 * opens it while an input uses background removal, blur behind people or
 * auto-framing) that runs the person-finding models on the engine's small
 * frames of those cameras and sends back what it found. Nothing of it is
 * ever on a display.
 */
export function VisionView() {
  const client = useMemo(createEngineClient, []);
  const { snapshot } = useShow(client);
  const [worker, setWorker] = useState<VisionWorker | null>(null);

  useEffect(() => {
    document.title = 'Lumora — person finding';
    let alive = true;
    let made: VisionWorker | null = null;
    void invoke<EngineInfo>('live_engine_info').then((info) => {
      if (!alive) return;
      made = new VisionWorker({
        frames: () => invoke<ArrayBuffer>('live_engine_vision_frames'),
        send: (bytes) => invoke('live_engine_vision_result', bytes),
        outW: info.size?.width ?? 1920,
        backdrop: makeBackdrop((p) => client.mediaUrl(p)),
      });
      made.start();
      // For the test event and the self-test: how the worker is doing.
      (window as Window & { lumoraVision?: VisionWorker }).lumoraVision = made;
      setWorker(made);
    });
    return () => {
      alive = false;
      made?.stop();
    };
  }, [client]);

  useEffect(() => {
    if (worker && snapshot) worker.setShow(snapshot.show);
  }, [worker, snapshot]);

  return null;
}
