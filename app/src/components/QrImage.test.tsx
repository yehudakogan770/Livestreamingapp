import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { QrImage } from './QrImage';

afterEach(cleanup);

test('a QR code from an event file is only ever a picture, never markup', () => {
  // An event file someone sent could hold anything where the QR code goes.
  const evil =
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>';
  const { container } = render(<QrImage className="poll__qr" svg={evil} />);
  expect(container.querySelector('script, iframe, svg, foreignObject')).toBeNull();
  const img = container.querySelector('img')!;
  expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
});

test('no screen puts text into the page as markup', () => {
  const roots = ['app/src', 'editor/app/src', 'planner/src'];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (
        /\.tsx?$/.test(name) &&
        !/\.test\.tsx?$/.test(name) &&
        /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(readFileSync(p, 'utf8'))
      )
        found.push(p);
    }
  };
  for (const r of roots) walk(r);
  expect(found).toEqual([]);
});
