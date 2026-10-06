/**
 * Keeps the `--val` custom property of every slider (input type=range) at its
 * value as a percentage, so styles.css can draw the filled part of the slot.
 * Sliders change by dragging (an input event) and by code (React or the engine
 * setting `value`), so both are covered.
 */
const isRange = (el: unknown): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'range';

export function paintRange(el: HTMLInputElement): void {
  const min = el.min === '' ? 0 : Number(el.min);
  const max = el.max === '' ? 100 : Number(el.max);
  const v = Number(el.value);
  const pct = max > min && Number.isFinite(v) ? ((v - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--val', `${Math.min(100, Math.max(0, pct))}%`);
}

let installed = false;

export function installRangeFill(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const proto = HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set && desc.get) {
    const { get, set } = desc;
    Object.defineProperty(proto, 'value', {
      ...desc,
      get() {
        return get.call(this);
      },
      set(v: string) {
        set.call(this, v);
        if (this.type === 'range') paintRange(this);
      },
    });
  }
  document.addEventListener('input', (e) => isRange(e.target) && paintRange(e.target), true);
  const paintIn = (n: Node) => {
    if (isRange(n)) paintRange(n);
    else if (n instanceof Element) n.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(paintRange);
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes') {
        if (isRange(m.target)) paintRange(m.target);
      } else m.addedNodes.forEach(paintIn);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['min', 'max', 'value', 'type'] });
  paintIn(document.documentElement);
}
