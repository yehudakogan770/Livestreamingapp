import { useEffect } from 'react';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Switching',
    keys: [
      ['1 – 9, 0', 'Line up input 1 – 10 in Next'],
      ['Enter', 'TAKE (with the chosen transition)'],
      ['Shift + Enter', 'CUT straight to Next'],
      ['B', 'Blank the screen you control (Pesukim on air: hide its words)'],
      ['F1 · F2 · F3', 'Control the Live Screen · Back Screen · Monitor'],
    ],
  },
  {
    title: 'Overlays',
    keys: [['Shift + 1 – 4', 'Overlay 1 – 4 on / off']],
  },
  {
    title: 'Slideshow and 12 Pesukim (when on air or in Next)',
    keys: [
      ['Space · → · Page Down', 'Next slide / next word (presenter clickers too)'],
      ['← · Page Up', 'Back'],
      ['P', 'Pesukim: the whole pasuk'],
    ],
  },
  {
    title: 'Safety',
    keys: [['Double-click PANIC', 'Everything black (or your logo); one click brings it back']],
  },
  {
    title: 'Window',
    keys: [
      ['Ctrl + / Ctrl −', 'Bigger / smaller text'],
      ['Ctrl + 0', 'Normal text size'],
      ['Esc', 'Close a window without saving'],
    ],
  },
];

/** Every keyboard shortcut, in one place (Help → Keyboard shortcuts). */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box keys">
        <header className="modal__head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="keys__body">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="field__label">{g.title}</h3>
              <dl>
                {g.keys.map(([k, what]) => (
                  <div key={k} className="keys__row">
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
