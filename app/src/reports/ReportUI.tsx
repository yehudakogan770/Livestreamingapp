// The person's side of problem reports: the one-time question about error
// reports, the switch for them, and the "Report a problem" window (Help menu).

import { Bug, Camera, Check, ImagePlus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent } from 'react';
import { authOn } from '../auth/config';
import { onSignInChange, supabase } from '../auth/auth';
import { TEST_BUILD } from '../e2e';
import { onConsentChange, readConsent, setConsent, shouldAsk, type Consent } from './consent';
import { appLog } from './logs';
import { collectCrashReports, sendProblemReport } from './reporter';
import './reports.css';

// ---- "Report a problem" opens from any menu ----
let dialogOpen = false;
/** Words to start the report with (the system check's details), used once. */
let prefill = '';
const openListeners = new Set<() => void>();
function setDialog(v: boolean) {
  dialogOpen = v;
  for (const l of openListeners) l();
}
/** Open the "Report a problem" window (optionally with words already in it; menus pass a click, which is ignored). */
export const openProblemReport = (text?: unknown): void => {
  prefill = typeof text === 'string' ? text : '';
  setDialog(true);
};
const subscribeOpen = (l: () => void) => {
  openListeners.add(l);
  return () => openListeners.delete(l);
};

/** Whether error reports are on, and a switch for the menus. */
export function useErrorReports(): [boolean, () => void] {
  const [c, setC] = useState<Consent>(readConsent);
  useEffect(() => onConsentChange(setC), []);
  return [c === 'yes', () => setConsent(c === 'yes' ? 'no' : 'yes')];
}

function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!authOn() || TEST_BUILD) return;
    let live = true;
    const check = () =>
      void supabase()
        .auth.getSession()
        .then(({ data }) => live && setSignedIn(!!data.session))
        .catch(() => {});
    check();
    const stop = onSignInChange(check);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return signedIn;
}

/**
 * Put once in the main window: asks the error-report question the first
 * time, sends crash reports kept since last time, and shows "Report a problem".
 */
export function ReportingHost({ product }: { product: string }) {
  const open = useSyncExternalStore(subscribeOpen, () => dialogOpen);
  const [consent, setC] = useState<Consent>(readConsent);
  useEffect(() => onConsentChange(setC), []);
  const signedIn = useSignedIn();
  // Crashes of the program since last time (once signed in, and again if they say yes).
  useEffect(() => {
    if (signedIn && consent === 'yes') void collectCrashReports();
  }, [signedIn, consent]);
  return (
    <>
      {shouldAsk(consent, signedIn, TEST_BUILD) && <ConsentCard product={product} />}
      {open && <ReportDialog product={product} onClose={() => setDialog(false)} />}
    </>
  );
}

function ConsentCard({ product }: { product: string }) {
  return (
    <div className="rp-ask" role="dialog" aria-label="Error reports">
      <Bug className="rp-ask__icon" aria-hidden="true" />
      <div className="rp-ask__body">
        <b>Send anonymous error reports to help fix problems?</b>
        <p>
          If something goes wrong in {product}, it can send the error and its last log lines to the Lumora team. Never your show, project, file names or
          folders, stream keys or passwords. You can change this any time ({product === 'Lumora' ? 'Settings' : 'Help'} menu).
        </p>
        <div className="rp-ask__row">
          <button type="button" className="btn btn--primary" onClick={() => setConsent('yes')}>
            Send reports
          </button>
          <button type="button" className="btn" onClick={() => setConsent('no')}>
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}

/** The biggest picture kept: 1280 pixels wide, JPEG. */
const SHOT_WIDTH = 1280;

async function shrink(src: CanvasImageSource, w: number, h: number): Promise<string> {
  const scale = Math.min(1, SHOT_WIDTH / Math.max(1, w));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

async function imageFile(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    return await shrink(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

/** A picture of a window the person picks (Windows asks which). */
async function grabWindow(): Promise<string> {
  const media = navigator.mediaDevices as MediaDevices | undefined;
  if (!media?.getDisplayMedia) throw new Error('Pictures of the window are not available here. Press Windows+Shift+S, then paste the picture here (Ctrl+V).');
  const stream = await media.getDisplayMedia({ video: true, audio: false });
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.srcObject = stream;
    await v.play();
    await new Promise((r) => setTimeout(r, 300));
    return await shrink(v, v.videoWidth, v.videoHeight);
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

export function ReportDialog({ product, onClose }: { product: string; onClose: () => void }) {
  const [text, setText] = useState(() => {
    const t = prefill;
    prefill = '';
    return t;
  });
  const [shot, setShot] = useState<string | null>(null);
  const [logs, setLogs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const fail = useCallback((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const paste = (e: ClipboardEvent) => {
    const img = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (!img) return;
    e.preventDefault();
    void imageFile(img).then(setShot, fail);
  };
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await sendProblemReport({ description: text, screenshot: shot, logs });
      setSent(true);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Report a problem" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box rp" onPaste={paste}>
        <header className="modal__head">
          <h2>
            <Bug className="modal__icon" aria-hidden="true" />
            Report a problem
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        {sent ? (
          <div className="rp__body">
            <p className="rp__sent" role="status">
              <Check aria-hidden="true" /> Sent. Thank you — the Lumora team reads every report.
            </p>
            <footer className="modal__foot">
              <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>
                Close
              </button>
            </footer>
          </div>
        ) : (
          <div className="rp__body">
            <label className="field">
              <span className="field__label">What happened? What did you expect?</span>
              <textarea
                className="text rp__text"
                rows={6}
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                placeholder={`For example: when I pressed TAKE, the Live Screen went black for a second.`}
                autoFocus
              />
            </label>
            <div className="rp__shot">
              {shot ? (
                <figure>
                  <img src={shot} alt="The picture that will be sent" />
                  <button type="button" className="btn btn--sm" onClick={() => setShot(null)}>
                    Remove the picture
                  </button>
                </figure>
              ) : (
                <div className="rp__row">
                  <button type="button" className="btn" onClick={() => void grabWindow().then(setShot, fail)}>
                    <Camera aria-hidden="true" /> Add a picture of the window
                  </button>
                  <button type="button" className="btn" onClick={() => file.current?.click()}>
                    <ImagePlus aria-hidden="true" /> Choose a picture…
                  </button>
                  <input
                    ref={file}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void imageFile(f).then(setShot, fail);
                      e.target.value = '';
                    }}
                  />
                </div>
              )}
              <p className="field__note">Optional. You can also paste a picture here (Ctrl+V). Check it shows nothing private.</p>
            </div>
            <label className="rp__check">
              <input type="checkbox" checked={logs} onChange={(e) => setLogs(e.target.checked)} />
              Include {product}’s last {appLog.recent().length} log lines (file names only, no folders, keys or passwords){' '}
              <button type="button" className="linkish" onClick={() => setShowLogs(!showLogs)}>
                {showLogs ? 'hide' : 'see them'}
              </button>
            </label>
            {showLogs && <pre className="rp__logs">{appLog.text() || '(nothing yet)'}</pre>}
            {problem && <p className="field__note field__note--warn">{problem}</p>}
            <footer className="modal__foot">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" disabled={busy || !text.trim()} onClick={() => void go()}>
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
