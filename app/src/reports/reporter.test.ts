import { describe, expect, it, vi } from 'vitest';

// The account server, as a stand-in that records what would be sent.
const inserted: unknown[] = [];
let signedIn = true;
vi.mock('../auth/auth', () => ({
  supabase: () => ({
    auth: { getSession: async () => ({ data: { session: signedIn ? {} : null } }) },
    from: () => ({
      insert: async (rows: unknown[]) => {
        inserted.push(...rows);
        return { error: null };
      },
    }),
  }),
}));

const { makeRow, osName, sendProblemReport, MANUAL_PER_HOUR } = await import('./reporter');
const { LogRing, appLog } = await import('./logs');

describe('what an error report holds', () => {
  it('names the computer in general terms', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86';
    expect(osName(ua)).toBe('Windows NT 10.0; Win64; x64 · Edg/131');
    expect(osName('')).toBe('unknown');
  });

  it('is cleaned: no folders, keys or emails in the message or stack', () => {
    const e = new Error(String.raw`cannot write C:\Users\ann\Videos\x.webm for ann@example.com`);
    e.stack = String.raw`Error: at save (C:\Users\ann\app.js:1:2)`;
    const row = makeRow('error', e);
    expect(row.message).toBe('Error: cannot write x.webm for <email>');
    expect(row.stack).not.toMatch(/Users|ann/);
    expect(row.fingerprint.startsWith('lumora:')).toBe(true);
    expect(row).not.toHaveProperty('screenshot');
  });
});

describe('the app’s last log lines', () => {
  it('keeps the last 50, cleaned', () => {
    const log = new LogRing();
    for (let i = 0; i < 60; i++) log.add('log', [`line ${i}`, { path: '/home/ann/secret/file.txt' }], new Date(0));
    expect(log.recent()).toHaveLength(50);
    expect(log.recent()[0]).toContain('line 10');
    expect(log.text()).not.toMatch(/ann|secret/);
    log.add('error', [new TypeError('bad')], new Date(0));
    expect(log.recent().at(-1)).toBe('00:00:00.000 ERROR TypeError: bad');
  });
});

describe('Report a problem', () => {
  it('needs a description, sends with or without the logs, and is limited', async () => {
    appLog.add('warn', ['something odd']);
    await expect(sendProblemReport({ description: '  ', screenshot: null, logs: true }, 0)).rejects.toThrow(/few words/);
    await sendProblemReport({ description: 'The Live Screen went black\nwhen I pressed TAKE', screenshot: 'data:image/jpeg;base64,xx', logs: true }, 0);
    expect(inserted.at(-1)).toMatchObject({ kind: 'report', message: 'The Live Screen went black', screenshot: 'data:image/jpeg;base64,xx' });
    expect((inserted.at(-1) as { logs: string }).logs).toContain('something odd');
    await sendProblemReport({ description: 'again', screenshot: null, logs: false }, 1);
    expect(inserted.at(-1)).toMatchObject({ logs: '', screenshot: null });
    for (let i = 2; i < MANUAL_PER_HOUR; i++) await sendProblemReport({ description: `n${i}`, screenshot: null, logs: false }, i);
    await expect(sendProblemReport({ description: 'too many', screenshot: null, logs: false }, 10)).rejects.toThrow(/a lot of reports/);
    // An hour later it is fine again.
    await sendProblemReport({ description: 'later', screenshot: null, logs: false }, 3_600_100);
  });

  it('asks to sign in first', async () => {
    signedIn = false;
    await expect(sendProblemReport({ description: 'x', screenshot: null, logs: false }, 10_000_000)).rejects.toThrow(/Sign in/);
    signedIn = true;
  });
});
