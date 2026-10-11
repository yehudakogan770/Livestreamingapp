// Dialogs: the designer's own modal box (Escape and a click outside close it,
// focus starts inside and stays there, and comes back where it was), and
// in-app replacements for the browser's confirm and prompt (which look out of
// place and are not available in every desktop web view).

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

/** Open modals, the newest last: only the top one answers Escape. */
const stack: symbol[] = [];

/** Whether a designer dialog is open (the designer's shortcuts wait while one is). */
export const modalOpen = () => stack.length > 0;

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function Modal({
  label,
  onClose,
  className = '',
  children,
  outsideCloses = true,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  /** A click on the dimmed area closes it (off while work is under way). */
  outsideCloses?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const id = Symbol(label);
    stack.push(id);
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const first = (el.querySelector('[autofocus]') ?? el.querySelector('.tt-primary:not([disabled])') ?? el.querySelector(FOCUSABLE)) as HTMLElement | null;
      first?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
        return;
      }
      if (e.key === 'Tab' && el) {
        // Focus stays in the dialog.
        const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
        if (!list.length) return;
        const first = list[0]!;
        const last = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (before?.isConnected) before.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="tt-modal"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerDown={(e) => {
        if (outsideCloses && e.target === e.currentTarget) close.current();
      }}
    >
      <div className={`tt-modal-box ${className}`.trim()} ref={box}>
        {children}
      </div>
    </div>
  );
}

// ---- confirm and prompt, in the designer's own look ----

type Ask =
  | { kind: 'confirm'; title: string; message: string; ok: string; danger: boolean; done: (v: boolean) => void }
  | { kind: 'text'; title: string; message: string; value: string; ok: string; done: (v: string | null) => void };

let current: Ask | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const show = (a: Ask | null) => {
  current = a;
  emit();
};

/** Ask a yes/no question ("Delete … from the library?"). */
export function askConfirm(title: string, message: string, ok = 'OK', danger = false): Promise<boolean> {
  // No designer on screen (a test of one panel): the browser's own.
  if (!hosts) return Promise.resolve(typeof confirm === 'function' ? confirm(message) : true);
  return new Promise((resolve) => {
    current?.kind === 'confirm' ? current.done(false) : current?.done(null);
    show({ kind: 'confirm', title, message, ok, danger, done: (v) => (show(null), resolve(v)) });
  });
}

/** Ask for a name (null: canceled). */
export function askText(title: string, message: string, value = '', ok = 'OK'): Promise<string | null> {
  if (!hosts) return Promise.resolve(typeof prompt === 'function' ? prompt(message, value) : value);
  return new Promise((resolve) => {
    current?.kind === 'confirm' ? current.done(false) : current?.done(null);
    show({ kind: 'text', title, message, value, ok, done: (v) => (show(null), resolve(v)) });
  });
}

/** Where the questions appear (one in the designer). */
export function AskHost() {
  const a = useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => current,
  );
  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
    };
  }, []);
  if (!a) return null;
  return a.kind === 'confirm' ? <ConfirmBox a={a} /> : <TextBox key={a.title} a={a} />;
}

function ConfirmBox({ a }: { a: Extract<Ask, { kind: 'confirm' }> }) {
  return (
    <Modal label={a.title} onClose={() => a.done(false)} className="tt-ask">
      <h2>{a.title}</h2>
      <p>{a.message}</p>
      <div className="tt-modal-actions">
        <button className="tt-plain" onClick={() => a.done(false)}>
          Cancel
        </button>
        <button className={a.danger ? 'tt-primary tt-danger' : 'tt-primary'} onClick={() => a.done(true)} autoFocus>
          {a.ok}
        </button>
      </div>
    </Modal>
  );
}

function TextBox({ a }: { a: Extract<Ask, { kind: 'text' }> }) {
  const [v, setV] = useState(a.value);
  const ok = () => v.trim() && a.done(v.trim());
  return (
    <Modal label={a.title} onClose={() => a.done(null)} className="tt-ask">
      <h2>{a.title}</h2>
      <label className="tt-ask-field">
        <span className="tt-dim">{a.message}</span>
        <input
          className="tt-input"
          value={v}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ok();
          }}
        />
      </label>
      <div className="tt-modal-actions">
        <button className="tt-plain" onClick={() => a.done(null)}>
          Cancel
        </button>
        <button className="tt-primary" onClick={ok} disabled={!v.trim()}>
          {a.ok}
        </button>
      </div>
    </Modal>
  );
}
