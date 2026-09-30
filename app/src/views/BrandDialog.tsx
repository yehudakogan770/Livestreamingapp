import { useEffect, useState, type ReactNode } from 'react';
import type { EngineClient } from '../engine/client';
import type { Brand } from '../engine/types/Brand';
import type { Show } from '../engine/types/Show';
import { branded, cleanBrand, defaultBrand, LOOKS } from '../engine/brand';
import { ACCENTS, defaultTextStyle, TEXT_DESIGNS } from '../engine/text';
import { FontPicker } from '../components/FontPicker';
import { EFFECTS } from '../engine/effects';
import { fontNameFrom } from '../engine/fonts';
import { TextView } from '../components/TextView';
import './BrandDialog.css';

type Tab = 'looks' | 'words' | 'box' | 'place' | 'fonts';
const TABS: [Tab, string][] = [
  ['looks', 'Ready-made'],
  ['words', 'Words'],
  ['box', 'Box'],
  ['place', 'Place & motion'],
  ['fonts', 'Fonts'],
];
const WEIGHTS: [number, string][] = [
  [300, 'Light'],
  [400, 'Normal'],
  [600, 'Semi-bold'],
  [700, 'Bold'],
  [900, 'Black'],
];
/** Quick places for name titles: side %, bottom %, alignment. */
const SPOTS: { name: string; x: number; y: number; align: Brand['align'] }[] = [
  { name: 'Bottom left', x: 5, y: 10, align: 'left' },
  { name: 'Bottom centre', x: 5, y: 8, align: 'center' },
  { name: 'Bottom right', x: 5, y: 10, align: 'right' },
  { name: 'Top left', x: 5, y: 78, align: 'left' },
  { name: 'Top right', x: 5, y: 78, align: 'right' },
];

/** The event's look: every setting of every title, song and scoreboard, in one place. */
export function BrandDialog({ show, client, onClose }: { show: Show; client: EngineClient; onClose: () => void }) {
  const [b, setB] = useState<Brand>(() => ({ ...defaultBrand(), ...show.event.brand }));
  const [tab, setTab] = useState<Tab>('looks');
  const [replay, setReplay] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const set = (p: Partial<Brand>) => {
    setB((x) => ({ ...x, ...p }));
    // Moving things: show it coming in again.
    if ('entrance' in p || 'animate' in p) setReplay((n) => n + 1);
  };
  const titles = show.sources.filter((s) => s.kind.type === 'text' || s.kind.type === 'lyrics' || s.kind.type === 'scoreboard').length;
  const sample = (look: Brand, animate = false) => ({
    layout: 'lowerThird' as const,
    text: show.event.name || 'Speaker name',
    sub: 'Title or role',
    style: branded({ ...defaultTextStyle(), animate }, look),
  });
  const apply = () =>
    void client
      .dispatch({ type: 'applyBrand', brand: cleanBrand(b) })
      .then(onClose)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  const addFont = async () => {
    const picked = await client.pickFiles('font');
    const added = picked.map((f) => ({ name: fontNameFrom(f.name || f.path), path: f.path })).filter((f) => f.name);
    if (added.length) set({ fonts: [...b.fonts.filter((f) => !added.some((a) => a.name === f.name)), ...added], font: added[0]!.name });
  };

  const color = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="brd__color">
      <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      {label}
    </label>
  );
  const slider = (label: string, value: number, min: number, max: number, onChange: (v: number) => void, shown = String(value), step = 1) => (
    <label className="brd__slider">
      <span>
        {label} <em>{shown}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
  const segs = <T extends string | number>(items: [T, string][], value: T, onPick: (v: T) => void, label: string) => (
    <div className="seg-group" role="group" aria-label={label}>
      {items.map(([v, name]) => (
        <button key={String(v)} type="button" className={`seg${value === v ? ' is-on' : ''}`} aria-pressed={value === v} onClick={() => onPick(v)}>
          {name}
        </button>
      ))}
    </div>
  );
  const fontSelect = (value: string, onChange: (v: string) => void, label: string, same?: string) => (
    <FontPicker value={value} onChange={onChange} label={label} sameLabel={same} added={b.fonts.map((f) => f.name)} />
  );

  let body: ReactNode;
  if (tab === 'looks') {
    body = (
      <div className="brd__looks">
        {LOOKS.map((l) => {
          const look = { ...defaultBrand(), ...l.look, fonts: b.fonts };
          return (
            <button key={l.name} type="button" className="brd__look" onClick={() => set({ ...look })} title={`Use “${l.name}” (then change anything)`}>
              <span className="brd__mini">
                <TextView t={sample(look)} />
              </span>
              {l.name}
            </button>
          );
        })}
      </div>
    );
  } else if (tab === 'words') {
    body = (
      <div className="brd__grid">
        <label className="field">
          <span className="field__label">Font</span>
          {fontSelect(b.font, (font) => set({ font }), 'Font')}
        </label>
        {slider('Size (name titles)', b.size, 24, 140, (size) => set({ size }))}
        <div className="field">
          <span className="field__label">Thickness</span>
          {segs(WEIGHTS, b.weight, (weight) => set({ weight }), 'Thickness')}
        </div>
        <div className="brd__row">
          {color('Words', b.textColor, (textColor) => set({ textColor }))}
          <label className="check">
            <input type="checkbox" checked={b.italic} onChange={(e) => set({ italic: e.target.checked })} /> <i>Italic</i>
          </label>
          <label className="check">
            <input type="checkbox" checked={b.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} /> CAPITALS
          </label>
          <label className="check">
            <input type="checkbox" checked={b.shadow} onChange={(e) => set({ shadow: e.target.checked })} /> Shadow
          </label>
        </div>
        <div className="brd__row">
          {slider('Outline', b.outline, 0, 12, (outline) => set({ outline }), b.outline ? `${b.outline}` : 'none')}
          {color('Outline', b.outlineColor, (outlineColor) => set({ outlineColor }))}
        </div>
        {slider('Letter spacing', b.letterSpacing, -4, 20, (letterSpacing) => set({ letterSpacing }))}
        {slider('Line spacing', b.lineHeight, 90, 180, (lineHeight) => set({ lineHeight }), `${b.lineHeight}%`, 5)}
        <span className="field__label brd__wide">Second line (title or role)</span>
        {slider('Size', b.subSize, 30, 120, (subSize) => set({ subSize }), `${b.subSize}%`, 5)}
        <div className="brd__row">
          <label className="check">
            <input type="checkbox" checked={!!b.subColor} onChange={(e) => set({ subColor: e.target.checked ? b.accent : '' })} /> Own colour
          </label>
          {b.subColor && color('Colour', b.subColor, (subColor) => set({ subColor }))}
          {fontSelect(b.subFont, (subFont) => set({ subFont }), 'Second line font', 'Same font')}
        </div>
      </div>
    );
  } else if (tab === 'box') {
    body = (
      <div className="brd__grid">
        <div className="field brd__wide">
          <span className="field__label">Design</span>
          <div className="seg-group">
            {TEXT_DESIGNS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`seg${b.design === d.id ? ' is-on' : ''}`}
                aria-pressed={b.design === d.id}
                title={d.hint}
                onClick={() => set({ design: d.id })}
              >
                {d.name}
              </button>
            ))}
          </div>
        </div>
        <div className="brd__row">
          <label className="check">
            <input type="checkbox" checked={b.boxOn} onChange={(e) => set({ boxOn: e.target.checked })} /> A box behind the words
          </label>
          {color('Box', b.boxColor, (boxColor) => set({ boxColor }))}
        </div>
        {slider('See-through', 100 - b.boxOpacity, 0, 100, (v) => set({ boxOpacity: 100 - v }), `${100 - b.boxOpacity}%`)}
        <div className="brd__row brd__wide">
          <span className="field__label">Accent</span>
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              className={`brd__dot${b.accent === c ? ' is-on' : ''}`}
              style={{ background: c }}
              aria-label={`Accent ${c}`}
              aria-pressed={b.accent === c}
              onClick={() => set({ accent: c })}
            />
          ))}
          {color('Other', b.accent, (accent) => set({ accent }))}
        </div>
        {slider('Rounded corners', b.radius, 0, 60, (radius) => set({ radius }))}
        {slider('Room around the words', b.padding, 0, 80, (padding) => set({ padding }))}
        <div className="brd__row">
          {slider('Border', b.border, 0, 12, (border) => set({ border }), b.border ? `${b.border}` : 'none')}
          {color('Border', b.borderColor, (borderColor) => set({ borderColor }))}
        </div>
      </div>
    );
  } else if (tab === 'place') {
    body = (
      <div className="brd__grid">
        <div className="field brd__wide">
          <span className="field__label">Where name titles go</span>
          <div className="seg-group">
            {SPOTS.map((p) => {
              const on = b.x === p.x && b.y === p.y && b.align === p.align;
              return (
                <button
                  key={p.name}
                  type="button"
                  className={`seg${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => set({ x: p.x, y: p.y, align: p.align })}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <span className="field__label">Line up</span>
          {segs<Brand['align']>(
            [
              ['left', 'Left'],
              ['center', 'Centre'],
              ['right', 'Right'],
            ],
            b.align,
            (align) => set({ align }),
            'Line up',
          )}
        </div>
        {slider('From the side', b.x, 0, 45, (x) => set({ x }), `${b.x}%`)}
        {slider('From the bottom', b.y, 0, 90, (y) => set({ y }), `${b.y}%`)}
        <div className="field brd__wide">
          <span className="field__label">How it comes on</span>
          <div className="brd__row">
            <label className="check">
              <input type="checkbox" checked={b.animate} onChange={(e) => set({ animate: e.target.checked })} /> Animate
            </label>
            {b.animate && segs(EFFECTS, b.entrance, (entrance) => set({ entrance }), 'Entrance')}
            <button type="button" className="btn btn--small" onClick={() => setReplay((n) => n + 1)} disabled={!b.animate}>
              ▶ Show me
            </button>
          </div>
        </div>
        <p className="field__note brd__wide">
          Place and size are for name titles (lower thirds); big titles and tickers keep their own, and take everything else.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="brd__grid">
        <div className="field brd__wide">
          <span className="field__label">Fonts added for this event</span>
          {b.fonts.length === 0 && (
            <span className="field__note">None yet. Add a font file (TTF, OTF or WOFF) — for example the event’s own branding font.</span>
          )}
          <div className="brd__fonts">
            {b.fonts.map((f) => (
              <span key={f.name} className="brd__font">
                <button
                  type="button"
                  className={`btn${b.font === f.name ? ' is-on' : ''}`}
                  style={{ fontFamily: `"${f.name}"` }}
                  onClick={() => set({ font: f.name })}
                >
                  {f.name}
                </button>
                <button type="button" className="btn" aria-label={`Remove ${f.name}`} onClick={() => set({ fonts: b.fonts.filter((x) => x.name !== f.name) })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="brd__row">
            <button type="button" className="btn btn--primary" onClick={() => void addFont()}>
              Add a font file…
            </button>
            <span className="field__note">They are kept with the event and work on every screen and in the recording.</span>
          </div>
        </div>
        <p className="field__note brd__wide">
          Hundreds of fonts are built in (Words → Font). Any font installed on this computer works too: type its name in the font search and choose “Use …”.
        </p>
      </div>
    );
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Event look" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box brd">
        <header className="modal__head">
          <h2>Event look</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="brd__body">
          <div className="brd__stage">
            <TextView key={replay} t={sample(b, b.animate)} />
          </div>
          <div className="brd__side">
            <div className="brd__tabs" role="tablist">
              {TABS.map(([id, name]) => (
                <button key={id} type="button" role="tab" className={`seg${tab === id ? ' is-on' : ''}`} aria-selected={tab === id} onClick={() => setTab(id)}>
                  {name}
                </button>
              ))}
            </div>
            {body}
          </div>
        </div>
        <p className="field__note brd__foot-note">
          Applies to every title ({titles} now), the font and colour of songs, and the home team colour on scoreboards. New titles come in this look too.
        </p>
        {error && (
          <p className="field__note field__note--warn" role="alert">
            {error}
          </p>
        )}
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => setB({ ...defaultBrand(), fonts: b.fonts })}>
            Back to the start look
          </button>
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={apply}>
            Apply to everything
          </button>
        </footer>
      </div>
    </div>
  );
}
