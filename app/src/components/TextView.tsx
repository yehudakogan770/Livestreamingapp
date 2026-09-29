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
  const d = s.design ?? 'box';
  const accent = s.accent ?? '#2f80ed';
  const end = s.align === 'right';
  const anim = s.animate ?? false;
  const fill = s.boxOn ? withAlpha(s.boxColor, s.boxOpacity) : 'transparent';
  const pad = s.boxOn ? u(s.padding) : 0;
  const cls = `txd txd--${d}${anim ? ' txd--anim' : ''}${end ? ' txd--end' : ''}`;
  const vars = { '--txd-accent': accent, alignItems: place[t.layout].alignItems } as CSSProperties;
  const words = (
    <>
      <div className="txd__text">{main}</div>
      {d === 'underline' && <i className="txd__line" style={{ height: u(6), margin: `${u(10)} 0` }} />}
      {sub && <div className="txd__sub">{sub}</div>}
    </>
  );
  let body;
  if (d === 'split') {
    body = (
      <div className={cls} style={{ ...text, ...vars }} dir="auto">
        <div className="txd__box" style={{ background: accent, padding: u(s.padding), borderRadius: u(s.radius) }}>
          <div className="txd__text">{main}</div>
        </div>
        {sub && (
          <div className="txd__box txd__box--sub" style={{ background: withAlpha(s.boxColor, s.boxOpacity), padding: `${u(s.padding * 0.45)} ${u(s.padding * 0.8)}`, borderRadius: u(s.radius) }}>
            <div className="txd__sub">{sub}</div>
          </div>
        )}
      </div>
    );
  } else if (d === 'underline') {
    body = (
      <div className={cls} style={{ ...text, ...vars }} dir="auto">
        {words}
      </div>
    );
  } else {
    const bg =
      d === 'gradient'
        ? `linear-gradient(${end ? 270 : 90}deg, ${accent} 0%, ${withAlpha(s.boxColor, s.boxOpacity)} 75%)`
        : d === 'glass'
          ? 'rgba(255,255,255,0.14)'
          : fill;
    const bar = d === 'bar' ? u(10) : 0;
    body = (
      <div className={cls} style={{ ...text, ...vars }} dir="auto">
        <div
          className="txd__box"
          style={{
            background: d === 'glass' || d === 'gradient' || s.boxOn ? bg : 'transparent',
            padding: d === 'glass' || d === 'gradient' ? u(s.padding) : pad,
            paddingLeft: !end && bar ? `calc(${pad || '0px'} + ${bar})` : undefined,
            paddingRight: end && bar ? `calc(${pad || '0px'} + ${bar})` : undefined,
            borderRadius: u(s.radius),
            border: d === 'glass' ? `${u(1.5)} solid rgba(255,255,255,0.35)` : undefined,
            backdropFilter: d === 'glass' ? `blur(${u(18)})` : undefined,
          }}
        >
          {d === 'bar' && <i className="txd__bar" style={{ width: bar }} />}
          {words}
        </div>
      </div>
    );
  }
  return (
    <div className="txt" data-kind="text">
      <div className="txt__place" style={place[t.layout]}>
        {body}
      </div>
    </div>
  );
}
