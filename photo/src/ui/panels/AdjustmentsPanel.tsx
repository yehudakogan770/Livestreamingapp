// Adjustments: one click adds an adjustment layer above the active layer
// (its settings open in Properties).

import {
  Sun,
  BarChart3,
  Spline,
  PlusSquare,
  Triangle,
  Palette,
  Scale,
  Contrast,
  Filter,
  Blend,
  Table2,
  SquareSlash,
  Layers2,
  SquareHalf,
  Rainbow,
  Crosshair,
} from './adjustIcons';
import { ADJUSTMENT_ORDER, ADJUSTMENT_NAMES, type AdjustmentType } from '../../core/adjust';
import { newAdjustment } from '../../app/ops/layers';
import { current, useApp } from '../../app/state';
import { showPanel } from '../Dock';
import type { ComponentType } from 'react';

const ICONS: Record<AdjustmentType, ComponentType<{ size?: number }>> = {
  brightnessContrast: Sun,
  levels: BarChart3,
  curves: Spline,
  exposure: PlusSquare,
  vibrance: Triangle,
  hueSaturation: Palette,
  colorBalance: Scale,
  blackWhite: Contrast,
  photoFilter: Filter,
  channelMixer: Blend,
  colorLookup: Table2,
  invert: SquareSlash,
  posterize: Layers2,
  threshold: SquareHalf,
  gradientMap: Rainbow,
  selectiveColor: Crosshair,
};

export function AdjustmentsPanel() {
  useApp((s) => s.rev);
  const has = !!current();
  return (
    <div className="lp-panel">
      <div className="lp-section-title" style={{ marginTop: 0 }}>
        Add an adjustment
      </div>
      <div className="lp-brushes" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {ADJUSTMENT_ORDER.map((t) => {
          const I = ICONS[t];
          return (
            <button
              key={t}
              title={ADJUSTMENT_NAMES[t]}
              aria-label={ADJUSTMENT_NAMES[t]}
              disabled={!has}
              onClick={() => {
                if (newAdjustment(t)) showPanel('properties');
              }}
            >
              <I size={18} />
              <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>
                {ADJUSTMENT_NAMES[t].split(/[ /&]/)[0]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
