// The menu bar's menus, by command id ('-' is a separator).

import { ADJUSTMENT_ORDER } from '../core/adjust';
import { FILTERS, FILTER_MENUS } from '../core/filters/registry';

export type MenuEntry = string | { label: string; items: MenuEntry[] } | { dynamic: 'recent' | 'panels' | 'documents' };

export interface Menu {
  label: string;
  items: MenuEntry[];
}

const adjustments = (prefix: string): MenuEntry[] => {
  const ids = ADJUSTMENT_ORDER.map((t) => `${prefix}${t}`);
  // Photoshop's grouping: tone, color, then the special ones.
  return [...ids.slice(0, 4), '-', ...ids.slice(4, 11), '-', ...ids.slice(11)];
};

function filterMenus(): MenuEntry[] {
  return FILTER_MENUS.map((m) => ({ label: m, items: FILTERS.filter((f) => !f.hidden && f.menu === m).map((f) => `filter.${f.id}`) })).filter((m) => m.items.length);
}

export const MENUS: Menu[] = [
  {
    label: 'File',
    items: [
      'file.new',
      'file.open',
      { dynamic: 'recent' },
      '-',
      'file.close',
      'file.closeAll',
      'file.save',
      'file.saveAs',
      { label: 'Save a Copy', items: ['file.saveAsPsd', 'file.saveAsTiff'] },
      'file.revert',
      '-',
      { label: 'Export', items: ['file.quickExport', 'file.exportAs', '-', 'file.exportArtboards', 'file.exportSlices'] },
      { label: 'Send To', items: ['file.sendLumora', 'file.sendStudio', 'file.sendTitler'] },
      '-',
      'file.place',
      '-',
      { label: 'Automate', items: ['file.batch'] },
      'file.info',
      '-',
      'file.print',
    ],
  },
  {
    label: 'Edit',
    items: [
      'edit.undo',
      'edit.redo',
      '-',
      'edit.cut',
      'edit.copy',
      'edit.copyMerged',
      'edit.paste',
      { label: 'Paste Special', items: ['edit.pasteInPlace', 'edit.pasteInto'] },
      'edit.clear',
      '-',
      'edit.fill',
      'edit.stroke',
      'edit.contentAwareFill',
      '-',
      'edit.contentAwareScale',
      'edit.freeTransform',
      { label: 'Transform', items: ['edit.again', '-', 'edit.warp', '-', 'edit.rot180', 'edit.rot90cw', 'edit.rot90ccw', '-', 'edit.flipH', 'edit.flipV'] },
      '-',
      'edit.defineBrush',
      'edit.definePattern',
      '-',
      'edit.shortcuts',
      'edit.prefs',
    ],
  },
  {
    label: 'Image',
    items: [
      { label: 'Mode', items: ['image.depth8', 'image.depth16', 'image.depth32'] },
      '-',
      {
        label: 'Adjustments',
        items: [...adjustments('image.adj.'), '-', 'image.shadowsHighlights', 'image.hdrToning', '-', 'image.desaturate', 'image.matchColor', 'image.replaceColor', 'image.equalize'],
      },
      '-',
      'image.autoTone',
      'image.autoContrast',
      'image.autoColor',
      '-',
      'image.imageSize',
      'image.canvasSize',
      { label: 'Image Rotation', items: ['image.rot180', 'image.rot90cw', 'image.rot90ccw', 'image.rotArbitrary', '-', 'image.flipH', 'image.flipV'] },
      'image.crop',
      'image.trim',
      'image.revealAll',
      'image.straighten',
      '-',
      'image.duplicate',
      '-',
      'image.assignProfile',
      'image.convertProfile',
    ],
  },
  {
    label: 'Layer',
    items: [
      { label: 'New', items: ['layer.new', 'layer.newGroup', 'layer.group', '-', 'layer.fromBackground', '-', 'layer.viaCopy', 'layer.viaCut'] },
      'layer.duplicate',
      'layer.delete',
      '-',
      { label: 'Layer Style', items: ['layer.style', '-', 'layer.clearStyle', 'layer.rasterizeStyle'] },
      { label: 'New Fill Layer', items: ['layer.fillSolid', 'layer.fillGradient', 'layer.fillPattern'] },
      { label: 'New Adjustment Layer', items: adjustments('layer.adj.') },
      '-',
      { label: 'Layer Mask', items: ['layer.maskReveal', 'layer.maskHide', 'layer.maskSelection', 'layer.maskHideSelection', '-', 'layer.maskDelete', 'layer.maskApply', '-', 'layer.maskToggle'] },
      'layer.clip',
      '-',
      { label: 'Smart Objects', items: ['layer.toSmart'] },
      { label: 'Rasterize', items: ['layer.rasterize', 'layer.rasterizeStyle'] },
      '-',
      'layer.group',
      'layer.ungroup',
      '-',
      { label: 'Arrange', items: ['layer.front', 'layer.forward', 'layer.backward', 'layer.back'] },
      { label: 'Align', items: ['layer.alignTop', 'layer.alignVCenter', 'layer.alignBottom', '-', 'layer.alignLeft', 'layer.alignHCenter', 'layer.alignRight'] },
      '-',
      'layer.mergeDown',
      'layer.mergeVisible',
      'layer.stamp',
      'layer.flatten',
    ],
  },
  {
    label: 'Select',
    items: [
      'select.all',
      'select.deselect',
      'select.reselect',
      'select.inverse',
      '-',
      'select.colorRange',
      'select.subject',
      '-',
      'select.mask',
      { label: 'Modify', items: ['select.border', 'select.smooth', 'select.expand', 'select.contract', 'select.feather'] },
      'select.grow',
      'select.similar',
      '-',
      'select.transform',
      '-',
      'select.quickMask',
      '-',
      'select.load',
      'select.save',
    ],
  },
  {
    label: 'Filter',
    items: ['filter.last', '-', 'filter.smart', '-', 'filter.cameraRaw', 'filter.liquify', '-', ...filterMenus()],
  },
  {
    label: 'View',
    items: [
      'view.zoomIn',
      'view.zoomOut',
      'view.fit',
      'view.actual',
      'view.200',
      'view.printSize',
      '-',
      'view.flip',
      'view.resetRotation',
      '-',
      'view.screenMode',
      '-',
      'view.extras',
      { label: 'Show', items: ['view.grid', 'view.guides', 'view.pixelGrid'] },
      'view.rulers',
      'view.snap',
      '-',
      'view.newGuide',
      'view.clearGuides',
      '-',
      'view.theme',
    ],
  },
  { label: 'Window', items: [{ dynamic: 'panels' }, '-', 'window.reset', '-', { dynamic: 'documents' }] },
  { label: 'Help', items: ['help.shortcuts', '-', 'help.about'] },
];
