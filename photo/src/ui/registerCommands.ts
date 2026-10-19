// Every command the menus, shortcuts and actions use, with Photoshop's
// default shortcuts.

import { register, type Command } from '../app/commands';
import { app, current, openDialog, setTool, toast, bump, requestFrame, removeSession, addSession, setOpts } from '../app/state';
import * as edit from '../app/ops/edit';
import * as layers from '../app/ops/layers';
import * as sel from '../app/ops/select';
import * as image from '../app/ops/image';
import * as files from '../app/files';
import { applyFilter, repeatLastFilter, lastFilter, canFilter } from '../app/ops/filter';
import { freeTransform, quickTransform, isTransforming, commitTransform, cancelTransform, nudge } from '../app/tools/transform';
import { fitOnScreen, actualPixels, printSize, zoomStep } from '../app/tools/viewTools';
import { straightenByRuler } from '../app/tools/miscTools';
import { ADJUSTMENT_ORDER, ADJUSTMENT_NAMES, autoLevels, histogram, type AdjustmentType } from '../core/adjust';
import { FILTERS } from '../core/filters/registry';
import { TOOL_GROUPS, type ToolId } from '../app/toolDefs';
import { sendTo } from '../app/sendTo';
import { toolFor } from '../app/tools';
import { hasRaster } from '../core/layers';
import { getHost } from '../app/host';
import { blankDoc } from '../core/doc';
import { SRGB } from '../core/color';
import { setPathTarget } from '../app/tools/vectorTools';
import { sampleSource } from '../app/tools/selectTools';
import { selectSubject } from '../app/objectSelect';
import { flatten, workRect } from '../app/ops/common';
import { commitText, isEditingText } from '../app/tools/typeTool';
import { cropActive, commitCrop, cancelCrop } from '../app/tools/cropTools';
import { defaultTip } from '../app/toolDefs';

const doc = () => !!current();
const layer = () => !!current()?.activeLayer();
const pixelLayer = () => {
  const l = current()?.activeLayer();
  return !!l && l.kind === 'pixel';
};
const selection = () => !!current()?.doc.selection;

export async function closeDoc(id = app.get().current): Promise<boolean> {
  const s = app.get().sessions.find((x) => x.id === id);
  if (!s) return true;
  if (s.unsaved) {
    const ok = await confirmDialog(`Save changes to “${s.doc.name}” before closing?`, ['Save', 'Don’t Save', 'Cancel']);
    if (ok === 2 || ok === null) return false;
    if (ok === 0 && !(await files.save(s))) return false;
  }
  removeSession(s.id);
  return true;
}

/** A small question dialog: resolves with the button index (null: closed). */
export function confirmDialog(text: string, buttons: string[]): Promise<number | null> {
  return new Promise((resolve) => openDialog('confirm', { text, buttons, resolve }));
}

/** Image ▸ Adjustments (on the pixels): the adjustment's dialog. */
function adjustPixels(t: AdjustmentType) {
  return () => {
    const l = current()?.activeLayer();
    if (!l || (l.kind !== 'pixel' && l.kind !== 'smart' && !current()?.editMask)) {
      toast('Adjustments change a pixel layer’s pixels. For other layers, use an adjustment layer.');
      return;
    }
    if (t === 'invert') return applyFilter('adj:invert', {}, 'Invert');
    openDialog('adjustPixels', { type: t });
  };
}

function autoAdjust(mode: 'tone' | 'contrast' | 'color') {
  return async () => {
    const s = current();
    const l = s?.activeLayer();
    if (!s || !l || !hasRaster(l)) return;
    const r = workRect(s.doc);
    const px = l.raster.read(r);
    const p = autoLevels(histogram(px, 4, Math.max(1, Math.floor((r.w * r.h) / 400000))), mode);
    await applyFilter('adj:levels', p as unknown as Record<string, unknown>, mode === 'tone' ? 'Auto Tone' : mode === 'contrast' ? 'Auto Contrast' : 'Auto Color');
  };
}

function toggle(key: 'showRulers' | 'showGrid' | 'showGuides' | 'showExtras' | 'snap' | 'pixelGrid') {
  return () => {
    app.set((s) => ({ [key]: !s[key] }) as never);
    requestFrame();
  };
}

/** Brush size and hardness ([ and ], with Shift for hardness). */
function brushStep(dir: 1 | -1, hardness: boolean) {
  return () => {
    const st = app.get();
    const keyMap: Partial<Record<ToolId, keyof typeof st.opts>> = {
      brush: 'brush',
      pencil: 'pencil',
      eraser: 'eraser',
      bgEraser: 'bgEraser',
      mixer: 'mixer',
      colorReplace: 'colorReplace',
      clone: 'clone',
      patternStamp: 'pattern',
      historyBrush: 'history',
      heal: 'heal',
      spotHeal: 'spot',
      removeTool: 'remove',
      blur: 'focus',
      sharpen: 'focus',
      smudge: 'focus',
      dodge: 'tone',
      burn: 'tone',
      sponge: 'tone',
    };
    const k = keyMap[st.tool];
    if (k) {
      const o = st.opts[k] as { tip: ReturnType<typeof defaultTip> };
      const tip = o.tip;
      if (hardness) setOpts(k, { tip: { ...tip, hardness: Math.max(0, Math.min(1, tip.hardness + dir * 0.25)) } } as never);
      else {
        const sz = tip.size;
        const step = sz < 10 ? 1 : sz < 50 ? 5 : sz < 100 ? 10 : sz < 300 ? 25 : sz < 1000 ? 50 : 100;
        setOpts(k, { tip: { ...tip, size: Math.max(1, Math.min(5000, sz + dir * step)) } } as never);
      }
      requestFrame();
      return;
    }
    // Other tools: arrange layers with Ctrl, otherwise nothing.
  };
}

export function registerCommands(): void {
  const list: Command[] = [
    // ---- File ----
    { id: 'file.new', label: 'New…', keys: 'Ctrl+N', run: () => openDialog('newDoc') },
    { id: 'file.open', label: 'Open…', keys: 'Ctrl+O', run: () => files.openDialog() },
    { id: 'file.place', label: 'Place Embedded…', run: () => files.placeFile(), enabled: doc },
    { id: 'file.close', label: 'Close', keys: 'Ctrl+W', run: () => void closeDoc(), enabled: doc },
    {
      id: 'file.closeAll',
      label: 'Close All',
      keys: 'Ctrl+Alt+W',
      enabled: doc,
      run: async () => {
        for (const s of [...app.get().sessions]) if (!(await closeDoc(s.id))) return;
      },
    },
    { id: 'file.save', label: 'Save', keys: 'Ctrl+S', run: () => void files.save(), enabled: doc },
    { id: 'file.saveAs', label: 'Save As…', keys: 'Ctrl+Shift+S', run: () => void files.save(current(), true), enabled: doc },
    { id: 'file.saveAsPsd', label: 'Save a Copy as Photoshop…', run: () => files.saveAsFormat('psd'), enabled: doc },
    { id: 'file.saveAsTiff', label: 'Save a Copy as TIFF…', run: () => files.saveAsFormat('tiff'), enabled: doc },
    {
      id: 'file.revert',
      label: 'Revert',
      keys: 'F12',
      enabled: () => !!current()?.unsaved,
      run: () => {
        const s = current();
        if (s) edit.goToStep(0);
        void s;
      },
    },
    { id: 'file.exportAs', label: 'Export As…', keys: 'Ctrl+Alt+Shift+W', run: () => openDialog('export'), enabled: doc },
    { id: 'file.quickExport', label: 'Quick Export as PNG', run: () => void files.quickExport(), enabled: doc },
    { id: 'file.exportArtboards', label: 'Artboards to Files…', run: () => openDialog('export', { parts: 'artboards' }), enabled: () => !!current()?.doc.artboards.length },
    { id: 'file.exportSlices', label: 'Slices to Files…', run: () => openDialog('export', { parts: 'slices' }), enabled: () => !!current()?.doc.slices.length },
    { id: 'file.sendLumora', label: 'Send to Lumora', run: () => sendTo('lumora'), enabled: doc },
    { id: 'file.sendStudio', label: 'Send to Lumora Studio', run: () => sendTo('studio'), enabled: doc },
    { id: 'file.sendTitler', label: 'Send to Lumora Titler', run: () => sendTo('titler'), enabled: doc },
    { id: 'file.batch', label: 'Batch…', run: () => openDialog('batch') },
    { id: 'file.print', label: 'Print…', keys: 'Ctrl+P', run: () => openDialog('print'), enabled: doc },
    { id: 'file.info', label: 'File Info…', keys: 'Ctrl+Alt+Shift+I', run: () => openDialog('fileInfo'), enabled: doc },

    // ---- Edit ----
    {
      id: 'edit.undo',
      label: 'Undo',
      keys: 'Ctrl+Z',
      enabled: () => !!current()?.history.canUndo || isTransforming(),
      run: () => {
        if (isTransforming()) return cancelTransform();
        if (isEditingText()) commitText();
        edit.undo();
      },
    },
    { id: 'edit.redo', label: 'Redo', keys: 'Ctrl+Shift+Z', enabled: () => !!current()?.history.canRedo, run: () => edit.redo() },
    { id: 'edit.cut', label: 'Cut', keys: 'Ctrl+X', enabled: layer, run: () => edit.copy(false, true), record: true },
    { id: 'edit.copy', label: 'Copy', keys: 'Ctrl+C', enabled: layer, run: () => edit.copy(false), record: true },
    { id: 'edit.copyMerged', label: 'Copy Merged', keys: 'Ctrl+Shift+C', enabled: doc, run: () => edit.copy(true), record: true },
    { id: 'edit.paste', label: 'Paste', keys: 'Ctrl+V', run: () => void pasteAny(false), record: true },
    { id: 'edit.pasteInPlace', label: 'Paste in Place', keys: 'Ctrl+Shift+V', run: () => void pasteAny(true), enabled: doc, record: true },
    { id: 'edit.pasteInto', label: 'Paste Into', keys: 'Ctrl+Alt+Shift+V', run: () => edit.pasteInto(), enabled: () => selection() && edit.hasClip(), record: true },
    { id: 'edit.clear', label: 'Clear', keys: 'Delete', run: () => edit.clearPixels(), enabled: layer, record: true },
    { id: 'edit.clear2', label: 'Clear', keys: 'Backspace', run: () => edit.clearPixels(), enabled: layer },
    { id: 'edit.fill', label: 'Fill…', keys: 'Shift+F5', run: () => openDialog('fill'), enabled: pixelLayer },
    { id: 'edit.fillFg', label: 'Fill with Foreground Color', keys: 'Alt+Backspace', run: () => edit.fillSelection({ use: 'fg', mode: 'normal', opacity: 1, preserveTransparency: false }), enabled: pixelLayer, record: true },
    { id: 'edit.fillBg', label: 'Fill with Background Color', keys: 'Ctrl+Backspace', run: () => edit.fillSelection({ use: 'bg', mode: 'normal', opacity: 1, preserveTransparency: false }), enabled: pixelLayer, record: true },
    { id: 'edit.stroke', label: 'Stroke…', run: () => openDialog('stroke'), enabled: pixelLayer },
    { id: 'edit.contentAwareFill', label: 'Content-Aware Fill', run: () => void import('../app/ops/heal').then((m) => m.contentAwareFill()), enabled: () => selection() && pixelLayer(), record: true },
    { id: 'edit.contentAwareScale', label: 'Content-Aware Scale…', keys: 'Ctrl+Alt+Shift+C', run: () => openDialog('contentAwareScale'), enabled: pixelLayer },
    { id: 'edit.freeTransform', label: 'Free Transform', keys: 'Ctrl+T', run: () => freeTransform('free'), enabled: layer },
    { id: 'edit.warp', label: 'Warp', run: () => freeTransform('warp'), enabled: layer },
    { id: 'edit.again', label: 'Transform Again', keys: 'Ctrl+Shift+T', run: () => freeTransform('free'), enabled: layer },
    { id: 'edit.rot180', label: 'Rotate 180°', run: () => quickTransform('rot180'), enabled: layer, record: true },
    { id: 'edit.rot90cw', label: 'Rotate 90° Clockwise', run: () => quickTransform('rot90cw'), enabled: layer, record: true },
    { id: 'edit.rot90ccw', label: 'Rotate 90° Counter Clockwise', run: () => quickTransform('rot90ccw'), enabled: layer, record: true },
    { id: 'edit.flipH', label: 'Flip Horizontal', run: () => quickTransform('flipH'), enabled: layer, record: true },
    { id: 'edit.flipV', label: 'Flip Vertical', run: () => quickTransform('flipV'), enabled: layer, record: true },
    { id: 'edit.definePattern', label: 'Define Pattern…', run: () => openDialog('prompt', { title: 'Pattern Name', value: 'Pattern 1', ok: (n: string) => edit.definePattern(n) }), enabled: doc },
    { id: 'edit.defineBrush', label: 'Define Brush Preset…', run: () => openDialog('prompt', { title: 'Brush Name', value: 'Brush 1', ok: (n: string) => saveBrushPreset(n) }) },
    { id: 'edit.shortcuts', label: 'Keyboard Shortcuts…', keys: 'Ctrl+Alt+Shift+K', run: () => openDialog('shortcuts') },
    { id: 'edit.prefs', label: 'Preferences…', keys: 'Ctrl+K', run: () => openDialog('prefs') },

    // ---- Image ----
    { id: 'image.depth8', label: '8 Bits/Channel', run: () => image.setDepth(8), enabled: doc, checked: () => current()?.doc.depth === 8, record: true },
    { id: 'image.depth16', label: '16 Bits/Channel', run: () => image.setDepth(16), enabled: doc, checked: () => current()?.doc.depth === 16, record: true },
    { id: 'image.depth32', label: '32 Bits/Channel', run: () => image.setDepth(32), enabled: doc, checked: () => current()?.doc.depth === 32, record: true },
    { id: 'image.autoTone', label: 'Auto Tone', keys: 'Ctrl+Shift+L', run: autoAdjust('tone'), enabled: pixelLayer, record: true },
    { id: 'image.autoContrast', label: 'Auto Contrast', keys: 'Ctrl+Alt+Shift+L', run: autoAdjust('contrast'), enabled: pixelLayer, record: true },
    { id: 'image.autoColor', label: 'Auto Color', keys: 'Ctrl+Shift+B', run: autoAdjust('color'), enabled: pixelLayer, record: true },
    { id: 'image.imageSize', label: 'Image Size…', keys: 'Ctrl+Alt+I', run: () => openDialog('imageSize'), enabled: doc },
    { id: 'image.canvasSize', label: 'Canvas Size…', keys: 'Ctrl+Alt+C', run: () => openDialog('canvasSize'), enabled: doc },
    { id: 'image.rot180', label: '180°', run: () => image.rotateCanvas(180), enabled: doc, record: true },
    { id: 'image.rot90cw', label: '90° Clockwise', run: () => image.rotateCanvas(90), enabled: doc, record: true },
    { id: 'image.rot90ccw', label: '90° Counter Clockwise', run: () => image.rotateCanvas(-90), enabled: doc, record: true },
    { id: 'image.rotArbitrary', label: 'Arbitrary…', run: () => openDialog('prompt', { title: 'Rotate Canvas (degrees clockwise)', value: '0', number: true, ok: (v: string) => image.rotateCanvas(parseFloat(v) || 0) }), enabled: doc },
    { id: 'image.flipH', label: 'Flip Canvas Horizontal', run: () => image.flipCanvas(true), enabled: doc, record: true },
    { id: 'image.flipV', label: 'Flip Canvas Vertical', run: () => image.flipCanvas(false), enabled: doc, record: true },
    { id: 'image.crop', label: 'Crop', run: () => image.cropToSelection(), enabled: selection, record: true },
    { id: 'image.trim', label: 'Trim…', run: () => openDialog('trim'), enabled: doc },
    { id: 'image.revealAll', label: 'Reveal All', run: () => image.revealAll(), enabled: doc, record: true },
    { id: 'image.duplicate', label: 'Duplicate…', run: () => image.duplicateDoc(), enabled: doc },
    { id: 'image.assignProfile', label: 'Assign Profile…', run: () => openDialog('profile', { mode: 'assign' }), enabled: doc },
    { id: 'image.convertProfile', label: 'Convert to Profile…', run: () => openDialog('profile', { mode: 'convert' }), enabled: doc },
    { id: 'image.straighten', label: 'Straighten by Ruler', run: () => straightenByRuler(), enabled: doc },
    { id: 'image.desaturate', label: 'Desaturate', keys: 'Ctrl+Shift+U', run: () => applyFilter('desaturate'), enabled: canFilter, record: true },
    { id: 'image.equalize', label: 'Equalize', run: () => applyFilter('equalize'), enabled: canFilter, record: true },
    { id: 'image.shadowsHighlights', label: 'Shadows/Highlights…', run: () => openDialog('filter', { id: 'shadowsHighlights' }), enabled: canFilter },
    { id: 'image.hdrToning', label: 'HDR Toning…', run: () => openDialog('filter', { id: 'hdrToning' }), enabled: canFilter },
    { id: 'image.replaceColor', label: 'Replace Color…', run: () => openDialog('filter', { id: 'replaceColor' }), enabled: canFilter },
    { id: 'image.matchColor', label: 'Match Color…', run: () => openDialog('filter', { id: 'matchColor' }), enabled: canFilter },
    ...ADJUSTMENT_ORDER.map(
      (t): Command => ({
        id: `image.adj.${t}`,
        label: `${ADJUSTMENT_NAMES[t]}${t === 'invert' ? '' : '…'}`,
        keys: ({ levels: 'Ctrl+L', curves: 'Ctrl+M', hueSaturation: 'Ctrl+U', colorBalance: 'Ctrl+B', blackWhite: 'Ctrl+Alt+Shift+B', invert: 'Ctrl+I' } as Partial<Record<AdjustmentType, string>>)[t],
        run: adjustPixels(t),
        enabled: canFilter,
        record: t === 'invert',
      }),
    ),

    // ---- Layer ----
    { id: 'layer.new', label: 'Layer…', keys: 'Ctrl+Shift+N', run: () => void layers.newLayer(), enabled: doc, record: true },
    { id: 'layer.newQuick', label: 'New Layer', keys: 'Ctrl+Alt+Shift+N', run: () => void layers.newLayer(), enabled: doc, record: true },
    { id: 'layer.group', label: 'Group Layers', keys: 'Ctrl+G', run: () => layers.groupSelected(), enabled: layer, record: true },
    { id: 'layer.newGroup', label: 'Group', run: () => layers.newGroup(), enabled: doc, record: true },
    { id: 'layer.ungroup', label: 'Ungroup Layers', keys: 'Ctrl+Shift+G', run: () => layers.ungroup(), enabled: () => current()?.activeLayer()?.kind === 'group', record: true },
    { id: 'layer.viaCopy', label: 'Layer via Copy', keys: 'Ctrl+J', run: () => layers.layerVia(false), enabled: layer, record: true },
    { id: 'layer.viaCut', label: 'Layer via Cut', keys: 'Ctrl+Shift+J', run: () => layers.layerVia(true), enabled: pixelLayer, record: true },
    { id: 'layer.duplicate', label: 'Duplicate Layer', run: () => layers.duplicate(), enabled: layer, record: true },
    { id: 'layer.delete', label: 'Delete Layer', run: () => layers.deleteLayers(), enabled: layer, record: true },
    { id: 'layer.fromBackground', label: 'Layer from Background', run: () => layers.layerFromBackground(), enabled: () => !!current()?.activeLayer()?.locks.position },
    { id: 'layer.style', label: 'Blending Options…', run: () => openDialog('layerStyle'), enabled: layer },
    { id: 'layer.clearStyle', label: 'Clear Layer Style', run: () => current()?.active && layers.setLayer(current()!.active!, { styles: undefined }, 'Clear Layer Style'), enabled: layer, record: true },
    { id: 'layer.fillSolid', label: 'Solid Color…', run: () => newFillLayer('solid'), enabled: doc },
    { id: 'layer.fillGradient', label: 'Gradient…', run: () => newFillLayer('gradient'), enabled: doc },
    { id: 'layer.fillPattern', label: 'Pattern…', run: () => newFillLayer('pattern'), enabled: doc },
    ...ADJUSTMENT_ORDER.map(
      (t): Command => ({
        id: `layer.adj.${t}`,
        label: `${ADJUSTMENT_NAMES[t]}…`,
        run: () => {
          layers.newAdjustment(t);
          openPanel('properties');
        },
        enabled: doc,
        record: true,
      }),
    ),
    { id: 'layer.maskReveal', label: 'Reveal All', run: () => layers.addMask('reveal'), enabled: layer, record: true },
    { id: 'layer.maskHide', label: 'Hide All', run: () => layers.addMask('hide'), enabled: layer, record: true },
    { id: 'layer.maskSelection', label: 'Reveal Selection', run: () => layers.addMask('selection'), enabled: selection, record: true },
    { id: 'layer.maskHideSelection', label: 'Hide Selection', run: () => layers.addMask('hideSelection'), enabled: selection, record: true },
    { id: 'layer.maskDelete', label: 'Delete', run: () => layers.deleteMask(false), enabled: () => !!current()?.activeLayer()?.mask, record: true },
    { id: 'layer.maskApply', label: 'Apply', run: () => layers.deleteMask(true), enabled: () => !!current()?.activeLayer()?.mask, record: true },
    { id: 'layer.maskToggle', label: 'Disable', run: () => layers.toggleMaskEnabled(), enabled: () => !!current()?.activeLayer()?.mask, checked: () => current()?.activeLayer()?.mask?.enabled === false },
    { id: 'layer.clip', label: 'Create Clipping Mask', keys: 'Ctrl+Alt+G', run: () => layers.toggleClip(), enabled: layer, record: true },
    { id: 'layer.toSmart', label: 'Convert to Smart Object', run: () => layers.convertToSmart(), enabled: layer, record: true },
    { id: 'layer.rasterize', label: 'Rasterize Layer', run: () => layers.rasterize(), enabled: () => !!current()?.activeLayer() && current()?.activeLayer()?.kind !== 'pixel', record: true },
    { id: 'layer.rasterizeStyle', label: 'Rasterize Layer Style', run: () => layers.rasterizeStyle(), enabled: () => !!current()?.activeLayer()?.styles },
    { id: 'layer.front', label: 'Bring to Front', keys: 'Ctrl+Shift+]', run: () => layers.arrange('top'), enabled: layer, record: true },
    { id: 'layer.forward', label: 'Bring Forward', keys: 'Ctrl+]', run: () => layers.arrange('up'), enabled: layer, record: true },
    { id: 'layer.backward', label: 'Send Backward', keys: 'Ctrl+[', run: () => layers.arrange('down'), enabled: layer, record: true },
    { id: 'layer.back', label: 'Send to Back', keys: 'Ctrl+Shift+[', run: () => layers.arrange('bottom'), enabled: layer, record: true },
    { id: 'layer.alignLeft', label: 'Left Edges', run: () => layers.align('left'), enabled: layer, record: true },
    { id: 'layer.alignHCenter', label: 'Horizontal Centers', run: () => layers.align('hcenter'), enabled: layer, record: true },
    { id: 'layer.alignRight', label: 'Right Edges', run: () => layers.align('right'), enabled: layer, record: true },
    { id: 'layer.alignTop', label: 'Top Edges', run: () => layers.align('top'), enabled: layer, record: true },
    { id: 'layer.alignVCenter', label: 'Vertical Centers', run: () => layers.align('vcenter'), enabled: layer, record: true },
    { id: 'layer.alignBottom', label: 'Bottom Edges', run: () => layers.align('bottom'), enabled: layer, record: true },
    { id: 'layer.mergeDown', label: 'Merge Down', keys: 'Ctrl+E', run: () => ((current()?.selected.length ?? 0) > 1 ? layers.mergeSelected() : layers.mergeDown()), enabled: layer, record: true },
    { id: 'layer.mergeVisible', label: 'Merge Visible', keys: 'Ctrl+Shift+E', run: () => layers.mergeVisible(), enabled: doc, record: true },
    { id: 'layer.stamp', label: 'Stamp Visible', keys: 'Ctrl+Alt+Shift+E', run: () => layers.stampVisible(), enabled: doc, record: true },
    { id: 'layer.flatten', label: 'Flatten Image', run: () => layers.flattenImage(), enabled: doc, record: true },

    // ---- Select ----
    { id: 'select.all', label: 'All', keys: 'Ctrl+A', run: () => sel.selectAll(), enabled: doc, record: true },
    { id: 'select.deselect', label: 'Deselect', keys: 'Ctrl+D', run: () => sel.deselect(), enabled: selection, record: true },
    { id: 'select.reselect', label: 'Reselect', keys: 'Ctrl+Shift+D', run: () => sel.reselect(), enabled: doc, record: true },
    { id: 'select.inverse', label: 'Inverse', keys: 'Ctrl+Shift+I', run: () => sel.inverse(), enabled: doc, record: true },
    { id: 'select.colorRange', label: 'Color Range…', run: () => openDialog('colorRange'), enabled: doc },
    { id: 'select.subject', label: 'Subject', run: () => subject(), enabled: doc, record: true },
    { id: 'select.mask', label: 'Select and Mask…', keys: 'Ctrl+Alt+R', run: () => app.set({ workspace: { kind: 'selectMask' } }), enabled: doc },
    { id: 'select.border', label: 'Border…', run: () => openDialog('modifySelection', { kind: 'border' }), enabled: selection },
    { id: 'select.smooth', label: 'Smooth…', run: () => openDialog('modifySelection', { kind: 'smooth' }), enabled: selection },
    { id: 'select.expand', label: 'Expand…', run: () => openDialog('modifySelection', { kind: 'expand' }), enabled: selection },
    { id: 'select.contract', label: 'Contract…', run: () => openDialog('modifySelection', { kind: 'contract' }), enabled: selection },
    { id: 'select.feather', label: 'Feather…', keys: 'Shift+F6', run: () => openDialog('modifySelection', { kind: 'feather' }), enabled: selection },
    { id: 'select.grow', label: 'Grow', run: () => sel.growSimilar(app.get().opts.wand.tolerance, false), enabled: selection, record: true },
    { id: 'select.similar', label: 'Similar', run: () => sel.growSimilar(app.get().opts.wand.tolerance, true), enabled: selection, record: true },
    { id: 'select.transform', label: 'Transform Selection', run: () => freeTransform('selection'), enabled: selection },
    { id: 'select.quickMask', label: 'Edit in Quick Mask Mode', keys: 'Q', run: () => sel.toggleQuickMask(), enabled: doc, checked: () => !!current()?.quickMask },
    { id: 'select.load', label: 'Load Selection…', run: () => openDialog('loadSelection'), enabled: () => !!current()?.doc.channels.length },
    { id: 'select.save', label: 'Save Selection…', run: () => openDialog('prompt', { title: 'Save Selection', value: `Alpha ${(current()?.doc.channels.length ?? 0) + 1}`, ok: (n: string) => sel.saveSelection(n) }), enabled: selection },

    // ---- Filter ----
    { id: 'filter.last', label: lastFilterLabel(), keys: 'Ctrl+Alt+F', run: () => repeatLastFilter(), enabled: () => !!lastFilter && canFilter() },
    { id: 'filter.smart', label: 'Convert for Smart Filters', run: () => layers.convertToSmart(), enabled: layer },
    { id: 'filter.cameraRaw', label: 'Camera Raw Filter…', keys: 'Ctrl+Shift+A', run: () => app.set({ workspace: { kind: 'cameraRaw' } }), enabled: canFilter },
    { id: 'filter.liquify', label: 'Liquify…', keys: 'Ctrl+Shift+X', run: () => app.set({ workspace: { kind: 'liquify' } }), enabled: pixelLayer },
    ...FILTERS.filter((f) => !f.hidden).map(
      (f): Command => ({
        id: `filter.${f.id}`,
        label: f.dialog === false ? f.name : `${f.name}…`,
        run: () => (f.dialog === false ? applyFilter(f.id) : openDialog('filter', { id: f.id })),
        enabled: canFilter,
        record: f.dialog === false,
      }),
    ),

    // ---- View ----
    { id: 'view.zoomIn', label: 'Zoom In', keys: 'Ctrl+=', run: () => zoomStep(1), enabled: doc },
    { id: 'view.zoomIn2', label: 'Zoom In', keys: 'Ctrl++', run: () => zoomStep(1), enabled: doc },
    { id: 'view.zoomOut', label: 'Zoom Out', keys: 'Ctrl+-', run: () => zoomStep(-1), enabled: doc },
    { id: 'view.fit', label: 'Fit on Screen', keys: 'Ctrl+0', run: () => fitOnScreen(), enabled: doc },
    { id: 'view.actual', label: '100%', keys: 'Ctrl+1', run: () => actualPixels(1), enabled: doc },
    { id: 'view.200', label: '200%', run: () => actualPixels(2), enabled: doc },
    { id: 'view.printSize', label: 'Print Size', run: () => printSize(), enabled: doc },
    {
      id: 'view.resetRotation',
      label: 'Reset Rotation',
      run: () => {
        const s = current();
        if (s) s.view = { ...s.view, rotation: 0 };
        bump();
      },
      enabled: () => !!current()?.view.rotation,
    },
    {
      id: 'view.flip',
      label: 'Flip Horizontal',
      run: () => {
        const s = current();
        if (s) s.view = { ...s.view, flip: !s.view.flip };
        bump();
      },
      enabled: doc,
      checked: () => !!current()?.view.flip,
    },
    { id: 'view.extras', label: 'Extras', keys: 'Ctrl+H', run: toggle('showExtras'), checked: () => app.get().showExtras },
    { id: 'view.grid', label: 'Grid', keys: "Ctrl+'", run: toggle('showGrid'), checked: () => app.get().showGrid },
    { id: 'view.guides', label: 'Guides', keys: 'Ctrl+;', run: toggle('showGuides'), checked: () => app.get().showGuides },
    { id: 'view.pixelGrid', label: 'Pixel Grid', run: toggle('pixelGrid'), checked: () => app.get().pixelGrid },
    { id: 'view.rulers', label: 'Rulers', keys: 'Ctrl+R', run: toggle('showRulers'), checked: () => app.get().showRulers },
    { id: 'view.snap', label: 'Snap', keys: 'Ctrl+Shift+;', run: toggle('snap'), checked: () => app.get().snap },
    { id: 'view.newGuide', label: 'New Guide…', run: () => openDialog('newGuide'), enabled: doc },
    {
      id: 'view.clearGuides',
      label: 'Clear Guides',
      run: () => {
        const s = current();
        if (!s || !s.doc.guides.length) return;
        s.commit('Clear Guides', 'guide', { ...s.doc, guides: [] });
        bump();
      },
      enabled: () => !!current()?.doc.guides.length,
    },
    {
      id: 'view.screenMode',
      label: 'Full Screen Mode',
      keys: 'F',
      run: () => app.set((s) => ({ screenMode: s.screenMode === 'full' ? 'standard' : 'full' })),
      checked: () => app.get().screenMode === 'full',
    },
    { id: 'view.theme', label: 'Light Interface', run: () => app.set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })), checked: () => app.get().theme === 'light' },

    // ---- Window / Help ----
    { id: 'window.reset', label: 'Reset Essentials', run: () => resetLayout() },
    { id: 'help.shortcuts', label: 'Keyboard Shortcuts', run: () => openDialog('shortcuts') },
    { id: 'help.about', label: 'About Lumora Photo', run: () => openDialog('about') },

    // ---- dialog results (recorded in actions with their settings) ----
    { id: 'filter.apply', label: 'Filter', record: true, run: (a) => applyFilter((a as { id: string }).id, (a as { params: Record<string, unknown> }).params, (a as { label?: string }).label), enabled: canFilter },
    { id: 'select.modifyBy', label: 'Modify Selection', record: true, run: (a) => sel.modify((a as { kind: 'border' }).kind, (a as { amount: number }).amount), enabled: selection },
    { id: 'image.resizeTo', label: 'Image Size', record: true, run: (a) => { const o = a as { w: number; h: number; method: 'bicubic'; resolution?: number }; return image.imageSize(o.w, o.h, o.method, o.resolution); }, enabled: doc },
    { id: 'image.canvasTo', label: 'Canvas Size', record: true, run: (a) => { const o = a as { w: number; h: number; ax: number; ay: number; fill: [number, number, number, number] | null }; image.canvasSize(o.w, o.h, o.ax, o.ay, o.fill); }, enabled: doc },
    { id: 'edit.fillWith', label: 'Fill', record: true, run: (a) => edit.fillSelection(a as edit.FillOptions), enabled: pixelLayer },
    { id: 'edit.strokeWith', label: 'Stroke', record: true, run: (a) => edit.strokeSelection(a as edit.StrokeOptions), enabled: pixelLayer },
    {
      id: 'image.squareCrop',
      label: 'Square Crop',
      record: true,
      enabled: doc,
      run: () => {
        const s = current();
        if (!s) return;
        const n = Math.min(s.doc.width, s.doc.height);
        image.cropTo({ x: Math.floor((s.doc.width - n) / 2), y: Math.floor((s.doc.height - n) / 2), w: n, h: n });
      },
    },

    // ---- keys without a menu ----
    { id: 'key.swap', label: 'Switch Foreground and Background Colors', keys: 'X', run: () => app.set((s) => ({ fg: s.bg, bg: s.fg })) },
    { id: 'key.defaults', label: 'Default Foreground and Background Colors', keys: 'D', run: () => app.set({ fg: [0, 0, 0], bg: [1, 1, 1] }) },
    { id: 'key.brushBigger', label: 'Increase Brush Size', keys: ']', run: brushStep(1, false) },
    { id: 'key.brushSmaller', label: 'Decrease Brush Size', keys: '[', run: brushStep(-1, false) },
    { id: 'key.brushHarder', label: 'Increase Brush Hardness', keys: 'Shift+]', run: brushStep(1, true) },
    { id: 'key.brushSofter', label: 'Decrease Brush Hardness', keys: 'Shift+[', run: brushStep(-1, true) },
    { id: 'key.hidePanels', label: 'Show/Hide Panels', keys: 'Tab', run: () => app.set((s) => ({ screenMode: s.screenMode === 'full' ? 'standard' : 'full' })) },
    { id: 'key.nudgeLeft', label: 'Nudge Left', keys: 'ArrowLeft', run: () => moveKey(-1, 0), enabled: doc },
    { id: 'key.nudgeRight', label: 'Nudge Right', keys: 'ArrowRight', run: () => moveKey(1, 0), enabled: doc },
    { id: 'key.nudgeUp', label: 'Nudge Up', keys: 'ArrowUp', run: () => moveKey(0, -1), enabled: doc },
    { id: 'key.nudgeDown', label: 'Nudge Down', keys: 'ArrowDown', run: () => moveKey(0, 1), enabled: doc },
    { id: 'key.nudgeLeft10', label: 'Nudge Left 10', keys: 'Shift+ArrowLeft', run: () => moveKey(-10, 0), enabled: doc },
    { id: 'key.nudgeRight10', label: 'Nudge Right 10', keys: 'Shift+ArrowRight', run: () => moveKey(10, 0), enabled: doc },
    { id: 'key.nudgeUp10', label: 'Nudge Up 10', keys: 'Shift+ArrowUp', run: () => moveKey(0, -10), enabled: doc },
    { id: 'key.nudgeDown10', label: 'Nudge Down 10', keys: 'Shift+ArrowDown', run: () => moveKey(0, 10), enabled: doc },
    { id: 'key.commit', label: 'Commit', keys: 'Enter', run: () => commitAny() },
    { id: 'key.cancel', label: 'Cancel', keys: 'Escape', run: () => cancelAny() },
    {
      id: 'key.newDocDefault',
      label: 'New Document (Default Size)',
      run: () => {
        addSession(blankDoc({ name: 'Untitled-1', width: 1920, height: 1080, depth: 8, resolution: 72, profile: SRGB, background: 'white' }));
      },
    },
  ];
  // Layer opacity with number keys when a non-painting tool is active.
  for (let n = 0; n <= 9; n++)
    list.push({
      id: `key.opacity${n}`,
      label: `Opacity ${n === 0 ? 100 : n * 10}%`,
      keys: String(n),
      run: () => opacityKey(n === 0 ? 1 : n / 10),
      enabled: doc,
    });
  // Tools: their letter picks them; Shift+letter goes through the group.
  const letters = new Map<string, ToolId[]>();
  for (const g of TOOL_GROUPS)
    for (const t of g)
      if (t.key && !t.hidden) {
        const a = letters.get(t.key) ?? [];
        a.push(t.id);
        letters.set(t.key, a);
      }
  for (const [k, ids] of letters) {
    list.push({ id: `tool.${k}`, label: `Tool: ${k}`, keys: k, run: () => pickToolKey(ids, false) });
    list.push({ id: `tool.shift.${k}`, label: `Cycle tools: ${k}`, keys: `Shift+${k}`, run: () => pickToolKey(ids, true) });
  }
  register(list);
}

function lastFilterLabel(): string {
  return 'Last Filter';
}

function pickToolKey(ids: ToolId[], cycle: boolean): void {
  const st = app.get();
  const groupIdx = (id: ToolId) => TOOL_GROUPS.findIndex((g) => g.some((t) => t.id === id));
  // Which group the letter means: the one with the current tool, else the one last used.
  const groups = [...new Set(ids.map(groupIdx))];
  const cur = groups.includes(groupIdx(st.tool)) ? groupIdx(st.tool) : groups[0]!;
  const inGroup = ids.filter((i) => groupIdx(i) === cur);
  if (cycle) {
    const all = ids;
    const i = all.indexOf(st.tool);
    setTool(all[(i + 1) % all.length]!);
    return;
  }
  if (inGroup.includes(st.tool)) return;
  setTool(st.groupTool[cur] && inGroup.includes(st.groupTool[cur]!) ? st.groupTool[cur]! : inGroup[0]!);
}

const PAINT_TOOLS: ToolId[] = ['brush', 'pencil', 'eraser', 'clone', 'patternStamp', 'historyBrush', 'mixer', 'heal', 'spotHeal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'gradient', 'bucket'];

function opacityKey(v: number): void {
  const st = app.get();
  if (PAINT_TOOLS.includes(st.tool)) {
    const map: Partial<Record<ToolId, 'brush' | 'pencil' | 'eraser' | 'clone' | 'pattern' | 'history' | 'gradient' | 'bucket'>> = {
      brush: 'brush',
      pencil: 'pencil',
      eraser: 'eraser',
      clone: 'clone',
      patternStamp: 'pattern',
      historyBrush: 'history',
      gradient: 'gradient',
      bucket: 'bucket',
    };
    const k = map[st.tool];
    if (k) setOpts(k, { opacity: v } as never);
    return;
  }
  const s = current();
  const l = s?.activeLayer();
  if (s && l) layers.setLayer(l.id, { opacity: v }, 'Opacity', 'layer', true);
}

function moveKey(dx: number, dy: number): void {
  const st = app.get();
  if (isTransforming()) {
    nudge(dx, dy);
    return;
  }
  if (st.tool === 'move' || current()?.doc.selection) nudge(dx, dy);
}

function commitAny(): void {
  if (isTransforming()) return void commitTransform();
  if (cropActive()) return void commitCrop();
  const t = toolFor(app.get().tool);
  if (t?.active?.()) t.commit?.();
}

function cancelAny(): void {
  if (isTransforming()) return cancelTransform();
  if (cropActive()) return cancelCrop();
  const t = toolFor(app.get().tool);
  if (t?.active?.()) return t.cancel?.();
  setPathTarget(null);
}

async function pasteAny(inPlace: boolean): Promise<void> {
  if (edit.hasClip()) {
    if (!current()) {
      // Paste with nothing open: a new document the clip's size.
      openDialog('newDoc', { fromClip: true });
      return;
    }
    edit.paste(inPlace);
    return;
  }
  // The system clipboard (a picture copied in another app).
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const bytes = new Uint8Array(await (await it.getType(type)).arrayBuffer());
      if (!current()) {
        await files.openPicked([{ name: 'Pasted', bytes }]);
        return;
      }
      const { placeBytes } = await import('../app/place');
      await placeBytes('Pasted', bytes);
      return;
    }
    toast('There is no picture on the clipboard.');
  } catch {
    toast('There is no picture on the clipboard.');
  }
}

function subject(): void {
  const src = sampleSource(true);
  if (!src) return;
  const m = selectSubject(src);
  if (!m) {
    toast('No subject was found. Try the Object Selection tool around it.');
    return;
  }
  sel.applySelection(m, 'replace', 'Select Subject');
}

function newFillLayer(kind: 'solid' | 'gradient' | 'pattern'): void {
  const st = app.get();
  if (kind === 'solid') {
    const l = layers.newFill({ type: 'solid', color: [...st.fg, 1] as [number, number, number, number] }, 'Color Fill');
    if (l) openPanel('properties');
    return;
  }
  if (kind === 'gradient') {
    void import('../core/gradient').then((g) => {
      layers.newFill({ type: 'gradient', gradient: g.fgToBg(st.fg, st.bg), angle: 90, scale: 1, style: 'linear', reverse: false, ox: 0, oy: 0 }, 'Gradient Fill');
      openPanel('properties');
    });
    return;
  }
  layers.newFill({ type: 'pattern', pattern: 'paper', scale: 1, ox: 0, oy: 0 }, 'Pattern Fill');
  openPanel('properties');
}

function saveBrushPreset(name: string): void {
  const st = app.get();
  app.set({ brushPresets: [...st.brushPresets, { name, tip: st.opts.brush.tip }] });
  toast(`Brush “${name}” saved.`);
}

/** Bring a panel forward in the dock (see Dock.tsx). */
export function openPanel(id: string): void {
  window.dispatchEvent(new CustomEvent('lp-open-panel', { detail: id }));
}

export function resetLayout(): void {
  window.dispatchEvent(new CustomEvent('lp-reset-layout'));
}

export { flatten, getHost };
