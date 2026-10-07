import { describe, expect, it } from 'vitest';
import type { Facts, Gpu } from '../../../../../app/src/syscheck/rules';
import { markOffered, mayOffer, nativeOffer, OFFERED_KEY } from './suggest';

const RTX: Gpu = { name: 'NVIDIA GeForce RTX 3060', vendor: 'nvidia', vramMb: 12288, driverVersion: '32.0', driverDate: '2026-05-01', software: false };
const UHD: Gpu = { name: 'Intel(R) UHD Graphics 620', vendor: 'intel', vramMb: 128, driverVersion: '31.0', driverDate: '2025-01-01', software: false };
const IRIS: Gpu = { name: 'Intel(R) Iris(R) Xe Graphics', vendor: 'intel', vramMb: 128, driverVersion: '31.0', driverDate: '2025-01-01', software: false };

const facts = (gpus: Gpu[], adapters: { name: string; kind: string }[]): Pick<Facts, 'gpus' | 'native'> => ({
  gpus,
  native: { adapters: adapters.map((a) => ({ ...a, backend: 'Dx12' })), supported: adapters.some((a) => a.kind === 'discrete' || a.kind === 'integrated') },
});

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('offering native playback', () => {
  it('is offered on a real card the engine can use, naming it', () => {
    expect(nativeOffer(facts([RTX], [{ name: 'NVIDIA GeForce RTX 3060', kind: 'discrete' }]))).toBe('NVIDIA GeForce RTX 3060');
    expect(nativeOffer(facts([IRIS], [{ name: 'Intel(R) Iris(R) Xe Graphics', kind: 'integrated' }]))).toBe('Intel(R) Iris(R) Xe Graphics');
  });
  it('is not offered on weak graphics, software drawing, or without the engine', () => {
    expect(nativeOffer(facts([UHD], [{ name: 'Intel(R) UHD Graphics 620', kind: 'integrated' }]))).toBeNull();
    expect(nativeOffer(facts([RTX], [{ name: 'Microsoft Basic Render Driver', kind: 'software' }]))).toBeNull();
    expect(nativeOffer({ gpus: [RTX], native: null })).toBeNull();
    expect(nativeOffer(null)).toBeNull();
  });
  it('is asked once: never after a choice or an answer', () => {
    const store = memory();
    expect(mayOffer(false, store)).toBe(true);
    expect(mayOffer(true, store)).toBe(false);
    markOffered(store);
    expect(store.getItem(OFFERED_KEY)).toBe('1');
    expect(mayOffer(false, store)).toBe(false);
  });
});
