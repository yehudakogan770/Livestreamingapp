// The one-click offer of native playback (beta) on a capable graphics card.
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Zap } from 'lucide-react';
import type { Facts } from '../../../../app/src/syscheck/rules';
import { inApp } from '../native';
import { nativePlayback } from '../render/native/client';
import { markOffered, mayOffer, nativeOffer } from '../render/native/suggest';

const store = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

export function NativeOffer() {
  const [gpu, setGpu] = useState<string | null>(null);
  useEffect(() => {
    if (!inApp() || !mayOffer(nativePlayback.chosen, store())) return;
    let stale = false;
    // Asked once the editor has settled (looking at the computer takes a moment).
    const t = window.setTimeout(() => {
      void invoke<Facts>('system_facts')
        .then((f) => {
          if (!stale && mayOffer(nativePlayback.chosen, store())) setGpu(nativeOffer(f));
        })
        .catch(() => undefined);
    }, 8000);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, []);
  if (!gpu) return null;
  const answer = (on: boolean) => {
    markOffered(store());
    if (on) nativePlayback.setEnabled(true);
    setGpu(null);
  };
  return (
    <div className="lockbar is-mine" role="status">
      <Zap />
      Smoother playback of big projects: your graphics card ({gpu}) can draw the viewer with the native GPU engine (beta).
      <button type="button" className="linkbtn" onClick={() => answer(true)}>
        Turn it on
      </button>
      <button type="button" className="linkbtn" onClick={() => answer(false)}>
        Not now
      </button>
      <span className="lockbar__wait">(It can be turned off any time with the GPU light on the viewer.)</span>
    </div>
  );
}
