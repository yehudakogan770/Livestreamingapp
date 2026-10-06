import { X } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BrandMark, type MarkOf } from './Logo';
import './About.css';

let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  open = v;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Open Help → About. */
export const openAbout = (): void => setOpen(true);

const NAME: Record<MarkOf, string> = { lumora: 'Lumora', studio: 'Lumora Studio' };
const LINE: Record<MarkOf, string> = {
  lumora: 'Live event control for three screens',
  studio: 'Edit the whole event, every camera',
};

/** Put once in the main window: the About box, when it is asked for. */
export function AboutHost({ app }: { app: MarkOf }) {
  const isOpen = useSyncExternalStore(subscribe, () => open);
  return isOpen ? <AboutDialog app={app} onClose={() => setOpen(false)} /> : null;
}

export function AboutDialog({ app, onClose }: { app: MarkOf; onClose: () => void }) {
  const [version, setVersion] = useState('');
  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window) void getVersion().then(setVersion, () => {});
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const name = NAME[app];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`About ${name}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box about">
        <header className="modal__head">
          <h2>About {name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="about__body">
          <BrandMark size={72} of={app} />
          <p className="about__name">{name}</p>
          <p className="about__line">{LINE[app]}</p>
          {version && <p className="about__version">Version {version}</p>}
          <p className="about__site">yehudakogan770.github.io/Livestreamingapp</p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}
