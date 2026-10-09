// Character styles: words in a text take a shared style's font, weight,
// color and size.

import { describe, expect, it } from 'vitest';
import { expandCharStyles, parseRich } from './layout';
import { textStyle } from './build';

const styles = [
  { name: 'Accent', style: textStyle({ font: 'Bebas Neue', weight: 700, size: 112, fill: { type: 'solid', color: '$accent' } }) },
  { name: 'Quiet', style: textStyle({ font: 'Inter', weight: 400, italic: true, size: 56, fill: { type: 'solid', color: '#999999' } }) },
];

describe('character styles', () => {
  it('turn into the inline styling the text already understands', () => {
    expect(expandCharStyles('Breaking [cs=Accent]news[/cs] now', styles, 56)).toBe('Breaking [f=Bebas Neue][b][c=$accent][s=200]news[/s][/c][/b][/f] now');
    const runs = parseRich(expandCharStyles('a [cs=accent]b[/cs] c', styles, 56));
    expect(runs.map((r) => r.text)).toEqual(['a ', 'b', ' c']);
    expect(runs[1]!.style).toMatchObject({ font: 'Bebas Neue', bold: true, color: '$accent', scale: 200 });
    expect(runs[2]!.style.bold).toBe(false);
  });

  it('nest, and leave unknown names and words without styles as they are', () => {
    const out = expandCharStyles('[cs=Quiet]x [cs=Accent]y[/cs] z[/cs]', styles, 56);
    const runs = parseRich(out);
    expect(runs.map((r) => [r.text, r.style.italic, r.style.color])).toEqual([
      ['x ', true, '#999999'],
      ['y', true, '$accent'],
      [' z', true, '#999999'],
    ]);
    expect(expandCharStyles('[cs=Nope]x[/cs]', styles, 56)).toBe('[cs=Nope]x[/cs]');
    expect(expandCharStyles('plain', undefined, 56)).toBe('plain');
  });
});
