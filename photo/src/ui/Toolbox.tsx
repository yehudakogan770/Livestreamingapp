// The toolbar: one button per tool group (the last tool used in it), the
// rest in a flyout (right-click or hold), then the colors and quick mask.

import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Move,
  Frame,
  SquareDashed,
  CircleDashed,
  Rows2,
  Columns2,
  Lasso,
  LassoSelect,
  Magnet,
  SquareDashedMousePointer,
  Wand,
  Crop,
  Grid2x2,
  Slice,
  Pipette,
  Crosshair,
  Ruler,
  Bandage,
  Eraser,
  Brush,
  Pencil,
  Replace,
  Paintbrush,
  Stamp,
  Grid3x3,
  History,
  PaintBucket,
  Blend,
  Droplet,
  Triangle,
  Hand,
  ZoomIn,
  RotateCw,
  PenTool,
  PenLine,
  Spline,
  Plus,
  Minus,
  ChevronsUpDown,
  Type,
  MousePointer2,
  MousePointer,
  Square,
  Circle,
  Pentagon,
  Slash,
  Shapes,
  Sun,
  Moon,
  CircleDot,
  Eye,
  Fingerprint,
  SprayCan,
  ArrowLeftRight,
  Scissors,
  Focus,
  CircleSlash,
  type LucideProps,
} from 'lucide-react';
import { app, openDialog, setTool, useApp } from '../app/state';
import { TOOL_GROUPS, type ToolId } from '../app/toolDefs';
import { run, shortcutLabel } from '../app/commands';
import { hex } from '../core/color';

export const TOOL_ICONS: Record<ToolId, ComponentType<LucideProps>> = {
  move: Move,
  artboard: Frame,
  marqueeRect: SquareDashed,
  marqueeEllipse: CircleDashed,
  marqueeRow: Rows2,
  marqueeColumn: Columns2,
  lasso: Lasso,
  polyLasso: LassoSelect,
  magneticLasso: Magnet,
  objectSelect: SquareDashedMousePointer,
  quickSelect: Brush,
  magicWand: Wand,
  crop: Crop,
  perspectiveCrop: Grid2x2,
  slice: Slice,
  eyedropper: Pipette,
  colorSampler: Crosshair,
  ruler: Ruler,
  spotHeal: Bandage,
  removeTool: CircleSlash,
  heal: Bandage,
  patch: Scissors,
  redEye: Eye,
  brush: Paintbrush,
  pencil: Pencil,
  colorReplace: Replace,
  mixer: Blend,
  clone: Stamp,
  patternStamp: Grid3x3,
  historyBrush: History,
  eraser: Eraser,
  bgEraser: Eraser,
  magicEraser: Eraser,
  gradient: Blend,
  bucket: PaintBucket,
  blur: Droplet,
  sharpen: Triangle,
  smudge: Fingerprint,
  dodge: Sun,
  burn: Moon,
  sponge: SprayCan,
  pen: PenTool,
  freeformPen: PenLine,
  curvaturePen: Spline,
  addAnchor: Plus,
  deleteAnchor: Minus,
  convertPoint: ChevronsUpDown,
  type: Type,
  typeVertical: Type,
  pathSelect: MousePointer2,
  directSelect: MousePointer,
  rect: Square,
  ellipse: Circle,
  triangle: Triangle,
  polygon: Pentagon,
  line: Slash,
  customShape: Shapes,
  hand: Hand,
  rotateView: RotateCw,
  zoom: ZoomIn,
};

// The gradient tool gets its own little square (no lucide icon reads as one).
function GradientIcon({ size = 18 }: LucideProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M11 3v18" strokeOpacity={0.85} />
      <path d="M15 3v18" strokeOpacity={0.5} />
      <path d="M19 3v18" strokeOpacity={0.25} />
    </svg>
  );
}
TOOL_ICONS.gradient = GradientIcon;

/** Separators after these groups (Photoshop's toolbar sections). */
const BREAK_AFTER = new Set([4, 6, 13, 17]);

export function ToolIcon({ id, size = 18 }: { id: ToolId; size?: number }) {
  const I = TOOL_ICONS[id];
  return <I size={size} strokeWidth={1.75} />;
}

export function Toolbox() {
  const tool = useApp((s) => s.tool);
  const groupTool = useApp((s) => s.groupTool);
  const fg = useApp((s) => s.fg);
  const bg = useApp((s) => s.bg);
  const quick = useApp((s) => s.sessions.find((x) => x.id === s.current)?.quickMask ?? false);
  useApp((s) => s.rev);
  const [fly, setFly] = useState<{ gi: number; x: number; y: number } | null>(null);
  const hold = useRef(0);
  useEffect(() => {
    if (!fly) return;
    const close = () => setFly(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [fly]);

  return (
    <div className="lp-toolbox" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOL_GROUPS.map((g, gi) => {
        const visible = g.filter((t) => !t.hidden);
        if (!visible.length) return null;
        const inGroup = visible.some((t) => t.id === tool);
        const shown = inGroup ? visible.find((t) => t.id === tool)! : (visible.find((t) => t.id === groupTool[gi]) ?? visible[0]!);
        const openFly = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          setFly({ gi, x: r.right + 4, y: r.top });
        };
        return (
          <div key={gi} style={{ display: 'contents' }}>
            <button
              className="lp-tool"
              aria-pressed={inGroup}
              aria-label={shown.name}
              title={`${shown.name}${shown.key ? ` (${shown.key})` : ''}`}
              onPointerDown={(e) => {
                if (e.button !== 0 || visible.length < 2) return;
                const el = e.currentTarget;
                hold.current = window.setTimeout(() => openFly(el), 380);
              }}
              onPointerUp={() => clearTimeout(hold.current)}
              onPointerLeave={() => clearTimeout(hold.current)}
              onClick={() => setTool(shown.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (visible.length > 1) openFly(e.currentTarget);
              }}
            >
              <ToolIcon id={shown.id} />
              {visible.length > 1 && <span className="lp-more" />}
            </button>
            {BREAK_AFTER.has(gi) && <div className="lp-tool-sep" />}
          </div>
        );
      })}
      <div className="lp-tool-sep" />
      <div className="lp-colors">
        <button className="lp-fg" style={{ background: hex(fg) }} title="Foreground color" aria-label="Foreground color" onClick={() => openDialog('colorPicker', { target: 'fg' })} />
        <button className="lp-bg" style={{ background: hex(bg) }} title="Background color" aria-label="Background color" onClick={() => openDialog('colorPicker', { target: 'bg' })} />
        <button className="lp-mini" style={{ right: -2, top: 0 }} title={`Switch colors (${shortcutLabel('X')})`} aria-label="Switch colors" onClick={() => app.set((s) => ({ fg: s.bg, bg: s.fg }))}>
          <ArrowLeftRight size={11} />
        </button>
        <button className="lp-mini" style={{ left: 0, bottom: -2 }} title="Default colors (D)" aria-label="Default colors" onClick={() => app.set({ fg: [0, 0, 0], bg: [1, 1, 1] })}>
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <rect x="0.5" y="0.5" width="6" height="6" fill="#000" stroke="#888" />
            <rect x="4.5" y="4.5" width="6" height="6" fill="#fff" stroke="#888" />
          </svg>
        </button>
      </div>
      <button className="lp-tool" aria-pressed={quick} title="Edit in Quick Mask Mode (Q)" aria-label="Quick Mask" onClick={() => void run('select.quickMask')} style={{ marginTop: 4 }}>
        {quick ? <CircleDot size={18} strokeWidth={1.75} /> : <Focus size={18} strokeWidth={1.75} />}
      </button>
      {fly && (
        <div className="lp-tool-flyout" style={{ left: fly.x, top: Math.min(fly.y, window.innerHeight - 40 * TOOL_GROUPS[fly.gi]!.length) }} onPointerDown={(e) => e.stopPropagation()} role="menu">
          {TOOL_GROUPS[fly.gi]!.filter((t) => !t.hidden).map((t) => (
            <button
              key={t.id}
              role="menuitem"
              className="lp-menu-item"
              onClick={() => {
                setTool(t.id);
                setFly(null);
              }}
            >
              <ToolIcon id={t.id} size={16} />
              <span>{t.name}</span>
              <span className="lp-keys">{t.key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
