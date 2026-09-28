// Commands from the menu bar to the parts of the control window that carry
// them out (the menu lives in the title bar; the dialogs belong to the view).

import { useEffect } from 'react';

export type Command = { type: 'addInput'; kind?: string; template?: number } | { type: 'addPreset' } | { type: 'shortcuts' };

const bus = new EventTarget();

export function sendCommand(c: Command): void {
  bus.dispatchEvent(new CustomEvent('command', { detail: c }));
}

/** Handle menu commands while mounted. */
export function useCommands(handle: (c: Command) => void): void {
  useEffect(() => {
    const on = (e: Event) => handle((e as CustomEvent<Command>).detail);
    bus.addEventListener('command', on);
    return () => bus.removeEventListener('command', on);
  }, [handle]);
}
