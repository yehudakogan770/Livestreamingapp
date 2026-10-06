import { Timecode } from './Timecode';
import { LogoMark } from '../components/Logo';
import { useEventFonts } from '../engine/fonts';
import { useEffect, useMemo, type ReactNode } from 'react';
import { dataValues } from '../engine/data';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createEngineClient, isInsideLumora, isSoundFile, type EngineClient } from '../engine/client';
import { useShow } from '../engine/useShow';
import { useNow } from '../engine/useNow';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { PreviewView, ProgramView } from '../components/ScreenView';
import { SourceView } from '../components/SourceView';
import { SafeBoundary } from '../components/SafeBoundary';
import { StageContext } from '../engine/CountdownContext';
import './MultiviewView.css';

/**
 * The multiview: every input and the screens at once, for the crew — with
 * names and red (on air) / green (next) tally. Nothing here is heard.
 */
export function MultiviewView() {
  const client = useMemo(createEngineClient, []);
  const { snapshot } = useShow(client);
  useEventFonts(snapshot?.show.event.brand.fonts, client);
  useEffect(() => {
    document.title = 'Lumora — Multiview';
    if (!isInsideLumora()) return;
    const w = getCurrentWindow();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void w.setFullscreen(false);
      if (e.key === 'F11') {
        e.preventDefault();
        void w.isFullscreen().then((f) => w.setFullscreen(!f));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggleFull = () => {
    if (!isInsideLumora()) return;
    const w = getCurrentWindow();
    void w.isFullscreen().then((f) => w.setFullscreen(!f));
  };
  const show = snapshot?.show;
  return (
    <div className="mv" onDoubleClick={toggleFull}>
      <SafeBoundary audience>
        <StageContext.Provider
          value={
            show
              ? {
                  event: show.event,
                  mediaUrl: (p) => client.mediaUrl(p),
                  sources: show.sources,
                  visuals: show.visuals,
                  data: dataValues(show.data),
                  screens: show.screens,
                }
              : null
          }
        >
          {show && <Multiview show={show} client={client} />}
        </StageContext.Provider>
      </SafeBoundary>
    </div>
  );
}

function Box({ label, tally, children, big = false }: { label: ReactNode; tally: 'pgm' | 'pvw' | null; children: ReactNode; big?: boolean }) {
  return (
    <div className={`mv__box${tally ? ` mv__box--${tally}` : ''}${big ? ' mv__box--big' : ''}`}>
      <div className="mv__pic">{children}</div>
      <div className="mv__label">{label}</div>
    </div>
  );
}

export function Multiview({ show, client }: { show: Show; client: EngineClient }) {
  const now = useNow(false, 1000);
  const layout = show.settings.multiview.layout;
  const live = show.screens.live;
  const back = show.screens.back;
  const onAir = new Map<string, string[]>();
  const next = new Set<string>();
  for (const [sc, name] of [
    [live, 'LIVE'],
    [back, 'BACK'],
  ] as const) {
    if (sc.program) onAir.set(sc.program, [...(onAir.get(sc.program) ?? []), name]);
    if (sc.preview && sc.preview !== sc.program) next.add(sc.preview);
  }
  const nameOf = (id: string | null) => (id ? (show.sources.find((s) => s.id === id)?.name ?? '') : 'nothing');
  const pictures = show.sources.filter((s) => s.kind.type !== 'microphone' && !(s.kind.type === 'video' && isSoundFile(s.kind.path)));
  const screens = layout === 'inputs' ? [] : layout === 'bothScreens' ? (['live', 'back'] as const) : (['live'] as const);
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const tile = (s: Source, i: number) => {
    const where = onAir.get(s.id);
    return (
      <Box
        key={s.id}
        tally={where ? 'pgm' : next.has(s.id) ? 'pvw' : null}
        label={
          <>
            <b>{i + 1}</b> {s.name}
            {where && <em className="mv__tag mv__tag--pgm">{where.join(' + ')}</em>}
            {!where && next.has(s.id) && <em className="mv__tag mv__tag--pvw">NEXT</em>}
          </>
        }
      >
        <SourceView source={s} client={client} report={false} audience />
      </Box>
    );
  };
  return (
    <div className={`mv__grid mv__grid--${layout}`}>
      <header className="mv__head">
        <LogoMark size={18} />
        <span>{show.event.name || 'Lumora'}</span>
        <span className="mv__sub">Multiview</span>
        {show.panic && <em className="mv__tag mv__tag--pgm">PANIC</em>}
        {live.blank && <em className="mv__tag mv__tag--pgm">LIVE BLANK</em>}
        {back.blank && <em className="mv__tag mv__tag--pgm">BACK BLANK</em>}
        <span className="mv__clock">{clock}</span>
      </header>
      {screens.length > 0 && (
        <div className={`mv__screens mv__screens--${screens.length}`}>
          {screens.map((sc) => (
            <div key={sc} className="mv__pair">
              <Box
                big
                tally="pvw"
                label={
                  <>
                    <em className="mv__tally">NEXT</em>
                    <b>{sc === 'live' ? 'LIVE' : 'BACK'}</b>
                    <span className="mv__name">{nameOf(show.screens[sc].preview)}</span>
                    <Timecode />
                  </>
                }
              >
                <PreviewView show={show} screen={sc} client={client} />
              </Box>
              <Box
                big
                tally="pgm"
                label={
                  <>
                    <em className="mv__tally">ON AIR</em>
                    <b>{sc === 'live' ? 'LIVE' : 'BACK'}</b>
                    <span className="mv__name">{nameOf(show.screens[sc].program)}</span>
                    <Timecode />
                  </>
                }
              >
                <ProgramView show={show} screen={sc} client={client} audience />
              </Box>
            </div>
          ))}
        </div>
      )}
      <div className="mv__inputs">{pictures.map(tile)}</div>
    </div>
  );
}
