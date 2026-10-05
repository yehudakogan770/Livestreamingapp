import { useLayoutEffect, useRef, type RefObject } from 'react';
import { sections } from '../engine/lyrics';
import type { Show } from '../engine/types/Show';
import type { TextSize } from '../engine/types/TextSize';
import { FLASH_MS, countdownFinished, countdownRemaining, fadeAmount, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { mainCountdown } from '../engine/countdowns';
import { clockTime, hasPlace, zmanimOn } from '../engine/zmanim';
import { PrompterView } from './PrompterView';
import './MonitorScreen.css';

const SIZE: Record<TextSize, number> = { s: 0.55, m: 0.75, l: 1, xl: 1.3 };

/**
 * Shrinks the text inside `box` until it fits without overflowing. The size
 * chosen by the operator is the largest it may be; long messages get smaller
 * instead of running into the clock.
 */
function useFitText(box: RefObject<HTMLDivElement | null>, text: HTMLDivElement | null, key: string) {
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || !text) return;
    const fit = () => {
      text.style.fontSize = '';
      const max = parseFloat(getComputedStyle(text).fontSize) || 16;
      // Leave a little room at the edges so text never touches the dividers.
      // Whatever else is in the box (a song's next lines) keeps its room.
      const others = [...b.children].reduce((h, c) => (c === text ? h : h + (c as HTMLElement).offsetHeight), 0);
      const fits = () => text.scrollHeight <= (b.clientHeight - others) * 0.92 && text.scrollWidth <= b.clientWidth + 1;
      if (fits() || b.clientHeight === 0) return;
      let lo = 6;
      let hi = max;
      for (let i = 0; i < 14 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2;
        text.style.fontSize = `${mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      text.style.fontSize = `${lo}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [box, text, key]);
}

/** The stage monitor: large, readable text for the people on stage. */
export function MonitorScreen({ show }: { show: Show }) {
  const sc = show.screens.monitor;
  const m = show.monitor;
  // The countdown on air (or else the first one); none if there is no countdown input.
  const mainId = mainCountdown(show);
  const main = show.sources.find((x) => x.id === mainId)?.kind;
  const c = main?.type === 'countdown' ? main.timer : null;
  const flashing = Date.now() - sc.flashAt < FLASH_MS;
  const now = useNow(flashing, c?.endsAt != null ? 100 : 500);

  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: !m.clock24h }).formatToParts(new Date(now));
  const time = parts
    .filter((x) => x.type !== 'dayPeriod')
    .map((x) => x.value)
    .join('')
    .trim();
  const period = parts.find((x) => x.type === 'dayPeriod')?.value;

  const left = c ? countdownRemaining(c, now) : 0;
  const done = c ? countdownFinished(c, now) : false;
  const urgent = !!c && c.endsAt !== null && left < 60_000;
  const timerText = !c ? '' : done && c.atZero.type === 'showText' ? c.endText : formatCountdown(left, c.format === 'auto' ? 'minSec' : c.format);

  // A song on air on the Live Screen: the singers see these words and what comes next.
  const songSrc = show.sources.find((x) => x.id === show.screens.live.program)?.kind;
  const song = (m.showLyrics ?? true) && songSrc?.type === 'lyrics' ? songSrc : null;
  const slides = song ? sections(song.text) : [];
  const message = m.messageOn && m.message ? m.message : song ? (song.blank ? '—' : (slides[song.current] ?? '')) : null;
  const nextLines = song && !(m.messageOn && m.message) ? slides[song.current + (song.blank ? 0 : 1)] : undefined;
  const msgBox = useRef<HTMLDivElement>(null);
  const msgText = useRef<HTMLDivElement | null>(null);
  useFitText(msgBox, msgText.current, `${message}|${nextLines ?? ''}|${m.textSize}|${m.layout}|${m.showClock}|${m.showTimer}`);
  const dark = Math.max(fadeAmount(sc.blank, sc.blankChangedAt, now, sc.blankFadeMs), fadeAmount(show.panic, show.panicChangedAt, now) * 0.6);
  const flash = now - sc.flashAt < FLASH_MS && Math.floor((now - sc.flashAt) / 300) % 2 === 0;

  const clock = m.showClock && (
    <div className="mscreen__cell mscreen__clock">
      <span className="mscreen__tag">TIME</span>
      <span className="mscreen__num">
        {time}
        {period && <small>{period}</small>}
      </span>
    </div>
  );
  const timer = m.showTimer && c && (
    <div className={`mscreen__cell mscreen__timer${urgent ? ' is-urgent' : ''}${c.endsAt === null ? ' is-paused' : ''}`}>
      <span className="mscreen__tag">{c.endsAt === null ? 'COUNTDOWN · WAITING' : 'TIME LEFT'}</span>
      <span className="mscreen__num">{timerText}</span>
    </div>
  );
  const msg = (
    <div ref={msgBox} className={`mscreen__msgbox${nextLines ? ' mscreen__msgbox--song' : ''}`}>
      <div ref={msgText} className="mscreen__message" style={{ ['--size' as string]: SIZE[m.textSize], whiteSpace: song ? 'pre-line' : undefined }}>
        {message ?? ''}
      </div>
      {nextLines && (
        <div className="mscreen__next" dir="auto">
          <span className="mscreen__tag">NEXT</span>
          {nextLines}
        </div>
      )}
    </div>
  );

  let body;
  if (m.layout === 'full') {
    body = message ? (
      <div className="mscreen__full">
        {msg}
        {(clock || timer) && (
          <div className="mscreen__strip">
            {clock}
            {timer}
          </div>
        )}
      </div>
    ) : (
      <div className="mscreen__full mscreen__full--idle">
        {clock}
        {timer}
      </div>
    );
  } else {
    body = (
      <div className={`mscreen__${m.layout}`}>
        <div className="mscreen__area">{msg}</div>
        {(clock || timer) && (
          <div className="mscreen__side">
            {clock}
            {timer}
          </div>
        )}
      </div>
    );
  }

  // Before Shabbos and Yom Tov: the last hour before candle lighting.
  const place = show.event.place;
  const candles = hasPlace(place) && place.warnMonitor ? zmanimOn(now, place).candles : null;
  const toCandles = candles === null ? null : candles - now;
  const shabbos =
    toCandles !== null && toCandles > -15 * 60_000 && toCandles <= 3_600_000 ? (
      <div className={`mscreen__shabbos${toCandles <= 10 * 60_000 ? ' is-urgent' : ''}`}>
        {toCandles > 0 ? `Candle lighting in ${Math.ceil(toCandles / 60_000)} min · ${clockTime(candles)}` : `Candle lighting was at ${clockTime(candles)}`}
      </div>
    ) : null;

  // The teleprompter takes the whole monitor (the Shabbos band and blanking still show).
  if (m.prompter?.on) body = <PrompterView p={m.prompter} />;

  return (
    <div className={`mscreen${flash ? ' mscreen--flash' : ''}${shabbos ? ' mscreen--shabbos' : ''}`} data-monitor>
      {shabbos}
      {body}
      {dark > 0 && <div className="mscreen__dark" style={{ opacity: dark }} />}
    </div>
  );
}
