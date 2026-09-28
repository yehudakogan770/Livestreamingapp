import type { ReactNode } from 'react';
import { shownText, wordsOf, type PesukimData } from '../engine/pesukim';
import './PesukimView.css';

/**
 * A 12 Pesukim input as the audience sees it: the word being said, big,
 * over a colour (or a camera, passed in as `behind`), with the child's name
 * and, in strip mode, the whole pasuk along the bottom.
 */
export function PesukimView({ data, behind }: { data: PesukimData; behind?: ReactNode }) {
  const { look, place } = data;
  const pasuk = data.pesukim[place.pasuk];
  const words = wordsOf(pasuk?.text ?? '');
  const { text, whole } = shownText(data);
  const strip = look.mode === 'strip' && !place.whole && !place.blank && words.length > 0;
  const size = whole ? look.size * 0.42 : look.size;
  return (
    <div className="pes" style={{ background: look.background }} data-kind="pesukim">
      {behind && <div className="pes__behind">{behind}</div>}
      {look.showName && pasuk?.child && !place.blank && (
        <div className="pes__name">
          Pasuk {place.pasuk + 1} · {pasuk.child}
        </div>
      )}
      {text && (
        <div className="pes__words" style={{ bottom: strip ? '20cqh' : 0 }}>
          {/* Keyed by the word so each new word makes its entrance. */}
          <div
            key={`${place.pasuk}:${place.word}:${whole}`}
            className={`pes__text pes__text--${look.wordChange}`}
            dir="auto"
            style={{ fontFamily: `"${look.font}", "Frank Ruhl Libre", serif`, color: look.textColor, fontSize: `${size}cqh` }}
            data-pesukim-text
          >
            {text}
          </div>
        </div>
      )}
      {strip && (
        <div className="pes__strip" dir="rtl" style={{ borderTopColor: look.textColor, fontFamily: `"${look.font}", "Frank Ruhl Libre", serif` }}>
          {words.map((w, i) => (
            <span
              key={i}
              className={i < place.word ? 'is-said' : i === place.word ? 'is-now' : ''}
              style={i === place.word ? { color: look.textColor } : undefined}
            >
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
