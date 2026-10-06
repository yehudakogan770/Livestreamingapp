// Auto-framing for PTZ cameras: instead of zooming into the picture (which
// softens it), Lumora steers the camera itself, with its real optical zoom.
// It watches the camera's picture, and turns and zooms the camera so the
// people stay framed. Runs in the control window only (one driver per camera).

import { useEffect, useRef } from 'react';
import type { EngineClient, PtzCommand } from './client';
import type { AutoFrame } from './types/AutoFrame';
import type { Show } from './types/Show';
import { acquireCamera, releaseCamera } from './cameras';
import { InputVision, subject, wantedZoom, type Box } from './vision';

/** How the camera should move now: pan and tilt (−1 – 1, 0: still) and zoom (−1 wider, 0, 1 closer). */
export interface PtzPlan {
  pan: number;
  tilt: number;
  speed: number;
  zoom: -1 | 0 | 1;
  zoomSpeed: number;
}

export const STILL: PtzPlan = { pan: 0, tilt: 0, speed: 0, zoom: 0, zoomSpeed: 0 };

/** Turn where the people are into a camera move. Small offsets are left alone, so it stays calm. */
export function ptzPlan(people: Box[], f: Pick<AutoFrame, 'who' | 'tightness' | 'speed'>): PtzPlan {
  const b = subject(people, f);
  if (!b) return STILL;
  const dx = b.x + b.w / 2 - 0.5;
  const dy = b.y + b.h / 2 - 0.5;
  const pace = 0.25 + 0.75 * Math.min(1, Math.max(0, f.speed));
  const axis = (d: number) => (Math.abs(d) < 0.08 ? 0 : Math.sign(d));
  const pan = axis(dx);
  // Tilt up is positive; down the picture is positive y.
  const tilt = axis(dy) === 0 ? 0 : -axis(dy);
  const speed = pan || tilt ? Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) * 2) * pace : 0;
  const z = wantedZoom(b);
  const zoom = z > 1.25 ? 1 : z < 0.85 ? -1 : 0;
  return { pan, tilt, speed, zoom, zoomSpeed: zoom ? 0.15 + 0.35 * pace : 0 };
}

/** The camera commands that take it from one plan to the next (none if nothing changed). */
export function commandsFor(before: PtzPlan, next: PtzPlan): PtzCommand[] {
  const out: PtzCommand[] = [];
  const moving = (p: PtzPlan) => p.pan !== 0 || p.tilt !== 0;
  if (moving(next)) {
    if (next.pan !== before.pan || next.tilt !== before.tilt || Math.abs(next.speed - before.speed) > 0.15)
      out.push({ type: 'move', pan: next.pan, tilt: next.tilt, speed: next.speed });
  } else if (moving(before)) out.push({ type: 'stop' });
  if (next.zoom !== before.zoom) out.push({ type: 'zoom', dir: next.zoom, speed: next.zoomSpeed });
  return out;
}

/** Follow people with every PTZ camera that has auto-framing on (control window). */
export function usePtzFollow(show: Show | null, client: EngineClient): void {
  const showRef = useRef(show);
  showRef.current = show;
  const key = (show?.sources ?? [])
    .filter((s) => s.kind.type === 'camera' && s.ptz?.host && s.autoFrame?.enabled)
    .map((s) => s.id)
    .join(',');
  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    const stops: (() => void)[] = [];
    for (const id of ids) {
      const src = showRef.current?.sources.find((s) => s.id === id);
      if (!src || src.kind.type !== 'camera' || !src.ptz) continue;
      const deviceId = src.kind.deviceId;
      const ptz = src.ptz;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      const vision = new InputVision();
      let plan = STILL;
      let alive = true;
      const send = (c: PtzCommand) => void client.ptz(ptz, c).catch(() => {});
      const opening = acquireCamera(deviceId);
      opening.then(
        (st) => {
          if (!alive) return;
          video.srcObject = st;
          void video.play().catch(() => {});
        },
        () => {}, // A camera that can't open just isn't followed.
      );
      const latest = () => showRef.current?.sources.find((s) => s.id === id)?.autoFrame ?? src.autoFrame;
      const timer = setInterval(() => {
        if (video.readyState < 2) return;
        const af = latest();
        const looked = vision.lookedAt;
        vision.update(video, video.videoWidth, video.videoHeight, { mode: 'keep', blur: 0, picture: null, edge: 0 }, af, 1920);
        if (vision.lookedAt === looked) return;
        const next = vision.broken ? STILL : ptzPlan(vision.people, af);
        for (const c of commandsFor(plan, next)) send(c);
        plan = next;
      }, 100);
      stops.push(() => {
        alive = false;
        clearInterval(timer);
        // Never leave a camera moving.
        for (const c of commandsFor(plan, STILL)) send(c);
        video.srcObject = null;
        releaseCamera(deviceId, opening);
      });
    }
    return () => stops.forEach((s) => s());
    // Restarts only when the cameras that follow change (settings are read live).
  }, [key, client]);
}
