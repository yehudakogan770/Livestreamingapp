// What the Export dialog offers.

import type { TitleProject } from '../core/types';
import type { Host } from './host';
import { templateZip } from './exporting';

export type ExportKind = 'lumtitle' | 'template';

export interface Exporter {
  name: string;
  about: string;
  ext: string;
  /** The file, and what does not carry over (shown after). */
  run(p: TitleProject, host: Host): Promise<{ blob: Blob; notes: string[] }>;
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
};
