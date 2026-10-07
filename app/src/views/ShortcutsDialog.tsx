import { Keyboard, X } from 'lucide-react';
import { useEffect } from 'react';

/** With the Jewish event tools on (Settings). */
const PESUKIM = {
  title: '12 Pesukim (when on air or in Next)',
  keys: [
    ['Space · → · Page Down', 'Next word (presenter clickers too)'],
    ['← · Page Up', 'Back a word'],
    ['P', 'The whole pasuk'],
    ['B', 'Hide the words (the camera stays)'],
  ] as [string, string][],
};

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Switching',
    keys: [
      ['1 – 9, 0', 'Line up input 1 – 10 in Next'],
      ['Enter', 'TAKE (with the chosen transition)'],
      ['Shift + Enter', 'CUT straight to Next'],
      ['Ctrl + 1 – 4', 'TAKE with favorite transition 1 – 4'],
      ['B', 'Blank the screen you control'],
      ['F1 · F2 · F3', 'Control the Live Screen · Back Screen · Monitor'],
    ],
  },
  {
    title: 'Overlays',
    keys: [['Shift + 1 – 4', 'Overlay 1 – 4 on / off']],
  },
  {
    title: 'Cues, data and macros',
    keys: [
      ['N', 'Next cue in the run of show'],
      ['[  ·  ]', 'Previous / next row of the data file or sheet'],
      ['The macro’s key', 'Run that macro (set in Cues → Macros)'],
    ],
  },
  {
    title: 'Slideshow (when on air or in Next)',
    keys: [
      ['Space · → · Page Down', 'Next slide (presenter clickers too)'],
      ['← · Page Up', 'Back'],
    ],
  },
  {
    title: 'Stage visuals (while its page is open)',
    keys: [
      ['1 – 9, 0', 'Start scene 1 – 10 of the music type shown'],
      ['Shift + 1 – 9, 0 · ↑ ↓', 'Choose the music type'],
      ['Space · →  /  ←', 'Next / previous scene'],
      ['T · S · + −', 'Tap tempo · Sync to 1 · Faster / slower'],
      ['Z (hold) · X · B', 'Strobe · Flash · Blackout'],
      ['Q · I · L', 'Freeze · Invert · Text on / off'],
      ['R · E · C', 'Randomize · Reset effects · Next colors'],
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
export function ShortcutsDialog({ onClose, jewish = false }: { onClose: () => void; jewish?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box keys">
        <header className="modal__head">
          <h2>
            <Keyboard className="modal__icon" aria-hidden="true" />
            Keyboard shortcuts
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="keys__body">
          {(jewish ? [...GROUPS.slice(0, 3), PESUKIM, ...GROUPS.slice(3)] : GROUPS).map((g) => (
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
