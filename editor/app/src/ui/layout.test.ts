import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read from disk: style sheets come in empty under the test runner.
const css = readFileSync(resolve(__dirname, '../editor.css'), 'utf8');

/** The declarations of the first rule with exactly this selector. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('layout at narrow widths', () => {
  it('keeps the menus whole: the project name gives way instead of running under them', () => {
    expect(rule('.ed__menus')).toMatch(/flex:\s*none/);
    expect(rule('.ed__logo')).toMatch(/flex:\s*none/);
    expect(rule('.ed__name')).toMatch(/min-width:\s*0/);
    expect(rule('.ed__name > span')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('shortens the save note with an ellipsis', () => {
    expect(rule('.ed__saved')).toMatch(/min-width:\s*0/);
    expect(rule('.ed__saved > span')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('lines template groups up with the other headings in Text & more', () => {
    expect(css).toMatch(/\.fxlist__group > \.ttpl__group\s*\{\s*margin:\s*2px 8px;/);
  });
});
