import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bell, ListChecks } from 'lucide-react';
import * as pro from './apiPro';
import { db } from './session';
import './notices.css';

export interface NoticeStore {
  list: pro.Notice[];
  unread: number;
  /** The server has notifications (update 10). */
  ready: boolean;
  readAll: () => void;
  clear: () => void;
}

/** Your notifications (mentions, tasks given to you), live; the browser can show new ones too. */
export function useNotices(userId: string | null, onNew?: (n: pro.Notice) => void): NoticeStore {
  const [list, setList] = useState<pro.Notice[]>([]);
  const [ready, setReady] = useState(false);
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    if (!userId) return;
    let on = true;
    pro
      .loadNotices(db())
      .then((l) => {
        if (!on) return;
        setList(l);
        setReady(true);
      })
      .catch(() => on && setReady(false));
    const stop = pro.watchNotices(db(), userId, (n) => {
      setList((l) => (l.some((x) => x.id === n.id) ? l : [n, ...l].slice(0, 100)));
      cb.current?.(n);
    });
    return () => {
      on = false;
      stop();
    };
  }, [userId]);
  const readAll = useCallback(() => {
    const ids = list.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    setList((l) => l.map((n) => ({ ...n, read: true })));
    void pro.markRead(db(), ids).catch(() => {});
  }, [list]);
  const clear = useCallback(() => {
    const ids = list.map((n) => n.id);
    setList([]);
    void pro.clearNotices(db(), ids).catch(() => {});
  }, [list]);
  return { list, unread: list.filter((n) => !n.read).length, ready, readAll, clear };
}

const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** The bell: your notifications, newest first. */
export function NoticeBell({
  store,
  planName,
  onOpen,
  label = false,
}: {
  store: NoticeStore;
  planName: (id: string) => string;
  onOpen: (n: pro.Notice) => void;
  label?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!store.ready) return null;
  return (
    <div className="account notices" ref={box}>
      <button
        type="button"
        className="btn btn--quiet notices__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications${store.unread ? `, ${store.unread} new` : ''}`}
        title="Notifications"
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(store.readAll, 1500);
        }}
      >
        <Bell size={16} strokeWidth={1.75} aria-hidden="true" />
        {label && <span className="side__text">Notifications</span>}
        {store.unread > 0 && <span className="notices__n">{store.unread > 99 ? '99+' : store.unread}</span>}
      </button>
      {open && (
        <div className="popover notices__menu" role="menu" aria-label="Notifications">
          <div className="notices__head">
            <b>Notifications</b>
            <span className="bar__spacer" />
            {store.list.length > 0 && (
              <button type="button" className="link small" onClick={store.clear}>
                Clear all
              </button>
            )}
          </div>
          <NoticeList
            store={store}
            planName={planName}
            onOpen={(n) => {
              setOpen(false);
              onOpen(n);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** The notifications, newest first (in the bell's menu, and on the phone's Account page). */
export function NoticeList({ store, planName, onOpen }: { store: NoticeStore; planName: (id: string) => string; onOpen: (n: pro.Notice) => void }) {
  return (
    <>
      {store.list.length === 0 && <p className="muted small notices__none">Nothing yet. When someone names you with @ or gives you a task, it shows here.</p>}
      {store.list.map((n) => (
        <button key={n.id} type="button" role="menuitem" className={`notices__item${n.read ? '' : ' is-new'}`} onClick={() => onOpen(n)}>
          {n.kind === 'task' ? <ListChecks size={15} strokeWidth={1.75} aria-hidden="true" /> : <AtSign size={15} strokeWidth={1.75} aria-hidden="true" />}
          <span className="grow">
            <span>
              <b>{n.from || 'Someone'}</b> {n.kind === 'task' ? 'gave you a task' : 'mentioned you'} in <b>{planName(n.planId) || 'a plan'}</b>
            </span>
            <span className="muted small notices__body">{n.body}</span>
            <span className="muted small">{ago(n.createdAt)}</span>
          </span>
        </button>
      ))}
    </>
  );
}
