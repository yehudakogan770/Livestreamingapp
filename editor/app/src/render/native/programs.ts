// Every GPU program the compositor uses, by the name it uses for it. The
// native engine is given these same GLSL sources and translates them for its
// own GPU API, so a frame drawn natively runs exactly the math the WebGL path
// runs (no second copy of the shaders to keep in step).
import { CUTOUT_FS, LIMIT_FS } from '../maskfx';
import { ACCUM_FS, FLOW_WARP_FS, FRAME_MIX_FS } from '../motionfx';
import {
  COMPOSITE_FS,
  COPY_FS,
  EFFECT_FS,
  FINAL_FS,
  FULL_VS,
  GENERATOR_FS,
  GRADE_ADD_FS,
  GRADE_FS,
  LAYER_FS,
  LAYER_VS,
  OUT_FS,
  TRANSITION_FS,
} from '../shaders';

export interface NativeProgram {
  name: string;
  /** 'full': a full-frame quad (aPos: vec2); 'layer': the placed picture's four corners (aPos: vec4, aUv: vec2). */
  vertex: 'full' | 'layer';
  vs: string;
  fs: string;
}

export function nativePrograms(): NativeProgram[] {
  const full = (name: string, fs: string): NativeProgram => ({ name, vertex: 'full', vs: FULL_VS, fs });
  return [
    { name: 'layer', vertex: 'layer', vs: LAYER_VS, fs: LAYER_FS },
    full('copy', COPY_FS),
    full('final', FINAL_FS),
    full('out', OUT_FS),
    full('composite', COMPOSITE_FS),
    full('transition', TRANSITION_FS),
    full('generator', GENERATOR_FS),
    full('grade', GRADE_FS),
    full('gradeadd', GRADE_ADD_FS),
    full('accum', ACCUM_FS),
    full('framemix', FRAME_MIX_FS),
    full('flowwarp', FLOW_WARP_FS),
    full('cutout', CUTOUT_FS),
    full('limit', LIMIT_FS),
    ...Object.entries(EFFECT_FS).map(([name, fs]) => full(name, fs)),
  ];
}
