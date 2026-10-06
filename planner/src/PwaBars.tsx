// The app's own bars and cards: a new version waiting, no internet, and how to
// put the Planner on the phone's home screen.

import { useState } from 'react';
import { CloudOff, Download, RotateCw, X } from 'lucide-react';
import { applyUpdate, install, usePwa } from './pwa';

/** A new version is ready. Nothing reloads on its own (it could be mid-edit). */
export function UpdateBar() {
  const { update } = usePwa();
  const [later, setLater] = useState(false);
  if (!update || later) return null;
  return (
    <div className="appbar appbar--update no-print" role="status">
      <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="grow">A new version is ready.</span>
      <button type="button" className="btn btn--primary appbar__btn" onClick={applyUpdate}>
        Reload
      </button>
      <button type="button" className="btn btn--quiet btn--icon appbar__btn" aria-label="Not now" onClick={() => setLater(true)}>
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

/** No internet: what is on screen is the copy kept on this device (or edits wait for the connection). */
export function OfflineBar({ fromCopy, at }: { fromCopy: boolean; at?: number }) {
  const when = at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <div className="offbar no-print" role="status">
      <CloudOff size={15} strokeWidth={1.75} aria-hidden="true" />
      <span>
        {fromCopy ? (
          <>
            <b>Offline</b> — showing the last saved copy{when ? ` (${when})` : ''}. Read only.
          </>
        ) : (
          <>
            <b>Offline</b> — changes are saved when the connection is back.
          </>
        )}
      </span>
    </div>
  );
}

/** iOS's Share icon: a box with an arrow up out of it. */
export function ShareIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="share-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 9.5H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1.5" />
      <path d="M12 2.5v12" />
      <path d="m8.5 6 3.5-3.5L15.5 6" />
    </svg>
  );
}

/** iOS's Add to Home Screen icon: a rounded square with a plus. */
function AddIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="share-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/** The steps on iPhone and iPad, where Safari has no install button of its own. */
export function IosSteps() {
  return (
    <ol className="install__steps">
      <li>
        Tap <ShareIcon /> <b>Share</b> in the browser’s toolbar.
      </li>
      <li>
        Then tap <AddIcon /> <b>Add to Home Screen</b>.
      </li>
    </ol>
  );
}

/** The plans page, once: put the Planner on the home screen. */
export function InstallCard({ kind, onClose }: { kind: 'ios' | 'prompt'; onClose: () => void }) {
  return (
    <section className="install no-print" aria-label="Install the Planner">
      <div className="install__head">
        <img src="./icon-192.png" alt="" width={36} height={36} className="install__icon" />
        <div className="grow">
          <b>Put the Planner on your home screen</b>
          <p className="muted">It opens like an app, full screen, and shows your plans even with no internet.</p>
        </div>
        <button type="button" className="btn btn--quiet btn--icon" aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {kind === 'ios' ? (
        <IosSteps />
      ) : (
        <div className="install__acts">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void install();
              onClose();
            }}
          >
            <Download size={15} strokeWidth={2} aria-hidden="true" />
            Install app
          </button>
        </div>
      )}
    </section>
  );
}
