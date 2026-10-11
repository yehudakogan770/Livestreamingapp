// What a tool is: pointer handlers in document coordinates (with pen
// pressure and modifier keys), keys, a cursor, and what it draws over the
// canvas (handles, outlines, the brush circle).

import type { ToolId } from '../toolDefs';
import type { Session } from '../session';
import { current } from '../state';
import { apply, docToScreenMatrix, invert, type Affine } from '../viewMath';

export interface ToolEvent {
  /** Document coordinates (fractional). */
  x: number;
  y: number;
  /** Screen (CSS px, relative to the canvas). */
  sx: number;
  sy: number;
  pressure: number;
  button: number;
  shift: boolean;
  alt: boolean;
  /** Ctrl, or ⌘ on a Mac. */
  ctrl: boolean;
  pointerType: string;
  /** Double click. */
  detail: number;
}

export interface Overlay {
  ctx: CanvasRenderingContext2D;
  s: Session;
  /** Document → screen (CSS px). */
  toScreen: (x: number, y: number) => [number, number];
  zoom: number;
  time: number;
}

export interface Tool {
  id: ToolId;
  cursor?: (e: ToolEvent | null) => string;
  down?: (e: ToolEvent) => void;
  move?: (e: ToolEvent) => void;
  up?: (e: ToolEvent) => void;
  hover?: (e: ToolEvent) => void;
  /** Return true when the key was used. */
  key?: (e: KeyboardEvent) => boolean;
  overlay?: (o: Overlay) => void;
  /** The tool was switched away from (finish or drop work in progress). */
  leave?: () => void;
  /** Painting tools: the brush diameter in document pixels (for the cursor circle). */
  brushSize?: () => number;
  /** Something being edited that Enter commits / Escape cancels. */
  active?: () => boolean;
  commit?: () => void;
  cancel?: () => void;
}

/** The canvas element's size (CSS px), kept by the canvas view. */
export const viewport = { w: 800, h: 600, el: null as HTMLElement | null };

export function matrices(s: Session = current()!): { toScreen: Affine; toDoc: Affine } {
  const m = docToScreenMatrix(s.view, s.doc.width, s.doc.height);
  return { toScreen: m, toDoc: invert(m) };
}

export function toScreen(x: number, y: number, s: Session = current()!): [number, number] {
  return apply(matrices(s).toScreen, x, y);
}

export function toDoc(sx: number, sy: number, s: Session = current()!): [number, number] {
  return apply(matrices(s).toDoc, sx, sy);
}

/** Screen pixels → document pixels at the current zoom. */
export const docPx = (screenPx: number, s: Session = current()!) => screenPx / s.view.zoom;
