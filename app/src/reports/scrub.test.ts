import { describe, expect, it } from 'vitest';
import { fingerprint, scrub } from './scrub';

describe('cleaning error reports', () => {
  it('keeps file names but never the folders (no user names)', () => {
    expect(scrub(String.raw`Could not open C:\Users\Ann Lee\Videos\Spring Gala.mp4: access denied`)).not.toMatch(/Users|Ann|Videos/);
    expect(scrub(String.raw`read C:\Users\ann\show.lumora failed`)).toBe('read show.lumora failed');
    expect(scrub('saved to C:/Users/ann/Videos/Lumora/rec.webm')).toBe('saved to rec.webm');
    expect(scrub(String.raw`\\NAS\events\2026\cam1.mov missing`)).toBe('cam1.mov missing');
    expect(scrub('/home/ann/Videos/show.lumora is broken')).toBe('show.lumora is broken');
    expect(scrub('/Users/ann/Movies/a.mov')).toBe('a.mov');
    expect(scrub('~/Movies/a.mov')).toBe('a.mov');
    expect(scrub('folder C:\\Users\\ann\\')).toBe('folder <folder>');
  });

  it('cleans paths hidden inside app addresses', () => {
    expect(scrub('GET http://asset.localhost/C%3A%5CUsers%5Cann%5Cclip.mp4 404')).toBe('GET <file:clip.mp4> 404');
    expect(scrub('file:///home/ann/x/logo.png')).toBe('<file:logo.png>');
  });

  it('leaves the app’s own script addresses and plain words alone', () => {
    const frame = 'at Xe (http://tauri.localhost/assets/index-BxW3kd.js:40:1234)';
    expect(scrub(frame)).toBe(frame);
    expect(scrub('16/9 and/or 4/3')).toBe('16/9 and/or 4/3');
    expect(scrub('TypeError: undefined is not a function')).toBe('TypeError: undefined is not a function');
  });

  it('takes out emails', () => {
    expect(scrub('no account for ann.lee+test@example.co.uk')).toBe('no account for <email>');
  });

  it('takes out stream keys, passwords and tokens', () => {
    expect(scrub('rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop-qrst refused')).toBe('rtmp://a.rtmp.youtube.com/<hidden> refused');
    expect(scrub('srt://1.2.3.4:9000?streamid=secret&passphrase=hunter2')).toBe('srt://<ip>:9000/<hidden>');
    expect(scrub('stream key abcd-efgh-ijkl-mnop-qrst is wrong')).toBe('stream key <key> is wrong');
    expect(scrub('twitch live_123456_AbCdEf failed')).toBe('twitch <key> failed');
    expect(scrub('password=hunter2 user=ann')).toBe('password=<hidden> user=ann');
    expect(scrub('{"key":"abc123","name":"Live"}')).toBe('{"key":<hidden>,"name":"Live"}');
    expect(scrub("streamKey: 'xyz'")).toBe('streamKey: <hidden>');
    expect(scrub('Authorization: Bearer abc.def.ghi')).not.toContain('abc');
    expect(scrub('sent Bearer abc.def.ghi')).toBe('sent Bearer <hidden>');
    expect(scrub('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlMTIz here')).toBe('token <token> here');
    expect(scrub('using sb_publishable_SW15wnTjCrTapvBZxXA5qg_E94To1FF')).toBe('using <key>');
    expect(scrub('id 9f8e7d6c5b4a39281706f5e4d3c2b1a0aabbccdd')).toBe('id <secret>');
    // Twitch chat signs in with 'PASS oauth:…' (30 letters: too short for the catch-all).
    expect(scrub('PASS oauth:abcdefghij0123456789klmnopqrst')).toBe('PASS oauth:<hidden>');
    expect(scrub('client_secret=abc123def')).toBe('client_secret=<hidden>');
  });

  it('takes out network addresses', () => {
    expect(scrub('NDI camera at 192.168.1.20 lost')).toBe('NDI camera at <ip> lost');
  });

  it('cuts long text and reads errors and objects', () => {
    expect(scrub('x'.repeat(5000), 100)).toHaveLength(100);
    expect(scrub(new RangeError('too far'))).toBe('RangeError: too far');
    expect(scrub({ a: 1 })).toBe('{"a":1}');
    expect(scrub(undefined)).toBe('undefined');
  });

  it('groups the same problem from different computers', () => {
    const a = fingerprint('lumora', String.raw`Could not open C:\Users\ann\a.mp4 (error 5)`);
    const b = fingerprint('lumora', String.raw`Could not open D:\Shows\b.mp4 (error 32)`);
    expect(a).toBe(b);
    expect(fingerprint('studio', 'x')).not.toBe(fingerprint('lumora', 'x'));
    expect(fingerprint('lumora', 'Input “Cam 2” is missing')).toBe(fingerprint('lumora', 'Input “Wide” is missing'));
  });
});
