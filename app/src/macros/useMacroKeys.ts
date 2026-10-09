import { useEffect, useRef } from 'react';
import type { Show } from '../engine/types/Show';
import type { Act } from '../views/act';
import { keyName, macroForKey } from './macros';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/**
 * Keys in the control window: each macro's own key, [ / ] for the previous
 * / next row of the data file (speaker lists, scores), and Shift+[ / ] for
 * the previous / next row of the Titler graphics' own data (those on air,
 * else all of them). Nothing
 * happens while typing in a box or while a dialog is open.
 */
export function useMacroKeys(show: Show, act: Act): void {
  const ref = useRef({ show, act });
  ref.current = { show, act };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || typing(e.target)) return;
      const { show, act } = ref.current;
      const m = macroForKey(show.macros, keyName(e));
      if (m) {
        e.preventDefault();
        act({ type: 'runMacro', id: m.id });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal')) return;
      if (
        (e.key === '}' || e.key === '{' || (e.shiftKey && (e.key === ']' || e.key === '['))) &&
        show.sources.some((s) => s.kind.type === 'titler' && s.kind.data.some((t) => t.rows.length))
      ) {
        e.preventDefault();
        act({ type: 'titlerDataStep', delta: e.key === '}' || e.key === ']' ? 1 : -1 });
        return;
      }
      if ((e.key === ']' || e.key === '[') && !e.shiftKey && show.data.rows.length > 0) {
        e.preventDefault();
        act({ type: 'dataStep', delta: e.key === ']' ? 1 : -1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
