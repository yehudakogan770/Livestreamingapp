import { useRef, type ReactNode } from 'react';
import { effectAt, effectStyle, STILL, useEffectClock, WORD_OUT_MS, WORD_SPEED, wordEffect } from '../engine/effects';
import { barDesign, barLayout, barRange, glossesOf, shownText, soundAndMeaning, wordsOf, type PesukimData } from '../engine/pesukim';
import './PesukimView.css';

/**
 * A 12 Pesukim input as the audience sees it. Usually a bar along the bottom
 * (over the picture, or as an overlay): the words in Hebrew, how they sound
 * and what they mean, the word being said lit. Or the word big over a color
 * (or a camera, passed in as `behind`). The child's name comes up before
 * their pasuk. Mirrored in compositor.ts pesukim().
 */
export function PesukimView({ data, behind, url }: { data: PesukimData; behind?: ReactNode; url?: (path: string) => string }) {
  const { look, place } = data;
  const bar = look.mode === 'bar';
  return (
    <div className="pes" style={bar ? undefined : { background: look.background }} data-kind="pesukim">
      {behind && <div className="pes__behind">{behind}</div>}
      {bar ? <PesukimBar data={data} url={url} /> : <PesukimBig data={data} />}
    </div>
  );
}

function Intro({ n, child, big }: { n: number; child: string; big: number }) {
  return (
    <div className="pes__intro" data-pesukim-intro>
      <div className="pes__intro-n" style={{ fontSize: `${big * 0.45}cqh` }}>
        Pasuk {n}
      </div>
      <div className="pes__intro-name" style={{ fontSize: `${big}cqh` }}>
        {child}
      </div>
    </div>
  );
}

function PesukimBar({ data, url }: { data: PesukimData; url?: (path: string) => string }) {
  const { look, place } = data;
  const pasuk = data.pesukim[place.pasuk];
  const he = wordsOf(pasuk?.text ?? '');
  const [from, to] = barRange(data);
  // How the bar comes on (when it is first shown), and each new word. With
  // the whole line showing, only a new line comes on (the lit word just moves).
  const barFx = effectAt(look.barIn ?? 'rise', useEffectClock(look.barIn ?? 'rise'));
  const wordKind = wordEffect(look.wordChange);
  const wordLetters = [...(he[place.word] ?? '')].length || 6;
  const oneWord = look.barWords !== 'line' && !place.whole;
  const key = `${place.pasuk}:${oneWord ? place.word : from}:${place.intro}:${place.whole}`;
  const clock = useEffectClock(wordKind, wordLetters, key, WORD_SPEED);
  const wordFx = effectAt(wordKind, clock, wordLetters);
  // What was showing before: it fades away while the new one comes on (no blink).
  const last = useRef<{ key: string; place: PesukimData['place'] } | null>(null);
  const before = useRef<{ key: string; place: PesukimData['place'] } | null>(null);
  if (last.current && last.current.key !== key) before.current = last.current;
  last.current = { key, place };
  const outAlpha = before.current && wordKind !== 'none' ? Math.max(0, 1 - (clock * WORD_SPEED) / WORD_OUT_MS) : 0;
  // Hide fades the bar out (and back in): it stays drawn, see-through.
  if (!pasuk || (!he.length && !place.intro)) return null;
  const d = barDesign(look.design);
  const L = barLayout(look);
  const image = look.barImage && url && !look.plain ? url(look.barImage) : '';
  // No background: just the words, in two colors (an outline keeps them readable).
  const bare = look.plain || (!look.barImage && d.id === 'none');

  /** The lines for a moment of the pasuk (now, or the one going away). */
  const lines = (pl: PesukimData['place']) => {
    const ps = data.pesukim[pl.pasuk];
    if (!ps) return null;
    if (pl.intro) return <Intro n={pl.pasuk + 1} child={ps.child} big={7.2} />;
    const [a, z] = barRange({ ...data, place: pl });
    const lit = (i: number) => (pl.whole ? 'is-said' : i === pl.word ? 'is-now' : i < pl.word ? 'is-said' : '');
    const line = (words: string[], cls: string, size: number, dir: 'rtl' | 'ltr', font?: string) => (
      <div className={`pes__line ${cls}`} dir={dir} style={{ fontSize: `${size}cqh`, fontFamily: font }}>
        {words.slice(a, z).map((w, j) =>
          w ? (
            <span key={j} className={lit(a + j)} style={lit(a + j) === 'is-now' ? { color: look.textColor } : undefined}>
              {w}
            </span>
          ) : null,
        )}
      </div>
    );
    const tr = wordsOf(ps.translit);
    const en = glossesOf(ps.english);
    // How it sounds and the Hebrew side by side; the English under them.
    return (
      <>
        <div className="pes__pair">
          {look.showTranslit && tr.length > 0 && line(tr, 'pes__tr', L.tr, 'ltr')}
          {line(wordsOf(ps.text), 'pes__he', L.he, 'rtl', `"${look.font}", "Frank Ruhl Libre", serif`)}
        </div>
        {look.showEnglish && en.length > 0 && line(en, 'pes__en', L.en, 'ltr')}
      </>
    );
  };

  return (
    <div
      className={`pes__bar${d.frame ? ' pes__bar--frame' : ''}${bare ? ' pes__bar--bare' : ''}${look.showNumber && !bare && !image ? ' pes__bar--num' : ''}`}
      data-design={image ? 'picture' : d.id}
      data-hidden={place.blank || undefined}
      style={{
        ...effectStyle(barFx),
        ...(place.blank ? { opacity: 0 } : {}),
        transition: barFx === STILL ? 'opacity 0.35s ease' : 'none',
        left: `${L.left}cqh`,
        right: `${L.right}cqh`,
        bottom: `${L.bottom}cqh`,
        height: `${L.h}cqh`,
        borderRadius: `${d.radius}cqh`,
        borderColor: d.edge,
        background: image ? `center / 100% 100% no-repeat url("${image}")` : bare ? 'none' : `linear-gradient(${d.top}, ${d.bottom})`,
        ['--pes-outline' as string]: look.outlineColor,
      }}
    >
      {!image && !bare && look.showNumber && (
        <div className="pes__badge" style={{ background: d.badge, color: d.badgeText, width: `${L.badge}cqh`, height: `${L.badge}cqh` }}>
          {place.pasuk + 1}
        </div>
      )}
      <div className="pes__lines">
        <div className="pes__stack">
          {outAlpha > 0 && before.current && (
            <div className="pes__in pes__in--out" style={{ opacity: outAlpha }} aria-hidden>
              {lines(before.current.place)}
            </div>
          )}
          <div className="pes__in" style={effectStyle(wordFx, true)}>
            {lines(place)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PesukimBig({ data }: { data: PesukimData }) {
  const { look, place } = data;
  const pasuk = data.pesukim[place.pasuk];
  const words = wordsOf(pasuk?.text ?? '');
  const { text, whole } = shownText(data);
  const strip = look.mode === 'strip' && !place.whole && !place.blank && !place.intro && words.length > 0;
  const size = whole ? look.size * 0.42 : look.size;
  const said = soundAndMeaning(data, whole);
  const tr = look.showTranslit ? said.sound : '';
  const en = look.showEnglish ? said.meaning : '';
  // The whole pasuk's lines are longer: smaller.
  const small = whole ? 0.5 : 1;
  if (place.intro && pasuk && !place.blank) {
    return (
      <div className="pes__words" style={{ bottom: 0, color: look.textColor }}>
        <Intro n={place.pasuk + 1} child={pasuk.child} big={look.size * 0.6} />
      </div>
    );
  }
  return (
    <>
      {text && (
        <div className="pes__words" style={{ bottom: strip ? '20cqh' : 0 }}>
          {/* Keyed by the word so each new word makes its entrance. */}
          <div key={`${place.pasuk}:${place.word}:${whole}`} className={`pes__text pes__text--${look.wordChange}`}>
            <div
              dir="auto"
              style={{ fontFamily: `"${look.font}", "Frank Ruhl Libre", serif`, color: look.textColor, fontSize: `${size}cqh` }}
              data-pesukim-text
            >
              {text}
            </div>
            {tr && (
              <div className="pes__big-tr" style={{ fontSize: `${look.size * 0.3 * small}cqh` }}>
                {tr}
              </div>
            )}
            {en && (
              <div className="pes__big-en" style={{ fontSize: `${look.size * 0.24 * small}cqh` }}>
                {en}
              </div>
            )}
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
    </>
  );
}
