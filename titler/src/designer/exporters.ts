// What the Export dialog offers.

import { toLottie } from '../core/lottieExport';
import { canvasMeasure } from '../core/render';
import type { BrandTokens, TitleProject, Values } from '../core/types';
import type { Host } from './host';
import { selfContained, templateZip } from './exporting';

export type ExportKind = 'lumtitle' | 'template' | 'lottie';

export interface ExportContext {
  values: Values;
  brand: Partial<BrandTokens> | null;
}

export interface Exporter {
  name: string;
  about: string;
  ext: string;
  /** The file, and what does not carry over (shown after). */
  run(p: TitleProject, host: Host, ctx: ExportContext): Promise<{ blob: Blob; notes: string[] }>;
}

export const EXPORTERS: Record<ExportKind, Exporter> = {
  lumtitle: {
    name: 'Lumora title (.lumtitle)',
    about: 'For Lumora, Lumora Studio and the Titler, with its pictures and fonts inside.',
    ext: '.lumtitle',
    run: () => Promise.reject(new Error('handled by the designer')),
  },
  template: {
    name: 'HTML template (.zip)',
    about: 'For CasparCG, SPX, OBS and vMix browser sources, H2R Graphics, LiveOS and any OGraf player. Fields, IN, OUT and formats work there.',
    ext: '-template.zip',
    run: async (p, host) => ({ blob: await templateZip(p, host), notes: [] }),
  },
  lottie: {
    name: 'Lottie (.json)',
    about: 'For websites and apps (lottie-web, LottieFiles), and tools that open Lottie. Fields are written in with their values now.',
    ext: '.json',
    run: async (p, host, ctx) => {
      const full = await selfContained(p, host);
      const c = document.createElement('canvas').getContext('2d');
      const { json, notes } = toLottie(full, { values: ctx.values, brand: ctx.brand ?? undefined, ...(c ? { measure: canvasMeasure(c) } : {}) });
      return { blob: new Blob([JSON.stringify(json)], { type: 'application/json' }), notes };
    },
  },
};
