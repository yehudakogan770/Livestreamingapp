// The keyboard shortcuts, on one sheet (?).

import { X } from 'lucide-react';

const GROUPS: [string, [string, string][]][] = [
  [
    'Tools',
    [
      ['V', 'Select'],
      ['T', 'Text'],
      ['R / Shift+R', 'Rectangle / ellipse'],
      ['G', 'Pen'],
      ['H, or hold Space', 'Move the view'],
      ['M', 'Note on the canvas'],
      ['N', 'New text layer'],
    ],
  ],
  [
    'Edit',
    [
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+C, X, V', 'Copy, cut, paste (layers, or the keyframes selected)'],
      ['Ctrl+D', 'Duplicate'],
      ['Delete', 'Delete (layers, or the keyframes selected)'],
      ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
      ['Ctrl+Shift+C', 'Precompose'],
      ['Arrows (Shift: 10 px)', 'Nudge'],
      ['Ctrl+S / Ctrl+Shift+S', 'Save to the library / export a file'],
      ['Ctrl+O', 'Open a file'],
    ],
  ],
  [
    'Time',
    [
      ['Space', 'Play / pause'],
      ['J, K, L', 'Backwards, stop, forwards (again: faster)'],
      ['Home / End', 'Start / end'],
      ['Page Up / Page Down', 'A frame back / on'],
      ['I / O', 'To the layer’s start / end (or the IN and OUT markers)'],
      ['[ / ]', 'The layer starts / ends at the playhead'],
      ['Alt+P, S, R, T', 'A keyframe of position, scale, rotation, opacity'],
      ['U', 'Show the animated properties'],
      ['Alt+click ◆', 'An expression on the property (wiggle, loop, time, a link)'],
    ],
  ],
  [
    'View',
    [
      ['`', 'The canvas on its own'],
      ['?', 'This sheet'],
    ],
  ],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="tt-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tt-modal-box tt-shortcuts">
        <header>
          <h2>Keyboard shortcuts</h2>
          <button className="tt-ico" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="tt-shortcuts-grid">
          {GROUPS.map(([g, list]) => (
            <section key={g}>
              <h3>{g}</h3>
              <dl>
                {list.map(([k, what]) => (
                  <div key={k}>
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
