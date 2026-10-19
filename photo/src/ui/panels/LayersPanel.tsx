// Layers: blend mode, opacity, fill and locks for the active layer; the stack
// (top first) with groups, masks, clipping and effects; drag to reorder.

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronDown, Folder, FolderOpen, Link2, CornerLeftDown, Trash2, Plus, FolderPlus, SquareDashed, Circle, SlidersHorizontal, Type, Shapes, Box, Grid3x3, Move as MoveIcon, Paintbrush } from 'lucide-react';
import { current, useApp, bump, openDialog, requestFrame, app } from '../../app/state';
import * as ops from '../../app/ops/layers';
import { findLayer, allLayers } from '../../core/layers';
import { BLEND_GROUPS, BLEND_NAMES, type BlendMode } from '../../core/blend';
import { STYLE_NAMES, STYLE_ORDER, hasStyles } from '../../core/styles';
import { ADJUSTMENT_NAMES, ADJUSTMENT_ORDER } from '../../core/adjust';
import { hex } from '../../core/color';
import { Select, NumberField } from '../fields';
import { gradientCss } from '../util';
import { ContextMenu } from '../MenuBar';
import { run } from '../../app/commands';
import type { Layer, Doc } from '../../core/types';
import type { Raster } from '../../core/raster';

const BLEND_OPTIONS: [BlendMode, string][] = BLEND_GROUPS.flat().map((m) => [m, BLEND_NAMES[m]]);

// ---- thumbnails ----

const thumbCache = new WeakMap<Raster, { v: number; w: number; h: number; url: string }>();

/** A small picture of a raster over the whole canvas (checkerboard behind). */
export function rasterThumb(r: Raster, doc: Pick<Doc, 'width' | 'height'>, size = 64, gray = false, bg = 0): string {
  const hit = thumbCache.get(r);
  if (hit && hit.v === r.version && hit.w === doc.width && hit.h === doc.height) return hit.url;
  const k = size / Math.max(doc.width, doc.height);
  const w = Math.max(1, Math.round(doc.width * k)),
    h = Math.max(1, Math.round(doc.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const im = ctx.createImageData(w, h);
  const px = new Float32Array(4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = Math.min(doc.width - 1, Math.floor((x + 0.5) / k)),
        dy = Math.min(doc.height - 1, Math.floor((y + 0.5) / k));
      const o = (y * w + x) * 4;
      const checker = ((x >> 2) + (y >> 2)) & 1 ? 204 : 255;
      if (r.channels === 1) {
        const tile = r.tiles.size ? r.pixel(dx, dy, px)[0]! : bg;
        const v = Math.round((r.tiles.size ? tile : bg) * 255);
        im.data[o] = im.data[o + 1] = im.data[o + 2] = v;
        im.data[o + 3] = 255;
        continue;
      }
      r.pixel(dx, dy, px);
      const a = px[3]!;
      for (let ch = 0; ch < 3; ch++) {
        const v = gray ? px[0]! : px[ch]!;
        im.data[o + ch] = Math.round((Math.min(1, Math.max(0, v)) * a + (checker / 255) * (1 - a)) * 255);
      }
      im.data[o + 3] = 255;
    }
  ctx.putImageData(im, 0, 0);
  const url = c.toDataURL();
  thumbCache.set(r, { v: r.version, w: doc.width, h: doc.height, url });
  return url;
}

function KindIcon({ l }: { l: Layer }) {
  const size = 18;
  switch (l.kind) {
    case 'adjust':
      return <SlidersHorizontal size={size} />;
    case 'group':
      return null;
    default:
      return null;
  }
}

function Thumb({ l, doc, target, onClick }: { l: Layer; doc: Doc; target: boolean; onClick: (e: React.MouseEvent) => void }) {
  let inner: React.ReactNode = null;
  if (l.kind === 'adjust') inner = <SlidersHorizontal size={18} />;
  else if (l.kind === 'fill') {
    const c = l.content;
    if (c.type === 'solid') inner = <span style={{ width: '100%', height: '100%', background: hex(c.color) }} />;
    else if (c.type === 'gradient') inner = <span style={{ width: '100%', height: '100%', background: gradientCss(c.gradient, c.reverse) }} />;
    else inner = <Grid3x3 size={18} />;
  } else if ('raster' in l) inner = <img src={rasterThumb(l.raster, doc)} alt="" draggable={false} />;
  return (
    <span className={`lp-thumb${target ? ' lp-target' : ''}`} onClick={onClick}>
      {inner}
    </span>
  );
}

function badge(l: Layer): React.ReactNode {
  if (l.kind === 'text') return <Type size={12} />;
  if (l.kind === 'shape') return <Shapes size={12} />;
  if (l.kind === 'smart') return <Box size={12} />;
  return null;
}

type Drop = { id: string; where: 'above' | 'below' | 'into' } | null;

export function LayersPanel() {
  useApp((s) => s.rev);
  const s = current();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: (string | { label: string; items: string[] })[] } | null>(null);
  const dragIds = useRef<string[] | null>(null);
  const [opacityDraft, setOpacityDraft] = useState<number | null>(null);
  useEffect(() => setOpacityDraft(null), [s?.active]);

  if (!s) return <div className="lp-empty">No document</div>;
  const doc = s.doc;
  const active = s.activeLayer();

  const rows: { l: Layer; depth: number }[] = [];
  const walkTop = (list: Layer[], depth: number) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i]!;
      rows.push({ l, depth });
      if (l.kind === 'group' && l.open) walkTop(l.children, depth + 1);
    }
  };
  walkTop(doc.layers, 0);

  const click = (l: Layer, e: React.MouseEvent) => {
    if (e.shiftKey) ops.selectLayer(l.id, 'range');
    else if (e.ctrlKey || e.metaKey) ops.selectLayer(l.id, 'toggle');
    else ops.selectLayer(l.id);
  };

  const setActive = (patch: Partial<Layer>, label: string, merge = true) => {
    if (!active) return;
    ops.setLayer(active.id, patch, label, 'layer', merge);
  };

  const locks = active?.locks ?? {};
  const lockBtn = (k: 'transparency' | 'pixels' | 'position' | 'all', title: string, icon: React.ReactNode) => (
    <button className="lp-icon-btn" aria-pressed={!!locks[k]} title={title} aria-label={title} disabled={!active} onClick={() => active && ops.setLayer(active.id, { locks: { ...locks, [k]: !locks[k] } }, 'Lock')}>
      {icon}
    </button>
  );

  const onDragOver = (l: Layer) => (e: React.DragEvent) => {
    if (!dragIds.current) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const where = l.kind === 'group' && f > 0.3 && f < 0.7 ? 'into' : f < 0.5 ? 'above' : 'below';
    if (dragIds.current.includes(l.id)) return setDrop(null);
    setDrop({ id: l.id, where });
  };

  return (
    <div className="lp-layers">
      <div className="lp-layers-top">
        <Select value={active?.blend ?? 'normal'} options={active?.kind === 'group' ? [['passThrough' as BlendMode, 'Pass Through'], ...BLEND_OPTIONS] : BLEND_OPTIONS} onChange={(v) => {
          if (!active) return;
          if (active.kind === 'group') {
            if ((v as string) === 'passThrough') return ops.setLayer(active.id, { passThrough: true } as Partial<Layer>, 'Blending Change');
            return ops.setLayer(active.id, { blend: v, passThrough: false } as Partial<Layer>, 'Blending Change');
          }
          ops.setLayer(active.id, { blend: v }, 'Blending Change');
        }} title="Blend mode" />
        <NumberField label="Opacity" value={Math.round((opacityDraft ?? active?.opacity ?? 1) * 100)} min={0} max={100} suffix="%" width={40} disabled={!active} onChange={(v) => setActive({ opacity: v / 100 }, 'Opacity')} />
        <span />
        <span className="lp-locks">
          <span style={{ marginRight: 4 }}>Lock</span>
          {lockBtn('transparency', 'Lock transparent pixels', <SquareDashed size={14} />)}
          {lockBtn('pixels', 'Lock image pixels', <Paintbrush size={14} />)}
          {lockBtn('position', 'Lock position', <MoveIcon size={14} />)}
          {lockBtn('all', 'Lock all', locks.all ? <Lock size={14} /> : <Unlock size={14} />)}
          <span style={{ flex: 1 }} />
          <NumberField label="Fill" value={Math.round((active?.fill ?? 1) * 100)} min={0} max={100} suffix="%" width={40} disabled={!active} onChange={(v) => setActive({ fill: v / 100 }, 'Fill Opacity')} />
        </span>
      </div>
      <div
        className="lp-layers-list"
        role="tree"
        aria-label="Layers"
        aria-multiselectable="true"
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (dragIds.current) e.preventDefault();
        }}
        onDrop={() => {
          setDrop(null);
          dragIds.current = null;
        }}
      >
        {rows.map(({ l, depth }) => {
          const sel = s.selected.includes(l.id);
          const isActive = s.active === l.id;
          const styles = hasStyles(l.styles) ? STYLE_ORDER.filter((k) => l.styles?.[k]?.on) : [];
          const hiddenByParent = false;
          return (
            <div key={l.id}>
              <div
                className={`lp-layer${sel ? ' lp-sel' : ''}${drop?.id === l.id ? ` lp-drop-${drop.where}` : ''}${l.tag && l.tag !== 'none' ? ` lp-tag-${l.tag}` : ''}`}
                role="treeitem"
                aria-selected={sel}
                aria-label={l.name}
                draggable={renaming !== l.id}
                onDragStart={(e) => {
                  dragIds.current = sel ? s.selected : [l.id];
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', l.name);
                }}
                onDragEnd={() => {
                  dragIds.current = null;
                  setDrop(null);
                }}
                onDragOver={onDragOver(l)}
                onDrop={(e) => {
                  e.stopPropagation();
                  if (dragIds.current && drop) ops.moveTo(dragIds.current, drop.id, drop.where);
                  dragIds.current = null;
                  setDrop(null);
                }}
                onClick={(e) => click(l, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!sel) ops.selectLayer(l.id);
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    entries: [
                      'layer.style',
                      '-',
                      'layer.duplicate',
                      'layer.delete',
                      'layer.group',
                      '-',
                      'layer.toSmart',
                      'layer.rasterize',
                      'layer.rasterizeStyle',
                      '-',
                      'layer.maskReveal',
                      'layer.maskDelete',
                      'layer.maskApply',
                      'layer.clip',
                      '-',
                      'layer.mergeDown',
                      'layer.mergeVisible',
                      'layer.flatten',
                    ],
                  });
                }}
                style={{ opacity: hiddenByParent ? 0.5 : 1 }}
              >
                <button
                  className="lp-eye"
                  aria-label={l.visible ? 'Hide layer' : 'Show layer'}
                  title={l.visible ? 'Hide (Alt+click: show only this)' : 'Show'}
                  onClick={(e) => {
                    e.stopPropagation();
                    ops.toggleVisible(l.id, e.altKey);
                  }}
                >
                  {l.visible ? <Eye size={14} /> : <EyeOff size={14} style={{ opacity: 0.4 }} />}
                </button>
                <span style={{ width: depth * 14, flex: 'none' }} />
                {l.clip && (
                  <span className="lp-clip" title="Clipped to the layer below">
                    <CornerLeftDown size={13} />
                  </span>
                )}
                {l.kind === 'group' ? (
                  <>
                    <button
                      className="lp-twist"
                      aria-label={l.open ? 'Collapse group' : 'Expand group'}
                      onClick={(e) => {
                        e.stopPropagation();
                        s.doc = { ...s.doc, layers: updateOpen(s.doc.layers, l.id, !l.open) };
                        bump();
                      }}
                    >
                      {l.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <span className="lp-thumb" style={{ background: 'none', width: 22 }}>
                      {l.open ? <FolderOpen size={16} /> : <Folder size={16} />}
                    </span>
                  </>
                ) : (
                  <Thumb
                    l={l}
                    doc={doc}
                    target={isActive && !s.editMask && !!l.mask}
                    onClick={(e) => {
                      if (isActive && s.editMask) {
                        e.stopPropagation();
                        s.editMask = false;
                        bump();
                      }
                    }}
                  />
                )}
                {l.mask && (
                  <>
                    {l.mask.linked && l.kind !== 'group' && <Link2 size={11} style={{ color: 'var(--faint)', flex: 'none' }} />}
                    <span
                      className={`lp-thumb${isActive && s.editMask ? ' lp-target' : ''}`}
                      title="Layer mask (Shift+click: disable, Alt+click: show alone)"
                      style={{ opacity: l.mask.enabled ? 1 : 0.4 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) {
                          ops.selectLayer(l.id);
                          ops.toggleMaskEnabled();
                          return;
                        }
                        if (e.altKey) {
                          s.showMask = s.showMask === l.id ? null : l.id;
                          s.compositor?.invalidate();
                          bump();
                          return;
                        }
                        ops.selectLayer(l.id);
                        s.editMask = true;
                        bump();
                      }}
                    >
                      <img src={rasterThumb(l.mask.raster, doc, 64, true, l.mask.background)} alt="" draggable={false} />
                    </span>
                  </>
                )}
                <span className="lp-name" onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenaming(l.id);
                }}>
                  {renaming === l.id ? (
                    <input
                      className="lp-input"
                      autoFocus
                      defaultValue={l.name}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== l.name) ops.setLayer(l.id, { name: v }, 'Rename Layer');
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <span style={{ fontStyle: l.kind === 'pixel' && l.locks.position && l.name === 'Background' ? 'italic' : undefined }}>{l.name}</span>
                  )}
                </span>
                <span className="lp-badges">
                  {badge(l)}
                  <KindIcon l={l} />
                  {(l.locks.all || l.locks.pixels || l.locks.position || l.locks.transparency) && <Lock size={11} />}
                  {styles.length > 0 && (
                    <button
                      className="lp-fx"
                      title="Layer style"
                      onClick={(e) => {
                        e.stopPropagation();
                        ops.selectLayer(l.id);
                        openDialog('layerStyle');
                      }}
                    >
                      fx
                    </button>
                  )}
                </span>
              </div>
              {styles.length > 0 && (
                <div className="lp-layer-effects" onClick={() => ops.selectLayer(l.id)}>
                  {styles.map((k) => (
                    <div
                      key={k}
                      onDoubleClick={() => {
                        ops.selectLayer(l.id);
                        openDialog('layerStyle', { tab: k });
                      }}
                    >
                      {STYLE_NAMES[k]}
                    </div>
                  ))}
                </div>
              )}
              {l.kind === 'smart' && l.filters.length > 0 && (
                <div className="lp-layer-effects">
                  <div>Smart Filters</div>
                  {[...l.filters].reverse().map((f) => (
                    <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        className="lp-icon-btn"
                        style={{ width: 18, height: 18 }}
                        aria-label={f.visible ? 'Hide filter' : 'Show filter'}
                        onClick={() => void toggleSmartFilter(l.id, f.id)}
                      >
                        {f.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                      <span>{filterName(f.filter)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!rows.length && <div className="lp-empty">No layers</div>}
      </div>
      <div className="lp-panel-foot">
        <button className="lp-icon-btn" title="Add a layer style" aria-label="Add a layer style" disabled={!active} onClick={() => openDialog('layerStyle')}>
          <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: 12 }}>fx</span>
        </button>
        <button className="lp-icon-btn" title="Add a mask (Alt: hide all)" aria-label="Add a mask" disabled={!active || !!active.mask} onClick={(e) => ops.addMask(s.doc.selection ? (e.altKey ? 'hideSelection' : 'selection') : e.altKey ? 'hide' : 'reveal')}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
              <circle cx="8" cy="8" r="3" fill="currentColor" />
            </svg>
          </span>
        </button>
        <button
          className="lp-icon-btn"
          title="New fill or adjustment layer"
          aria-label="New fill or adjustment layer"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: r.left, y: r.top - 420, entries: ['layer.fillSolid', 'layer.fillGradient', 'layer.fillPattern', '-', ...ADJUSTMENT_ORDER.map((t) => `layer.adj.${t}`)] });
          }}
        >
          <Circle size={15} style={{ clipPath: 'inset(0 50% 0 0)' }} fill="currentColor" />
        </button>
        <button className="lp-icon-btn" title="New group" aria-label="New group" onClick={() => ops.newGroup()}>
          <FolderPlus size={16} />
        </button>
        <button className="lp-icon-btn" title="New layer (Ctrl+Shift+N)" aria-label="New layer" onClick={() => ops.newLayer()}>
          <Plus size={16} />
        </button>
        <button className="lp-icon-btn" title="Delete layer" aria-label="Delete layer" disabled={!active} onClick={() => ops.deleteLayers()}>
          <Trash2 size={15} />
        </button>
      </div>
      {menu && <ContextMenu entries={menu.entries} x={menu.x} y={Math.max(8, menu.y)} onClose={() => setMenu(null)} />}
    </div>
  );
}

function updateOpen(list: Layer[], id: string, open: boolean): Layer[] {
  return list.map((l) => (l.id === id && l.kind === 'group' ? { ...l, open } : l.kind === 'group' ? { ...l, children: updateOpen(l.children, id, open) } : l));
}

function filterName(id: string): string {
  if (id.startsWith('adj:')) return ADJUSTMENT_NAMES[id.slice(4) as keyof typeof ADJUSTMENT_NAMES] ?? id;
  return FILTER_NAMES.get(id) ?? id;
}

import { FILTERS } from '../../core/filters/registry';
import { rerender } from '../../app/layerContent';
import { change } from '../../app/ops/common';
import { updateLayer } from '../../core/layers';
const FILTER_NAMES = new Map(FILTERS.map((f) => [f.id, f.name]));

async function toggleSmartFilter(layerId: string, filterId: string): Promise<void> {
  const s = current();
  const l = s && findLayer(s.doc.layers, layerId);
  if (!s || !l || l.kind !== 'smart') return;
  const next = { ...l, filters: l.filters.map((f) => (f.id === filterId ? { ...f, visible: !f.visible } : f)) };
  const drawn = await rerender(next, s.doc);
  change('Smart Filter Visibility', 'filter', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, () => drawn) }));
  requestFrame();
}
