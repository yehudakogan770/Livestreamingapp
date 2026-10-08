import { useMemo } from 'react';
import { isMultiview, isSeatWindow, outputScreen, overlayScreen } from './engine/role';
import { lazyPart } from './components/lazyPart';
import './App.css';

// Each window loads only its own part: the control window never loads the
// output view's code and the output windows (on the projector, the stream
// screen…) never load the control window's, so they start sooner and hold less.
const Control = lazyPart(() => import('./ControlApp').then((m) => m.Control));
const OutputView = lazyPart(() => import('./views/OutputView').then((m) => m.OutputView));
const MultiviewView = lazyPart(() => import('./views/MultiviewView').then((m) => m.MultiviewView));
const OverlayView = lazyPart(() => import('./views/OverlayView').then((m) => m.OverlayView));
const SeatWindow = lazyPart(() => import('./seats/SeatApp').then((m) => m.SeatWindow));

/**
 * Loads this window's part. Which window this is is known at once, so it
 * starts loading straight away; main.tsx draws the app when it is there (so
 * the first picture comes with no wait in between). Never fails: a part that
 * could not be loaded shows its error when drawn.
 */
export function loadApp(): Promise<void> {
  const part = overlayScreen() ? OverlayView : isMultiview() ? MultiviewView : outputScreen() ? OutputView : isSeatWindow() ? SeatWindow : Control;
  return part.preload().then(
    () => {},
    () => {},
  );
}

export function App() {
  const output = useMemo(outputScreen, []);
  const multiview = useMemo(isMultiview, []);
  const overlay = useMemo(overlayScreen, []);
  const seat = useMemo(isSeatWindow, []);
  if (overlay) return <OverlayView screen={overlay} />;
  if (seat) return <SeatWindow />;
  if (multiview) return <MultiviewView />;
  return output ? <OutputView screen={output} /> : <Control />;
}
