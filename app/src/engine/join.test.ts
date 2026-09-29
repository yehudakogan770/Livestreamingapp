import { describe, expect, it } from 'vitest';
import { joinShown, JOIN_TURN_MS } from './join';

describe('join codes', () => {
  const wifi = { name: 'Hall', password: 'x', qr: '<svg>wifi</svg>', show: true };
  it('take turns with the Wi-Fi code only when the page is on the local network', () => {
    const local = 'http://192.168.1.2:8765/vote';
    expect(joinShown(local, '<svg>page</svg>', 'Scan to vote', wifi, 0)).toEqual({ qr: '<svg>wifi</svg>', label: '1 · Join the Wi-Fi', sub: 'Wi-Fi: Hall' });
    expect(joinShown(local, '<svg>page</svg>', 'Scan to vote', wifi, JOIN_TURN_MS).label).toBe('2 · Scan to vote');
    const net = 'https://a-b.trycloudflare.com/vote';
    expect(joinShown(net, '<svg>page</svg>', 'Scan to vote', wifi, 0)).toEqual({
      qr: '<svg>page</svg>',
      label: 'Scan to vote',
      sub: 'a-b.trycloudflare.com/vote',
    });
    expect(joinShown(local, '<svg>page</svg>', 'Scan to vote', { ...wifi, show: false }, 0).label).toBe('Scan to vote');
  });
});
