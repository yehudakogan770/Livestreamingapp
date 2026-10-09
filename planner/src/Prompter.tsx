import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Expand, FlipHorizontal2, Minus, Pause, Play, Plus } from 'lucide-react';
import { cueLabel, sortCues, type PlanCue } from './model';
import type { Live } from './live';
import './prompter.css';

const KEY = 'lumora.planner.prompter';

interface Settings {
  /** Lines a second, roughly: pixels a second at size 1 / 40. */
  speed: number;
  /** Text size (px). */
  size: number;
  mirror: boolean;
  /** Jump to the cue on now when the show moves on. */
  follow: boolean;
}

const DEFAULTS: Settings = { speed: 3, size: 56, mirror: false, follow: true };

function load(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      speed: typeof s.speed === 'number' ? Math.min(20, Math.max(0.5, s.speed)) : DEFAULTS.speed,
      size: typeof s.size === 'number' ? Math.min(140, Math.max(24, s.size)) : DEFAULTS.size,
      mirror: s.mirror === true,
      follow: s.follow !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

/** The cues with a script (or all of them, with their titles), in order. */
export function prompterCues(cues: readonly PlanCue[]): PlanCue[] {
  return sortCues(cues).filter((c) => !c.skip && c.script.trim());
}

/**
 * The prompter: every cue's script in order, scrolling. Space starts and
 * stops; ↑/↓ change the speed; it follows the show (jumps to the cue on now)
 * unless that is turned off. Mirrored for a glass prompter.
 */
export function Prompter({ cues, live, onClose, title }: { cues: PlanCue[]; live: Live | null; onClose?: () => void; title: string }) {
  const [set, setSet] = useState<Settings>(load);
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pos = useRef(0);
  const list = useMemo(() => prompterCues(cues), [cues]);
  const all = useMemo(() => sortCues(cues), [cues]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(set));
    } catch {
      // Not remembered: fine.
    }
  }, [set]);

  // Scrolling.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const el = box.current;
      if (el) {
        pos.current = Math.min(el.scrollHeight, (pos.current || el.scrollTop) + ((t - last) / 1000) * set.speed * (set.size / 2.2));
        el.scrollTop = pos.current;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) setPlaying(false);
      }
      last = t;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, set.speed, set.size]);

  // Follow the show: the cue on now (or the next one with a script) to the reading line.
  const liveCue = live && (live.state === 'running' || live.state === 'paused') ? live.cueId : null;
  useEffect(() => {
    if (!set.follow || !liveCue) return;
    const i = all.findIndex((c) => c.id === liveCue);
    const target = all.slice(Math.max(0, i)).find((c) => list.some((l) => l.id === c.id));
    const el = target ? document.getElementById(`prompt-${target.id}`) : null;
    if (el && box.current) {
      const top = el.offsetTop - box.current.clientHeight * 0.3;
      box.current.scrollTo({ top, behavior: 'smooth' });
      pos.current = top;
    }
  }, [liveCue, set.follow, all, list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        pos.current = box.current?.scrollTop ?? 0;
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSet((s) => ({ ...s, speed: Math.min(20, +(s.speed + 0.5).toFixed(1)) }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSet((s) => ({ ...s, speed: Math.max(0.5, +(s.speed - 0.5).toFixed(1)) }));
      } else if (e.key === 'Escape' && onClose && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const full = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="prompter">
      <div className="prompter__bar">
        {onClose && (
          <button type="button" className="prompter__btn" onClick={onClose}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            Back
          </button>
        )}
        <b className="prompter__name">{title}</b>
        <span className="bar__spacer" />
        <button
          type="button"
          className="prompter__btn prompter__btn--main"
          onClick={() => {
            pos.current = box.current?.scrollTop ?? 0;
            setPlaying(!playing);
          }}
          aria-label={playing ? 'Stop' : 'Scroll'}
        >
          {playing ? <Pause size={16} strokeWidth={1.75} aria-hidden="true" /> : <Play size={16} strokeWidth={1.75} aria-hidden="true" />}
          {playing ? 'Stop' : 'Scroll'}
        </button>
        <span className="prompter__group" role="group" aria-label="Speed">
          <button type="button" className="prompter__btn" onClick={() => setSet((s) => ({ ...s, speed: Math.max(0.5, +(s.speed - 0.5).toFixed(1)) }))} aria-label="Slower">
            <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span className="prompter__val mono">Speed {set.speed}</span>
          <button type="button" className="prompter__btn" onClick={() => setSet((s) => ({ ...s, speed: Math.min(20, +(s.speed + 0.5).toFixed(1)) }))} aria-label="Faster">
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
        <span className="prompter__group" role="group" aria-label="Text size">
          <button type="button" className="prompter__btn" onClick={() => setSet((s) => ({ ...s, size: Math.max(24, s.size - 8) }))} aria-label="Smaller text">
            A−
          </button>
          <button type="button" className="prompter__btn" onClick={() => setSet((s) => ({ ...s, size: Math.min(140, s.size + 8) }))} aria-label="Larger text">
            A+
          </button>
        </span>
        <button type="button" className={`prompter__btn${set.mirror ? ' is-on' : ''}`} aria-pressed={set.mirror} onClick={() => setSet((s) => ({ ...s, mirror: !s.mirror }))}>
          <FlipHorizontal2 size={16} strokeWidth={1.75} aria-hidden="true" />
          Mirror
        </button>
        <label className="prompter__check">
          <input type="checkbox" checked={set.follow} onChange={(e) => setSet((s) => ({ ...s, follow: e.target.checked }))} />
          Follow the show
        </label>
        <button type="button" className="prompter__btn" onClick={full} aria-label="Full screen">
          <Expand size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div
        className="prompter__text"
        ref={box}
        style={{ fontSize: set.size, transform: set.mirror ? 'scaleX(-1)' : undefined }}
        onScroll={(e) => {
          if (!playing) pos.current = (e.target as HTMLDivElement).scrollTop;
        }}
        onClick={() => setPlaying(false)}
      >
        <div className="prompter__pad" />
        {list.length === 0 && <p className="prompter__empty">No scripts yet. Add each cue’s script in its details (Script), and it shows here in order.</p>}
        {list.map((c) => (
          <section key={c.id} id={`prompt-${c.id}`} className={`prompter__cue${c.id === liveCue ? ' is-now' : ''}`}>
            <h2>
              {all.indexOf(c) + 1}. {cueLabel(c)}
            </h2>
            {c.script.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
        <div className="prompter__pad prompter__pad--end">End</div>
      </div>
      <div className="prompter__line" aria-hidden="true" />
    </div>
  );
}
