import { lazy, Suspense, useState, type ComponentType } from 'react';

/** A part of the app that is loaded when first needed (see lazyPart). */
export type LazyPart<P extends object> = ComponentType<P> & {
  /** Load it now (once); drawn at once from then on, with no wait. */
  preload(): Promise<ComponentType<P>>;
};

/**
 * A window or panel that is loaded the first time it opens, not when Lumora
 * starts: it starts sooner and holds less while the show runs. Nothing is
 * shown while it loads (a moment, from the app's own files).
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): LazyPart<P> {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const preload = () =>
    (loading ??= load().then(
      (c) => (loaded = c),
      (e: unknown) => {
        // Tried again next time (a file that could not be read for a moment).
        loading = null;
        throw e;
      },
    ));
  const Part = lazy(async () => ({ default: await preload() }));
  const Waiting = Part as unknown as ComponentType<P>;
  function LazyPart(props: P) {
    // Already loaded when this one first shows: drawn straight away. (Chosen
    // once, so it never swaps between the two ways and loses what it holds.)
    const [ready] = useState(() => loaded);
    if (ready) {
      const Ready = ready;
      return <Ready {...props} />;
    }
    return (
      <Suspense fallback={null}>
        <Waiting {...props} />
      </Suspense>
    );
  }
  return Object.assign(LazyPart, { preload });
}
