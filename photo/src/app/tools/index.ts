// Every tool by id.

import type { ToolId } from '../toolDefs';
import type { Tool } from './types';
import { handTool, zoomTool, rotateViewTool } from './viewTools';
import {
  marqueeRectTool,
  marqueeEllipseTool,
  marqueeRowTool,
  marqueeColumnTool,
  lassoTool,
  polyLassoTool,
  magneticLassoTool,
  magicWandTool,
  quickSelectTool,
  objectSelectTool,
} from './selectTools';
import {
  brushTool,
  pencilTool,
  eraserTool,
  bgEraserTool,
  mixerTool,
  colorReplaceTool,
  cloneTool,
  patternStampTool,
  historyBrushTool,
  healTool,
  spotHealTool,
  removeTool,
  blurTool,
  sharpenTool,
  smudgeTool,
  dodgeTool,
  burnTool,
  spongeTool,
  redEyeTool,
  magicEraserTool,
} from './paintTools';
import { moveTool, transformTool, isTransforming } from './transform';
import { eyedropperTool, colorSamplerTool, rulerTool, gradientTool, bucketTool } from './miscTools';
import { cropTool, perspectiveCropTool, sliceTool, artboardTool } from './cropTools';
import {
  penTool,
  freeformPenTool,
  curvaturePenTool,
  addAnchorTool,
  deleteAnchorTool,
  convertPointTool,
  pathSelectTool,
  directSelectTool,
  rectTool,
  ellipseTool,
  triangleTool,
  polygonTool,
  lineTool,
  customShapeTool,
} from './vectorTools';
import { typeTool } from './typeTool';
import { patchTool } from './patchTool';

const TOOLS: Partial<Record<ToolId, Tool>> = {
  move: moveTool,
  artboard: artboardTool,
  marqueeRect: marqueeRectTool,
  marqueeEllipse: marqueeEllipseTool,
  marqueeRow: marqueeRowTool,
  marqueeColumn: marqueeColumnTool,
  lasso: lassoTool,
  polyLasso: polyLassoTool,
  magneticLasso: magneticLassoTool,
  objectSelect: objectSelectTool,
  quickSelect: quickSelectTool,
  magicWand: magicWandTool,
  crop: cropTool,
  perspectiveCrop: perspectiveCropTool,
  slice: sliceTool,
  eyedropper: eyedropperTool,
  colorSampler: colorSamplerTool,
  ruler: rulerTool,
  spotHeal: spotHealTool,
  removeTool: removeTool,
  heal: healTool,
  patch: patchTool,
  redEye: redEyeTool,
  brush: brushTool,
  pencil: pencilTool,
  colorReplace: colorReplaceTool,
  mixer: mixerTool,
  clone: cloneTool,
  patternStamp: patternStampTool,
  historyBrush: historyBrushTool,
  eraser: eraserTool,
  bgEraser: bgEraserTool,
  magicEraser: magicEraserTool,
  gradient: gradientTool,
  bucket: bucketTool,
  blur: blurTool,
  sharpen: sharpenTool,
  smudge: smudgeTool,
  dodge: dodgeTool,
  burn: burnTool,
  sponge: spongeTool,
  pen: penTool,
  freeformPen: freeformPenTool,
  curvaturePen: curvaturePenTool,
  addAnchor: addAnchorTool,
  deleteAnchor: deleteAnchorTool,
  convertPoint: convertPointTool,
  type: typeTool,
  pathSelect: pathSelectTool,
  directSelect: directSelectTool,
  rect: rectTool,
  ellipse: ellipseTool,
  triangle: triangleTool,
  polygon: polygonTool,
  line: lineTool,
  customShape: customShapeTool,
  hand: handTool,
  rotateView: rotateViewTool,
  zoom: zoomTool,
};

/** The tool that handles the pointer now (Free Transform takes over while it runs). */
export function toolFor(id: ToolId): Tool | null {
  if (isTransforming()) return transformTool;
  return TOOLS[id] ?? null;
}
