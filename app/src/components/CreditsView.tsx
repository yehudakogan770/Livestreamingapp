import type { Credits } from '../engine/types/Credits';
import { creditsMetrics, creditsPage, rollOffset, splitName, wallLayout } from '../engine/credits';
import { useNow } from '../engine/useNow';
import './CreditsView.css';

const u = (px: number) => `${(px / 1080) * 100}cqh`;

/** Credits as the audience sees them: rolling, a page at a time, or a wall of names. */
export function CreditsView({ c }: { c: Credits }) {
  // Rolling needs every frame; pages only when the page turns.
  const now = useNow(c.playing && c.mode === 'roll', 250);
  const { lineH, titleH, gap } = creditsMetrics(c);
  const font = `"${c.font}", "Segoe UI", system-ui, sans-serif`;
  const title = c.title && (
    <div className="cr__title" style={{ fontSize: u(c.size * 1.8), height: u(titleH), marginBottom: u(gap) }}>
      {c.title}
    </div>
  );
  const line = (text: string, i: number, size = c.size, h = lineH) => {
    const { name, role } = splitName(text);
    return (
      <div key={i} className="cr__name" style={{ fontSize: u(size), height: u(h) }} dir="auto">
        {name}
        {role && <span className="cr__role"> {role}</span>}
      </div>
    );
  };

  let body;
  if (c.mode === 'roll') {
    const y = 1080 - rollOffset(c, now);
    body = (
      <div className="cr__roll" style={{ transform: `translateY(${u(y)})` }}>
        {title}
        {c.names.map((n, i) => line(n, i))}
      </div>
    );
  } else if (c.mode === 'pages') {
    const { perPage, page } = creditsPage(c, now);
    body = (
      <div key={page} className="cr__page">
        {title}
        {c.names.slice(page * perPage, (page + 1) * perPage).map((n, i) => line(n, i))}
      </div>
    );
  } else {
    const { cols, size } = wallLayout(c);
    body = (
      <div className="cr__page">
        {title}
        <div className="cr__wall" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {c.names.map((n, i) => line(n, i, size, size * 1.4))}
        </div>
      </div>
    );
  }
  return (
    <div className="cr" style={{ background: c.background, color: c.color, fontFamily: font }} data-kind="credits">
      {body}
    </div>
  );
}
