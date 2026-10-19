p='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/views/SwitchPanel.tsx'
s=open(p).read()
s=s.replace("""import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';""","""import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Aperture,
  Blend,
  ChevronDown,
  Columns2,
  Diamond,
  Film,
  Merge,
  Moon,
  PanelLeftOpen,
  PanelRightOpen,
  Scissors,
  SlidersHorizontal,
  Sparkle,
  SunDim,
  Waves,
  Zap,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { OVERLAY_KINDS } from '../engine/overlays';
import { isSoundFile } from '../engine/client';
import { screenInputs } from '../engine/screenInputs';
import type { ScreenId } from '../engine/types/ScreenId';""")
s=s.replace("""/** The ones with their own button; the rest are under "More". */""","""/** A small line glyph for each kind of transition. */
export function transitionIcon(kind: TransitionKind): LucideIcon {
  if (kind === 'cut') return Scissors;
  if (kind === 'fade') return Blend;
  if (kind === 'merge') return Merge;
  if (kind === 'dip') return SunDim;
  if (kind === 'flash') return Zap;
  if (kind === 'blur') return Waves;
  if (kind === 'zoom') return ZoomIn;
  if (kind === 'zoomOut') return ZoomOut;
  if (kind === 'iris') return Aperture;
  if (kind === 'diamond') return Diamond;
  if (kind === 'split' || kind === 'splitVertical') return Columns2;
  if (kind === 'cover') return PanelLeftOpen;
  if (kind === 'reveal') return PanelRightOpen;
  if (kind === 'stinger1' || kind === 'stinger2') return Film;
  if (kind.startsWith('luma')) return Sparkle;
  if (kind === 'wipeLeft') return ArrowLeft;
  if (kind === 'wipeDown' || kind === 'slideDown') return ArrowDown;
  if (kind === 'wipeUp' || kind === 'slideUp') return ArrowUp;
  return ArrowRight;
}

/** The ones with their own button; the rest are under "More". */""")
s=s.replace("""        <button key={k.kind} type="button" role="radio" aria-checked={value === k.kind} className="seg" onClick={() => onPick(k.kind)}>
          {k.name}
        </button>""","""        <button key={k.kind} type="button" role="radio" aria-checked={value === k.kind} className="seg" onClick={() => onPick(k.kind)}>
          <TransitionGlyph kind={k.kind} />
          {k.name}
        </button>""")
a=s.index("""  return (
    <div className="switch">""")
b=s.index("""export const transitionName""")
new="""  const Glyph = transitionIcon(t.kind);
  return (
    <div className="switch">
      <div className="phead switch__head">
        <SlidersHorizontal aria-hidden="true" />
        <span className="phead__title">Switcher</span>
        <span className="phead__meta">{screen === 'live' ? 'LIVE' : screen === 'back' ? 'BACK' : 'MON'}</span>
      </div>
      <div className="switch__body">
        <Buses show={show} screen={screen} act={act} />
        <div className="switch__keys">
          <button
            type="button"
            className="switch__cut"
            disabled={!hasPreview}
            onClick={() => act({ type: 'take', screen, transition: 'cut' })}
            title="Send preview to air instantly (Shift+Enter)"
          >
            CUT
          </button>
          <button
            type="button"
            className="switch__take"
            disabled={!hasPreview}
            onClick={() => act({ type: 'take', screen })}
            title="Send preview to air with the chosen transition (Enter)"
          >
            TAKE <span>{transitionName(t)}</span>
          </button>
        </div>
        <div className="switch__row" ref={box}>
          <button
            type="button"
            className={`btn switch__trans${open ? ' is-on' : ''}`}
            aria-expanded={open}
            aria-label="Transition"
            title="Choose the transition and its length"
            onClick={() => setOpen(!open)}
          >
            <Glyph aria-hidden="true" />
            <span>{transitionName(t)}</span>
            <ChevronDown className="switch__caret" aria-hidden="true" />
          </button>
          <FadeToBlack show={show} screen={screen} act={act} />
          {open && (
            <div className="switch__pop" role="dialog" aria-label="Transition choices" style={at}>
              <span className="switch__label">Transition</span>
              <KindPicker label="Transition" value={t.kind} onPick={(kind) => act({ type: 'setTransition', kind })} onStingers={onStingers} />
              <span className="switch__label">Length</span>
              <div className="switch__durations" role="radiogroup" aria-label="Transition length">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={t.durationMs === d}
                    className="seg seg--small"
                    disabled={t.kind === 'cut'}
                    onClick={() => act({ type: 'setTransition', durationMs: d })}
                  >
                    {secs(d)}
                  </button>
                ))}
              </div>
              <FavouritesEditor show={show} act={act} />
              <FadeLength show={show} act={act} />
            </div>
          )}
        </div>
        <TBar show={show} screen={screen} act={act} disabled={!hasPreview} />
        <Favourites show={show} screen={screen} act={act} disabled={!hasPreview} />
      </div>
    </div>
  );
}

function TransitionGlyph({ kind }: { kind: TransitionKind }) {
  const G = transitionIcon(kind);
  return <G className="glyph" aria-hidden="true" />;
}

/** Key-cap names for the bus keys (brackets of placeholders dropped). */
const capName = (name: string) => name.replace(/[[\\]]/g, '').trim();

/**
 * The program and preview buses, as on a hardware switcher: one key per
 * picture input. A Program key cuts it straight to air; a Preview key lines
 * it up in Next. Names and titles (overlays) and sound-only inputs are not here.
 */
function Buses({ show, screen, act }: { show: Show; screen: ScreenId; act: Act }) {
  const sc = show.screens[screen];
  const keys = screenInputs(show, screen)
    .map((src, i) => ({ src, n: i + 1 }))
    .filter(({ src }) => !OVERLAY_KINDS.has(src.kind.type) && src.kind.type !== 'microphone' && !(src.kind.type === 'video' && isSoundFile(src.kind.path)));
  if (keys.length === 0) return null;
  const row = (bus: 'pgm' | 'pvw') => (
    <div className={`bus__row bus__row--${bus}`} role="group" aria-label={bus === 'pgm' ? 'Program bus' : 'Preview bus'}>
      <span className="bus__label">{bus === 'pgm' ? 'PGM' : 'PVW'}</span>
      <div className="bus__keys">
        {keys.map(({ src, n }) => {
          const on = (bus === 'pgm' ? sc.program : sc.preview) === src.id;
          return (
            <button
              key={src.id}
              type="button"
              className={`bus__key${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={`${bus === 'pgm' ? 'Program' : 'Preview'} ${n}: ${src.name}`}
              title={`${n} · ${src.name}: ${bus === 'pgm' ? 'cut straight to air' : 'line up in Next'}`}
              onClick={() => act(bus === 'pgm' ? { type: 'cutTo', screen, sourceId: src.id } : { type: 'setPreview', screen, sourceId: src.id })}
            >
              <b>{n}</b>
              <small>{capName(src.name)}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="bus" role="group" aria-label="Program and preview buses">
      {row('pgm')}
      {row('pvw')}
    </div>
  );
}

"""
s=s[:a]+new+s[b:]
s=s.replace("""          onClick={() => act({ type: 'take', screen, transition: t.kind, durationMs: t.durationMs })}
        >
          {KINDS.find((k) => k.kind === t.kind)?.name ?? t.kind}""","""          onClick={() => act({ type: 'take', screen, transition: t.kind, durationMs: t.durationMs })}
        >
          <TransitionGlyph kind={t.kind} />
          {KINDS.find((k) => k.kind === t.kind)?.name ?? t.kind}""")
s=s.replace("""      title={black ? 'Fade back up from black' : `Fade this screen slowly to black (${secs(show.settings.fadeToBlackMs)})`}
    >
      {black ? 'Fade back up' : 'Fade to black'}""","""      title={black ? 'Fade back up from black' : `Fade this screen slowly to black (${secs(show.settings.fadeToBlackMs)})`}
    >
      <Moon aria-hidden="true" />
      {black ? 'Fade back up' : 'Fade to black'}""")
open(p,'w').write(s)
