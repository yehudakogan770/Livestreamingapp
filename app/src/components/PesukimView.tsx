import type { ReactNode } from 'react';
import { barDesign, barLayout, barRange, glossesOf, shownText, soundAndMeaning, wordsOf, type PesukimData } from '../engine/pesukim';
import './PesukimView.css';

/**
 * A 12 Pesukim input as the audience sees it. Usually a bar along the bottom
 * (over the picture, or as an overlay): the words in Hebrew, how they sound
 * and what they mean, the word being said lit. Or the word big over a colour
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
  if (place.blank || !pasuk || (!he.length && !place.intro)) return null;
  const tr = wordsOf(pasuk.translit);
  const en = glossesOf(pasuk.english);
  const d = barDesign(look.design);
  const L = barLayout(look);
  const image = look.barImage && url ? url(look.barImage) : '';
  // No background: just the words, in two colours (an outline keeps them readable).
  const bare = !look.barImage && d.id === 'none';
  const [from, to] = barRange(data);
  const lit = (i: number) => (place.whole ? 'is-said' : i === place.word ? 'is-now' : i < place.word ? 'is-said' : '');
  const line = (words: string[], cls: string, size: number, dir: 'rtl' | 'ltr', font?: string) => (
    <div className={`pes__line ${cls}`} dir={dir} style={{ fontSize: `${size}cqh`, fontFamily: font }}>
      {words.slice(from, to).map((w, j) =>
        w ? (
          <span key={j} className={lit(from + j)} style={lit(from + j) === 'is-now' ? { color: look.textColor } : undefined}>
            {w}
          </span>
        ) : null,
      )}
    </div>
  );
  return (
    <div
      className={`pes__bar${d.frame ? ' pes__bar--frame' : ''}${bare ? ' pes__bar--bare' : ''}`}
      data-design={image ? 'picture' : d.id}
      style={{
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
      {!image && !bare && (
        <div className="pes__badge" style={{ background: d.badge, color: d.badgeText, width: `${L.badge}cqh`, height: `${L.badge}cqh` }}>
          {place.pasuk + 1}
        </div>
      )}
      <div className="pes__lines" key={`${place.pasuk}:${from}:${place.intro}`}>
        {place.intro ? (
          <Intro n={place.pasuk + 1} child={pasuk.child} big={7.2} />
        ) : (
          <>
            {line(he, 'pes__he', L.he, 'rtl', `"${look.font}", "Frank Ruhl Libre", serif`)}
            {look.showTranslit && tr.length > 0 && line(tr, 'pes__tr', L.tr, 'ltr')}
            {look.showEnglish && en.length > 0 && line(en, 'pes__en', L.en, 'ltr')}
          </>
        )}
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
