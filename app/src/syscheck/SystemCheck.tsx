// "Check this computer…" (Help menu), and the check that runs by itself the
// first time the app starts on a computer. It only ever informs: the app
// works the same whatever it says.

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { Check as CheckIcon, Copy, Send, X } from 'lucide-react';
import { BrandMark } from '../components/Logo';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { TEST_BUILD } from '../e2e';
import { openProblemReport } from '../reports/ReportUI';
import { detailsText } from './details';
import { judge, type AppId, type BrowserFacts, type Facts, type RecordingPlan, type Report } from './rules';
import { markSeen, readSeen, shouldAutoRun } from './seen';
import './syscheck.css';

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ---- Opened from any menu ----
let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  open = v;
  for (const l of listeners) l();
}
/** Open "Check this computer". */
export const openSystemCheck = (): void => setOpen(true);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** What the page itself can see: WebGL's renderer, cameras and microphones (never asks for them). */
export async function browserFacts(): Promise<BrowserFacts> {
  let webgl2 = false;
  let renderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      webgl2 = true;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // No WebGL 2.
  }
  let cameras: number | null = null;
  let mics: number | null = null;
  let exact = false;
  try {
    const list = (await navigator.mediaDevices?.enumerateDevices()) ?? null;
    if (list) {
      cameras = list.filter((d) => d.kind === 'videoinput').length;
      mics = list.filter((d) => d.kind === 'audioinput').length;
      exact = list.some((d) => d.label !== '');
    }
  } catch {
    // Not allowed here: left unknown.
  }
  const edge = /\bEdg\/(\d+)/.exec(navigator.userAgent)?.[1];
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { webgl2, renderer, cameras, mics, exact, edge: edge ? Number(edge) : null, today };
}

interface Run {
  report: Report;
  facts: Facts | null;
  browser: BrowserFacts;
  version: string;
}

/** Facts from the program, the page's own, and Lumora's recording settings, judged. */
async function runCheck(app: AppId): Promise<Run> {
  const browser = await browserFacts();
  const facts = inApp() ? await invoke<Facts>('system_facts') : null;
  let plan: RecordingPlan | null = null;
  if (app === 'lumora' && inApp()) {
    try {
      const s = await invoke<{ videoKbps: number; audioKbps: number; iso: boolean; isoKbps?: number }>('capture_settings');
      plan = { videoKbps: s.videoKbps, audioKbps: s.audioKbps, iso: s.iso, cameras: browser.cameras ?? 1, isoKbps: s.isoKbps };
    } catch {
      // Without the settings, no hours of recording.
    }
  }
  const version = inApp() ? await getVersion().catch(() => 'unknown') : 'browser';
  return { report: judge(app, facts ?? emptyFacts(), browser, plan), facts, browser, version };
}

function emptyFacts(): Facts {
  return {
    os: { name: '', build: 0, displayVersion: '', is64bit: true },
    cpu: { name: '', cores: navigator.hardwareConcurrency || 0, threads: navigator.hardwareConcurrency || 0 },
    memory: { totalMb: 0, availableMb: 0 },
    gpus: [],
    disks: [],
    webview2: null,
    ffmpeg: { found: false, runs: false, version: '' },
    hwEncoders: [],
    hwDecode: null,
    power: { battery: false, onBattery: false, plan: '', mode: '' },
    displays: [],
    native: null,
    missing: ['everything the program measures (not running in the app)'],
  };
}

const productOf = (app: AppId) => (app === 'lumora' ? 'Lumora' : 'Lumora Studio');

/**
 * Put once in the main window: runs the check by itself the first time
 * (and after an update that changes the requirements), and shows the window.
 */
export function SystemCheckHost({ app }: { app: AppId }) {
  const isOpen = useSyncExternalStore(subscribe, () => open);
  const [run, setRun] = useState<Run | null>(null);
  const [card, setCard] = useState(false);

  useEffect(() => {
    if (!inApp() || TEST_BUILD || !shouldAutoRun(readSeen(app))) return;
    let live = true;
    // After the app has settled, so starting up stays quick.
    const t = setTimeout(() => {
      void runCheck(app)
        .then((r) => {
          if (!live) return;
          markSeen(app, r.version, r.report.verdict);
          setRun(r);
          setCard(true);
        })
        .catch(() => {});
    }, 6000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [app]);

  return (
    <>
      {card && run && !isOpen && (
        <SummaryCard
          run={run}
          onOpen={() => {
            setCard(false);
            setOpen(true);
          }}
          onClose={() => setCard(false)}
        />
      )}
      {isOpen && <SystemCheckDialog app={app} first={run} onClose={() => setOpen(false)} onRan={setRun} />}
    </>
  );
}

const BADGE: Record<Report['verdict'], string> = { yes: 'YES', risky: 'RISKY', no: 'NO' };

function SummaryCard({ run, onOpen, onClose }: { run: Run; onOpen: () => void; onClose: () => void }) {
  const r = run.report;
  return (
    <div className={`sc-card sc--${r.verdict}`} role="dialog" aria-label="System check">
      <span className="sc-badge">{BADGE[r.verdict]}</span>
      <div className="sc-card__body">
        <b>{r.headline}</b>
        <p>{r.tips[0]?.text}</p>
        <div className="sc-row">
          <button type="button" className="btn btn--primary" onClick={onOpen} autoFocus>
            See the advice
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const GRADE: Record<string, string> = { good: 'Good', ok: 'OK', low: 'Low', info: '—' };
const SAFETY: Record<string, string> = { safe: 'Safe', risky: 'Risky', avoid: 'Avoid' };
/** Advice lines shown before "Show all". */
const FIRST_TIPS = 5;

export function SystemCheckDialog({ app, first, onClose, onRan }: { app: AppId; first: Run | null; onClose: () => void; onRan?: (r: Run) => void }) {
  const [run, setRun] = useState<Run | null>(first);
  const [busy, setBusy] = useState(!first);
  const [problem, setProblem] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const product = productOf(app);

  const again = useCallback(() => {
    setBusy(true);
    setProblem(null);
    void runCheck(app)
      .then((r) => {
        setRun(r);
        onRan?.(r);
        markSeen(app, r.version, r.report.verdict);
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [app, onRan]);

  useEffect(() => {
    // Once, when opened (unless the check that ran by itself is shown).
    if (!first) again();
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const text = run ? detailsText(run.report, run.facts, run.browser, run.version) : '';
  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setProblem('Could not copy. Select the details and press Ctrl+C.'),
    );
  const send = () => {
    onClose();
    openProblemReport(`\n\n${text}`);
  };

  const r = run?.report;
  const tips = r ? (all ? r.tips : r.tips.slice(0, FIRST_TIPS)) : [];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Check this computer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box sc">
        <header className="modal__head">
          <h2>
            <BrandMark of={app} className="modal__icon" />
            Check this computer
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="sc__body">
          {busy && !r && (
            <p className="sc__wait" role="status">
              Checking this computer… (a few seconds)
            </p>
          )}
          {r && (
            <>
              <section className={`sc-verdict sc--${r.verdict}`} aria-live="polite">
                <span className="sc-badge sc-badge--big">{BADGE[r.verdict]}</span>
                <div>
                  <h3>{r.headline}</h3>
                  <p>
                    {r.sentence} The check only advises: you can always use {product}.
                  </p>
                </div>
              </section>

              <section className="sc-sec">
                <h4>{app === 'lumora' ? 'At an event on this computer' : 'Editing on this computer'}</h4>
                <ul className="sc-tips">
                  {tips.map((t) => (
                    <li key={t.text} className={`sc-tip sc-tip--${t.kind}`}>
                      <span className="sc-tip__kind">{t.kind === 'do' ? 'DO' : 'DON’T'}</span>
                      <span>{t.text}</span>
                    </li>
                  ))}
                </ul>
                {all && (
                  <table className="sc-feat">
                    <tbody>
                      {r.features.map((x) => (
                        <tr key={x.name}>
                          <th scope="row">{x.name}</th>
                          <td>
                            <span className={`sc-pill sc-pill--${x.safety}`}>{SAFETY[x.safety]}</span>
                          </td>
                          <td className="sc-dim">{x.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button type="button" className="linkish" onClick={() => setAll(!all)}>
                  {all ? 'Show less' : `Show all (${r.tips.length} lines, and what’s safe to use)`}
                </button>
              </section>

              <section className="sc-sec">
                <h4>The checks</h4>
                <ul className="sc-checks">
                  {r.checks.map((c) => (
                    <li key={c.id} className="sc-check">
                      <span className={`sc-pill sc-pill--${c.grade}`}>{GRADE[c.grade]}</span>
                      <div>
                        <div className="sc-check__head">
                          <b>{c.label}</b> <span className="sc-dim">{c.value}</span>
                        </div>
                        {c.advice && <div className="sc-check__advice">{c.advice}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
                {run?.facts?.missing.length ? <p className="field__note">Not measured: {run.facts.missing.join('; ')}.</p> : null}
              </section>
            </>
          )}
          {problem && <p className="field__note field__note--warn">{problem}</p>}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" disabled={!r} onClick={copy}>
            {copied ? <CheckIcon aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? 'Copied' : 'Copy details'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!r}
            onClick={send}
            title="Opens Report a problem with these details in it; nothing is sent until you press Send"
          >
            <Send aria-hidden="true" /> Send to the Lumora team…
          </button>
          <span className="sc-grow" />
          <button type="button" className="btn" disabled={busy} onClick={again}>
            {busy ? 'Checking…' : 'Check again'}
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
