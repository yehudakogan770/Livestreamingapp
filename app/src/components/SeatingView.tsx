import type { Seating } from '../engine/types/Seating';
import { COLUMNS, pageAt, pages, ROWS } from '../engine/seating';
import { useNow } from '../engine/useNow';
import { useStage } from '../engine/CountdownContext';
import { joinShown, takesTurns } from '../engine/join';
import './SeatingView.css';
import { QrImage } from './QrImage';

/** The table finder on screen: the code to scan, or the list a page at a time. Mirrored in compositor.ts seating(). */
export function SeatingView({ s, thumb = false }: { s: Seating; thumb?: boolean }) {
  const wifi = useStage()?.event.wifi;
  const turns = s.look === 'scan' ? takesTurns(s.joinUrl, wifi) : pages(s) > 1;
  const now = useNow(false, turns && !thumb ? 1000 : 60_000);
  if (s.look === 'list') {
    const { page, guests } = pageAt(s, thumb ? 0 : now);
    const cols = Array.from({ length: COLUMNS }, (_, c) => guests.slice(c * ROWS, (c + 1) * ROWS));
    return (
      <div className="seat" data-kind="seating">
        <h2 className="seat__title" dir="auto">
          {s.title}
        </h2>
        <div className="seat__cols">
          {cols.map((col, c) => (
            <ul key={c}>
              {col.map((g, i) => (
                <li key={i}>
                  <span dir="auto">{g.name}</span>
                  <b>{g.table}</b>
                </li>
              ))}
            </ul>
          ))}
        </div>
        {pages(s) > 1 && (
          <p className="seat__page">
            Page {page + 1} of {pages(s)}
          </p>
        )}
      </div>
    );
  }
  const j = joinShown(s.joinUrl, s.joinQr, 'Scan and type your name', wifi, now);
  return (
    <div className="seat seat--scan" data-kind="seating">
      <h2 className="seat__title" dir="auto">
        {s.title}
      </h2>
      {s.showJoin && s.open && s.joinQr && !thumb ? (
        <div className="seat__join">
          <QrImage className="seat__qr" svg={j.qr} />
          <b>{j.label}</b>
          <small>{j.sub}</small>
        </div>
      ) : (
        <p className="seat__soon">{s.guests.length} guests</p>
      )}
    </div>
  );
}
