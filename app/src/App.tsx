import { useMemo } from 'react';
import { isMultiview, isVisionWorker, outputScreen, overlayScreen } from './engine/role';
import { lazyPart } from './components/lazyPart';
import './App.css';

// Each window loads only its own part: the control window never loads the
// output view's code and the output windows (on the projector, the stream
// screen…) never load the control window's, so they start sooner and hold less.
const Control = lazyPart(() => import('./ControlApp').then((m) => m.Control));
const OutputView = lazyPart(() => import('./views/OutputView').then((m) => m.OutputView));
const MultiviewView = lazyPart(() => import('./views/MultiviewView').then((m) => m.MultiviewView));
const OverlayView = lazyPart(() => import('./views/OverlayView').then((m) => m.OverlayView));
const VisionView = lazyPart(() => import('./views/VisionView').then((m) => m.VisionView));
const TitlerWindow = lazyPart(() => import('./titler/LumoraTitler').then((m) => m.TitlerWindowView));

/** The Lumora Titler window (`?titler=<input or new>`, opened by "Titler…"). */
const isTitlerWindow = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('titler');

/**
 * Loads this window's part. Which window this is is known at once, so it
 * starts loading straight away; main.tsx draws the app when it is there (so
 * the first picture comes with no wait in between). Never fails: a part that
 * could not be loaded shows its error when drawn.
 */
export function loadApp(): Promise<void> {
  const part = isTitlerWindow()
    ? TitlerWindow
    : isVisionWorker()
      ? VisionView
      : overlayScreen()
        ? OverlayView
        : isMultiview()
          ? MultiviewView
          : outputScreen()
            ? OutputView
            : Control;
  return part.preload().then(
    () => {},
    () => {},
  );
}

export function App() {
  const output = useMemo(outputScreen, []);
  const multiview = useMemo(isMultiview, []);
  const overlay = useMemo(overlayScreen, []);
  const vision = useMemo(isVisionWorker, []);
  const titler = useMemo(isTitlerWindow, []);
  if (titler) return <TitlerWindow />;
  if (vision) return <VisionView />;
  if (overlay) return <OverlayView screen={overlay} />;
  if (multiview) return <MultiviewView />;
  return output ? <OutputView screen={output} /> : <Control />;
}
