// The caption text as viewers see it: the newest words, wrapped into a few
// short lines, cleared after a quiet while.

export const CLEAR_AFTER_MS = 6000;

export class CaptionLines {
  private done = '';
  private partial = '';
  private at = 0;

  /** The phrase being said, so far. */
  setPartial(text: string, now = Date.now()): void {
    this.partial = text.trim();
    if (this.partial) this.at = now;
  }

  /** A finished phrase. */
  addFinal(text: string, now = Date.now()): void {
    const t = text.trim();
    this.partial = '';
    if (!t) return;
    this.done = `${this.done} ${t}`.trim().slice(-400);
    this.at = now;
  }

  /** The lines to show now (at most `lines` of about `width` characters); none after a quiet while. */
  shown(lines: number, width: number, now = Date.now()): string[] {
    if (now - this.at > CLEAR_AFTER_MS) {
      this.done = '';
      return [];
    }
    return wrap(`${this.done} ${this.partial}`.trim(), width).slice(-lines);
  }
}

/** Words wrapped into lines of about `width` characters. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}
