// Placing a file as a smart object (File ▸ Place Embedded, drag and drop
// onto an open document): its pixels kept whole, fitted inside the canvas,
// free to scale and filter without loss.

import { current, bump } from './state';
import { baseLayer, insertLayers } from '../core/layers';
import { Raster } from '../core/raster';
import { renderSmartRaster } from './layerContent';
import { flattenRaster, canvasRect } from './ops/common';
import type { SmartLayer } from '../core/types';

export async function placeBytes(name: string, bytes: Uint8Array): Promise<void> {
  const s = current();
  if (!s) return;
  const { docFromBytes } = await import('./files');
  const d = await docFromBytes(name, bytes);
  const svgLayer = d.layers.length === 1 && d.layers[0]!.kind === 'smart' ? (d.layers[0] as SmartLayer) : null;
  let raster: Raster;
  if (svgLayer) raster = svgLayer.source.raster;
  else raster = flattenRaster(d, canvasRect(d));
  if (raster.depth !== s.doc.depth) raster = raster.convert(s.doc.depth);
  const W = svgLayer ? svgLayer.source.width : d.width,
    H = svgLayer ? svgLayer.source.height : d.height;
  // Fit inside the canvas (never enlarge), centered.
  const base = svgLayer ? svgLayer.transform[0]! : 1;
  const k = base * Math.min(1, s.doc.width / (W * base), s.doc.height / (H * base));
  const tx = (s.doc.width - W * k) / 2,
    ty = (s.doc.height - H * k) / 2;
  const layer: SmartLayer = {
    ...baseLayer(name.replace(/\.[^.]+$/, '')),
    kind: 'smart',
    source: { kind: svgLayer ? 'svg' : 'raster', width: W, height: H, raster, svg: svgLayer?.source.svg, name },
    transform: [k, 0, tx, 0, k, ty, 0, 0, 1],
    filters: [],
    filtersVisible: true,
    raster: new Raster(s.doc.depth, 4),
  };
  layer.raster = renderSmartRaster(layer, s.doc);
  s.commit('Place', 'smart', { ...s.doc, layers: insertLayers(s.doc.layers, [layer], s.active, 'above') });
  s.active = layer.id;
  s.selected = [layer.id];
  bump();
}
