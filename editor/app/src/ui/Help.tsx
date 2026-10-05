const KEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['J · K · L', 'Back 5 seconds · pause · play (again: faster)'],
  ['← →', 'One frame (with Shift: one second)'],
  ['↑ ↓', 'Previous / next cut'],
  ['1 – 9', 'Switch to that camera from the playhead'],
  ['S', 'Split the clip at the playhead'],
  ['Delete', 'Take out what is selected'],
  ['T', 'Add a title at the playhead'],
  ['I · O · X', 'Mark start · mark end · clear marks'],
  ['+ −', 'Zoom the timeline'],
  ['Ctrl+Z · Ctrl+Y', 'Undo · redo'],
  ['Ctrl+S', 'Save now (it also saves by itself)'],
  ['Ctrl+E', 'Export the film'],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__card help">
        <header className="modal__head">
          <h2>Keyboard</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal__body">
          <dl className="help__keys">
            {KEYS.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="insp__note">
            How it works: the film is the event with parts taken out. Taking a part out takes its picture and sound together, so they always match. Drag the
            edge between two clips to move the cut; hold Alt while dragging to shorten a clip instead.
          </p>
        </div>
      </div>
    </div>
  );
}
