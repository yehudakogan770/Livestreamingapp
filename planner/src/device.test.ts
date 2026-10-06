import { describe, expect, it } from 'vitest';
import { detectDevice, layoutFor, type DeviceEnv } from './device';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  // iPadOS 13 and later: Safari asks for the desktop site and says it is a Mac.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  galaxyTab: 'Mozilla/5.0 (Linux; Android 9; SM-T837A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const env = (o: Partial<DeviceEnv>): DeviceEnv => ({
  ua: UA.windows,
  platform: 'Win32',
  touchPoints: 0,
  coarse: false,
  fine: true,
  width: 1440,
  height: 900,
  ...o,
});
const touch = { coarse: true, fine: false, touchPoints: 5 };

describe('which device the Planner is on', () => {
  it('an iPhone is a phone, held either way', () => {
    expect(detectDevice(env({ ua: UA.iphone, platform: 'iPhone', ...touch, width: 393, height: 852 }))).toBe('phone');
    expect(detectDevice(env({ ua: UA.iphone, platform: 'iPhone', ...touch, width: 852, height: 393 }))).toBe('phone');
  });

  it('an Android phone is a phone; an Android tablet is a tablet', () => {
    expect(detectDevice(env({ ua: UA.pixel, platform: 'Linux armv81', ...touch, width: 412, height: 915 }))).toBe('phone');
    expect(detectDevice(env({ ua: UA.pixel, platform: 'Linux armv81', ...touch, width: 915, height: 412 }))).toBe('phone');
    expect(detectDevice(env({ ua: UA.galaxyTab, platform: 'Linux armv81', ...touch, width: 712, height: 1138 }))).toBe('tablet');
    expect(detectDevice(env({ ua: UA.galaxyTab, platform: 'Linux armv81', ...touch, width: 1138, height: 712 }))).toBe('tablet');
  });

  it('an iPad is a tablet, also when iPadOS says it is a Mac', () => {
    expect(detectDevice(env({ ua: UA.ipadOld, platform: 'iPad', ...touch, width: 834, height: 1194 }))).toBe('tablet');
    expect(detectDevice(env({ ua: UA.mac, platform: 'MacIntel', ...touch, width: 1194, height: 834 }))).toBe('tablet');
    // With a trackpad attached the main pointer is fine, but it is still the iPad.
    expect(detectDevice(env({ ua: UA.mac, platform: 'MacIntel', touchPoints: 5, coarse: false, fine: true, width: 1194, height: 834 }))).toBe('tablet');
  });

  it('a Mac is a computer (no touch points)', () => {
    expect(detectDevice(env({ ua: UA.mac, platform: 'MacIntel', touchPoints: 0 }))).toBe('computer');
  });

  it('a touch laptop with a trackpad is a computer', () => {
    expect(detectDevice(env({ ua: UA.windows, touchPoints: 10, coarse: false, fine: true, width: 1368, height: 912 }))).toBe('computer');
  });

  it('a computer with a narrow window is still a computer, in the compact layout', () => {
    expect(detectDevice(env({ width: 420, height: 800 }))).toBe('computer');
    expect(layoutFor(env({ width: 900, height: 800 }))).toEqual({ device: 'computer', orientation: 'landscape', compact: true });
    expect(layoutFor(env({ width: 1440, height: 900 }))).toEqual({ device: 'computer', orientation: 'landscape', compact: false });
  });

  it('a touch-only screen with a desktop browser goes by its size', () => {
    expect(detectDevice(env({ ua: UA.linux, ...touch, width: 1280, height: 800 }))).toBe('tablet');
    expect(detectDevice(env({ ua: UA.linux, ...touch, width: 360, height: 740 }))).toBe('phone');
  });

  it('with nothing to go on (no pointer reported), a computer', () => {
    expect(detectDevice(env({ ua: UA.linux, coarse: false, fine: false }))).toBe('computer');
  });

  it('knows which way up a tablet is, and never makes a tablet compact', () => {
    expect(layoutFor(env({ ua: UA.mac, platform: 'MacIntel', ...touch, width: 834, height: 1194 }))).toEqual({
      device: 'tablet',
      orientation: 'portrait',
      compact: false,
    });
  });
});
