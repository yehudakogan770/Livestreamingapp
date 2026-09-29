import type { Logo3d } from './types/Logo3d';

/** Mirrors Logo3d::default. */
export function defaultLogo3d(): Logo3d {
  return {
    path: '',
    depth: 24,
    bevel: 6,
    material: 'metal',
    color: '#b8c0c8',
    lightAngle: -40,
    lightStrength: 0.7,
    motion: 'swing',
    swing: 35,
    ends: 'ease',
    seconds: 6,
    angle: 0,
    playing: true,
    camera: 0.4,
    background: 'transparent',
    bgColor: '#101216',
    bgScene: { bank: 0, scene: 0 },
  };
}
