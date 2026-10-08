import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Action } from '../engine/types/Action';
import type { PtzMove, SeatApi, SeatCommand } from './api';
import { NOT_YOUR_SEAT, roleAllows, type Group, type Role } from './roles';

export interface Seat {
  role: Role | null;
  locked: boolean;
  connected: boolean;
  /** May this seat do things in this group right now? */
  can: (group: Group) => boolean;
  act: (action: Action) => void;
  command: (command: SeatCommand) => void;
  ptz: (source: string, move: PtzMove) => void;
  api: SeatApi;
}

export const SeatCtx = createContext<Seat | null>(null);

export function useSeat(): Seat {
  const s = useContext(SeatCtx);
  if (!s) throw new Error('useSeat outside the seat window');
  return s;
}

export function canDo(role: Role | null, locked: boolean, connected: boolean, group: Group): boolean {
  return connected && !locked && !!role && roleAllows(role, group);
}

/**
 * Controls for one group: disabled (not hidden) when this seat's role
 * doesn't include it, with the reason on hover. The show computer checks
 * again anyway.
 */
export function SeatGate({ group, children, className = '' }: { group: Group; children: ReactNode; className?: string }) {
  const seat = useSeat();
  const ok = seat.can(group);
  const why = ok
    ? undefined
    : !seat.connected
      ? 'Not connected to the show right now'
      : seat.locked
        ? 'The show operator has locked your seat for now'
        : NOT_YOUR_SEAT;
  return (
    <fieldset className={`seat-gate${ok ? '' : ' seat-gate--off'} ${className}`.trim()} disabled={!ok} title={why} data-group={group}>
      {children}
    </fieldset>
  );
}

/** The newest picture for a key, as an image address (null until one arrives). */
export function useSeatPicture(api: SeatApi, key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    let current: string | null = null;
    let busy = false;
    const fetchIt = () => {
      if (busy) return;
      busy = true;
      void api
        .picture(key)
        .then((bytes) => {
          if (!live || !bytes || bytes.byteLength === 0) return;
          const next = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
          if (current) URL.revokeObjectURL(current);
          current = next;
          setUrl(next);
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    fetchIt();
    const stop = api.onPicture((k) => k === key && fetchIt());
    return () => {
      live = false;
      stop();
      if (current) URL.revokeObjectURL(current);
      setUrl(null);
    };
  }, [api, key]);
  return url;
}
