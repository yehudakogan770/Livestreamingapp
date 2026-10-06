/**
 * Measuring speed in a plain browser (docs/PERFORMANCE.md, Studio): while
 * developing, or in a build made with VITE_LUMORA_BENCH=1 (never the
 * installers: the bundler drops what this guards).
 */
export const BENCH: boolean = import.meta.env.DEV || import.meta.env.VITE_LUMORA_BENCH === '1';
