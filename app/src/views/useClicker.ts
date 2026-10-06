import { useEffect, useRef } from 'react';
import { clickerAction, clickerMove, clickerTarget } from '../engine/clicker';
import type { Action } from '../engine/types/Action';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';

/**
 * A presentation clicker controls the slideshow (Settings → "Presentation
 * clicker controls the slideshow"): Page Down / → next, Page Up / ← back,
 * B or . black, anywhere in the control window — not while typing or with a
 * dialog open.
 */
export function useClicker(on: boolean, show: Show | null, screen: ScreenId, act: (a: Action) => void): void {
  const latest = useRef({ show, screen, act });
  latest.current = { show, screen, act };
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.modal')) return;
      const move = clickerMove(e.key);
      const { show, screen, act } = latest.current;
      const target = move && show ? clickerTarget(show, screen) : null;
      if (!move || !target) return;
      e.preventDefault();
      // Before the other keys (B would otherwise blank the whole screen).
      e.stopImmediatePropagation();
      act(clickerAction(move, target));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [on]);
}
