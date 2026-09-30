import type { Prompter } from '../engine/types/Prompter';
import { useNow } from '../engine/useNow';

/** Where the script is at `now`, in % of the monitor's height. */
export const prompterAt = (p: Prompter, now: number) => p.pos + (p.since === null ? 0 : (Math.max(0, now - p.since) / 1000) * p.speed);

/** About how far the whole script scrolls (for the position slider). */
export const prompterLength = (p: Prompter) => {
  const lines = p.script.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((l.length * p.size * 0.5) / 150)), 0);
  return Math.max(10, lines * p.size * 1.35);
};

/** The teleprompter: the script moving up past the reading line (the arrow). */
export function PrompterView({ p }: { p: Prompter }) {
  const now = useNow(p.since !== null, 500);
  const at = prompterAt(p, now);
  return (
    <div
      className="prompter"
      data-prompter
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: '#000',
        color: '#fff',
        containerType: 'size',
        transform: p.mirror ? 'scaleX(-1)' : undefined,
      }}
    >
      <div
        dir="auto"
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          top: `${35 - at}cqh`,
          fontSize: `${p.size}cqh`,
          lineHeight: 1.35,
          fontWeight: 600,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}
      >
        {p.script || 'Type the script in the Monitor tab.'}
        <div style={{ height: '70cqh' }} />
      </div>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${35 + p.size * 0.1}cqh`,
          height: `${p.size * 1.15}cqh`,
          background: 'rgba(242, 178, 51, 0.12)',
          borderTop: '0.3cqh solid rgba(242, 178, 51, 0.5)',
          borderBottom: '0.3cqh solid rgba(242, 178, 51, 0.5)',
          pointerEvents: 'none',
        }}
      />
      <div aria-hidden style={{ position: 'absolute', left: '2%', top: `${35 + p.size * 0.2}cqh`, fontSize: `${p.size * 0.8}cqh`, color: '#f2b233' }}>
        ▶
      </div>
    </div>
  );
}
