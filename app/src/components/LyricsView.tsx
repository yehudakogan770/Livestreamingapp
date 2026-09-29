import type { CSSProperties } from 'react';
import type { Lyrics } from '../engine/types/Lyrics';
import { sections } from '../engine/lyrics';
import { isRtl, withAlpha } from '../engine/text';
import './LyricsView.css';

const u = (px: number) => `${(px / 1080) * 100}cqh`;

/** A song's current slide: see-through except the words (and their box). Mirrored in compositor.ts lyrics(). */
export function LyricsView({ l }: { l: Lyrics }) {
  const words = l.blank ? '' : (sections(l.text)[l.current] ?? '');
  const s = l.style;
  const style: CSSProperties = {
    fontFamily: `"${s.font}", "Segoe UI", system-ui, sans-serif`,
    fontWeight: s.weight,
    fontSize: u(s.size),
    color: s.color,
    lineHeight: s.lineHeight,
    textAlign: s.align,
    textShadow: s.shadow ? `0 ${u(3)} ${u(14)} rgba(0,0,0,0.75)` : undefined,
    WebkitTextStroke: s.outline ? `${u(s.outline)} ${s.outlineColor}` : undefined,
    paintOrder: 'stroke fill',
    background: s.boxOn ? withAlpha(s.boxColor, s.boxOpacity) : undefined,
    padding: s.boxOn ? u(s.padding) : undefined,
    borderRadius: s.boxOn ? u(s.radius) : undefined,
  };
  return (
    <div className={`lyr lyr--${l.place}`} data-kind="lyrics">
      {words && (
        <div key={`${l.current}:${l.changedAt}`} className="lyr__words" style={style} dir={isRtl(words) ? 'rtl' : 'ltr'}>
          {words}
        </div>
      )}
    </div>
  );
}
