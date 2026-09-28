import type { CSSProperties } from 'react';
import type { TextInput } from '../engine/types/TextInput';
import { isRtl, withAlpha } from '../engine/text';
import './TextView.css';

/**
 * A text input: transparent everywhere except the text (and its box), so it
 * sits over whatever is behind it. Sizes are px of a 1080-high frame, drawn
 * in container units so every screen and preview matches.
 */
export function TextView({ t }: { t: TextInput }) {
  const s = t.style;
  const u = (px: number) => `${(px / 1080) * 100}cqh`;
  const rtl = isRtl(t.text + t.sub);
  const text: CSSProperties = {
    fontFamily: `"${s.font}", "Segoe UI", system-ui, sans-serif`,
    fontWeight: s.weight,
    color: s.color,
    lineHeight: s.lineHeight,
    letterSpacing: u(s.letterSpacing),
    textAlign: s.align,
    textShadow: s.shadow ? `0 ${u(3)} ${u(12)} rgba(0,0,0,0.6)` : undefined,
    WebkitTextStroke: s.outline ? `${u(s.outline)} ${s.outlineColor}` : undefined,
    paintOrder: 'stroke fill',
  };
  const box: CSSProperties = s.boxOn ? { background: withAlpha(s.boxColor, s.boxOpacity), padding: u(s.padding), borderRadius: u(s.radius) } : {};
  const main = <div style={{ fontSize: u(s.size) }}>{t.text}</div>;
  const sub = t.sub ? <div style={{ fontSize: u(s.size * 0.6), fontWeight: Math.max(300, s.weight - 200), opacity: 0.9 }}>{t.sub}</div> : null;

  if (t.layout === 'ticker') {
    // One line moving right to left forever, at `speed` px a second.
    const line = [t.text, t.sub].filter(Boolean).join('   ·   ');
    const seconds = Math.max(4, ((line.length * s.size * 0.55 + 1920) / s.speed) | 0);
    return (
      <div className="txt" data-kind="text">
        <div className="txt__ticker" style={{ ...text, ...box, borderRadius: 0, fontSize: u(s.size), padding: `${u(s.padding)} 0` }}>
          <span className={`txt__run${rtl ? ' txt__run--rtl' : ''}`} style={{ animationDuration: `${seconds}s` }} dir="auto">
            {line}
          </span>
        </div>
      </div>
    );
  }
  const place: Record<Exclude<TextInput['layout'], 'ticker'>, CSSProperties> = {
    lowerThird: { left: '5%', right: '5%', bottom: '10%', alignItems: s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start' },
    title: { inset: '8%', justifyContent: 'center', alignItems: 'center' },
    fullScreen: { inset: '6%', justifyContent: 'center', alignItems: 'center' },
  };
  return (
    <div className="txt" data-kind="text">
      <div className="txt__place" style={place[t.layout]}>
        <div style={{ ...text, ...box }} dir="auto">
          {main}
          {sub}
        </div>
      </div>
    </div>
  );
}
