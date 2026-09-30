import type { Place } from '../engine/types/Place';
import type { ZmanimCard } from '../engine/types/ZmanimCard';
import { useStage } from '../engine/CountdownContext';
import { useNow } from '../engine/useNow';
import { formatHebrew, formatHebrewHe } from '../engine/hebcal';
import { clockTime, countdownText, hasPlace, nextCandles, zmanimOn } from '../engine/zmanim';
import './ZmanimView.css';

/** The zmanim listed on the card (label, time). */
export function zmanimRows(z: ReturnType<typeof zmanimOn>): [string, number | null][] {
  return [
    ['Dawn (Alos)', z.alot],
    ['Sunrise', z.sunrise],
    ['Latest Shema', z.sofShema],
    ['Midday (Chatzos)', z.chatzot],
    ['Sunset', z.sunset],
    ['Nightfall', z.tzeit],
  ];
}

/** "Friday, September 11" */
export const civilDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/** The Hebrew date, the day's zmanim, the countdown to candle lighting. Mirrored in compositor.ts zmanim(). */
export function ZmanimView({ z: card, place: given }: { z: ZmanimCard; place?: Place }) {
  const stage = useStage();
  const place = given ?? stage?.event.place;
  const now = useNow(false, 1000);
  if (!hasPlace(place)) {
    return (
      <div className={`zm zm--${card.style}`} data-kind="zmanim">
        <p className="zm__none">Choose the event's city: Event → Zmanim and Shabbos…</p>
      </div>
    );
  }
  const z = zmanimOn(now, place);
  const next = nextCandles(now, place);
  const lit = z.candles !== null && now >= z.candles && now - z.candles < 3 * 3_600_000;
  const he = formatHebrewHe(z.hebrew);
  const en = formatHebrew(z.hebrew);
  if (card.style === 'bar') {
    const tail =
      z.candles !== null && now < z.candles
        ? `Candle lighting ${clockTime(z.candles)} · in ${countdownText(z.candles - now)}`
        : `Sunset ${clockTime(z.sunset)}`;
    return (
      <div className="zm zm--bar" data-kind="zmanim">
        <div className="zm__bar">
          <b dir="rtl">{he}</b>
          <span>
            {en} · {tail}
          </span>
        </div>
      </div>
    );
  }
  if (card.style === 'countdown') {
    return (
      <div className="zm zm--countdown" data-kind="zmanim">
        <p className="zm__he" dir="rtl">
          {he}
        </p>
        {lit ? (
          <p className="zm__big">Good Shabbos!</p>
        ) : next !== null ? (
          <>
            <p className="zm__label">Candle lighting in</p>
            <p className="zm__big">{countdownText(next - now)}</p>
            <p className="zm__sub">
              {new Date(next).toLocaleDateString('en-US', { weekday: 'long' })} {clockTime(next)} · {place.name}
            </p>
          </>
        ) : (
          <p className="zm__sub">No candle lighting this week</p>
        )}
      </div>
    );
  }
  return (
    <div className="zm zm--card" data-kind="zmanim">
      <p className="zm__he" dir="rtl">
        {he}
      </p>
      <p className="zm__en">
        {en} · {civilDate(now)}
      </p>
      {z.special.length > 0 && <p className="zm__special">{z.special.join(' · ')}</p>}
      <div className="zm__grid">
        {zmanimRows(z).map(([label, t]) => (
          <div key={label} className="zm__row">
            <span>{label}</span>
            <b>{clockTime(t)}</b>
          </div>
        ))}
      </div>
      {z.candles !== null && (
        <div className="zm__candles">
          <span>🕯 Candle lighting</span>
          <b>{clockTime(z.candles)}</b>
          {now < z.candles && <em>in {countdownText(z.candles - now)}</em>}
        </div>
      )}
      <p className="zm__place">{place.name}</p>
    </div>
  );
}
