// Final Cut Pro X XML (.fcpxml): Final Cut Pro and DaVinci Resolve read and
// write it. Times are fractions of a second ("1001/30000s"). V1 becomes the
// primary storyline; the other tracks are clips connected to it on lanes
// (above for picture, below for sound).
import {
  dropFrameRate,
  fileNameOf,
  fileUrl,
  kid,
  kids,
  parseXml,
  pathFromUrl,
  standardFps,
  timelineLength,
  xmlEscape,
  type XClip,
  type XFile,
  type XMarker,
  type XTimeline,
  type XTrack,
} from './timeline';

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

/** One frame as a fraction of a second [top, bottom]. */
export function frameDuration(fps: number): [number, number] {
  const base = Math.round(fps);
  if (Math.abs(fps - base) > 0.001) return [1001, base * 1000];
  return [100, base * 100];
}

/** A number of frames as FCPXML time ("1001/30000s", "5s", "0s"). */
export function fcpTime(frames: number, fps: number): string {
  if (frames === 0) return '0s';
  const [n, d] = frameDuration(fps);
  const top = Math.round(frames) * n;
  const g = gcd(top, d);
  const a = top / g;
  const b = d / g;
  return b === 1 ? `${a}s` : `${a}/${b}s`;
}

/** FCPXML time ("1001/30000s", "5s", "3.5s") in seconds. */
export function fcpSeconds(t: string | null | undefined): number {
  if (!t) return 0;
  const m = /^(-?[\d.]+)(?:\/(\d+))?s?$/.exec(t.trim());
  if (!m) return 0;
  const top = Number(m[1]);
  const bottom = m[2] ? Number(m[2]) : 1;
  return bottom ? top / bottom : 0;
}

interface Item {
  clip: XClip | null;
  offset: number;
  length: number;
  connected: { clip: XClip; lane: number }[];
  markers: XMarker[];
}

/** Write a timeline as FCPXML 1.10. */
export function writeFcpxml(t: XTimeline): string {
  const fps = t.fps;
  const tm = (f: number) => fcpTime(f, fps);
  const sec = (s: number) => Math.round(s * exactFps(fps));
  const formats = new Map<string, string>();
  const formatLines: string[] = [];
  const formatFor = (w: number, h: number, r: number): string => {
    const key = `${w}x${h}@${standardFps(r)}`;
    const have = formats.get(key);
    if (have) return have;
    const id = `r${formats.size + 1}`;
    formats.set(key, id);
    formatLines.push(`    <format id="${id}" name="${formatName(w, h, r)}" frameDuration="${fcpFrame(r)}" width="${w}" height="${h}"/>`);
    return id;
  };
  const seqFormat = formatFor(t.width, t.height, fps);

  // Files: one asset each.
  const assets = new Map<string, { id: string; file: XFile; frames: number }>();
  for (const tr of t.tracks)
    for (const c of tr.clips) {
      if (!c.file) continue;
      const key = c.file.name.toLowerCase();
      const used = sec(c.srcIn) + Math.ceil(c.length * Math.abs(c.speed || 1));
      const a = assets.get(key);
      if (a) a.frames = Math.max(a.frames, used);
      else assets.set(key, { id: '', file: c.file, frames: Math.max(used, sec(c.file.duration)) });
    }
  const assetLines: string[] = [];
  // Formats for each asset's own picture come first.
  for (const a of assets.values()) if (a.file.hasVideo && a.file.width) formatFor(a.file.width, a.file.height, a.file.fps || fps);
  let next = formats.size + 1;
  for (const a of assets.values()) {
    a.id = `r${next++}`;
    const f = a.file;
    const fmt = f.hasVideo && f.width ? ` format="${formatFor(f.width, f.height, f.fps || fps)}"` : '';
    assetLines.push(
      `    <asset id="${a.id}" name="${xmlEscape(f.name.replace(/\.[^.]+$/, ''))}" start="0s" duration="${tm(a.frames)}" hasVideo="${f.hasVideo ? 1 : 0}" hasAudio="${f.hasAudio ? 1 : 0}"${fmt}${f.hasAudio ? ' audioSources="1" audioChannels="2" audioRate="48000"' : ''}>`,
      `      <media-rep kind="original-media" src="${xmlEscape(fileUrl(f.path))}"/>`,
      '    </asset>',
    );
  }
  const titleEffect = t.tracks.some((tr) => tr.clips.some((c) => !c.file)) ? `r${next++}` : null;

  // The primary storyline: V1 with gaps between, as long as the whole timeline.
  const total = timelineLength(t);
  const video = t.tracks.filter((x) => x.kind === 'video');
  const audio = t.tracks.filter((x) => x.kind === 'audio');
  const items: Item[] = [];
  let at = 0;
  for (const c of [...(video[0]?.clips ?? [])].sort((a, b) => a.start - b.start)) {
    if (c.start < at) continue;
    if (c.start > at) items.push({ clip: null, offset: at, length: c.start - at, connected: [], markers: [] });
    items.push({ clip: c, offset: c.start, length: c.length, connected: [], markers: [] });
    at = c.start + c.length;
  }
  if (at < total || !items.length) items.push({ clip: null, offset: at, length: Math.max(1, total - at), connected: [], markers: [] });
  const host = (frame: number): Item => items.find((i) => frame >= i.offset && frame < i.offset + i.length) ?? (items[items.length - 1] as Item);
  const connect = (tr: XTrack, lane: number) => {
    for (const c of tr.clips) host(c.start).connected.push({ clip: c, lane });
  };
  video.slice(1).forEach((tr, i) => connect(tr, i + 1));
  audio.forEach((tr, i) => connect(tr, -(i + 1)));
  for (const m of t.markers) host(m.at).markers.push(m);

  let styleN = 0;
  const startOf = (c: XClip | null): number => (c?.file ? sec(c.srcIn) : 0);
  const clipXml = (c: XClip, attrs: string, kind: 'video' | 'audio', inner: string[], pad: string): string[] => {
    const lengthAttr = ` duration="${tm(c.length)}"`;
    const enabled = c.enabled ? '' : ' enabled="0"';
    if (!c.file) {
      styleN += 1;
      return [
        `${pad}<title ref="${titleEffect}"${attrs} name="${xmlEscape(c.name || 'Title')}" start="0s"${lengthAttr}${enabled}>`,
        `${pad}  <text><text-style ref="ts${styleN}">${xmlEscape(c.text ?? c.name)}</text-style></text>`,
        `${pad}  <text-style-def id="ts${styleN}"><text-style font="Helvetica" fontSize="63" fontColor="1 1 1 1" alignment="center"/></text-style-def>`,
        ...inner,
        `${pad}</title>`,
      ];
    }
    const a = assets.get(c.file.name.toLowerCase());
    const src = c.file.hasVideo && c.file.hasAudio ? ` srcEnable="${kind}"` : '';
    const body: string[] = [];
    const speed = Math.abs(c.speed || 1) * (c.reverse ? -1 : 1);
    if (speed !== 1) {
      const span = Math.round(c.length * Math.abs(speed));
      const s0 = sec(c.srcIn);
      body.push(
        `${pad}  <timeMap>`,
        `${pad}    <timept time="0s" value="${tm(speed < 0 ? s0 + span : s0)}" interp="linear"/>`,
        `${pad}    <timept time="${tm(c.length)}" value="${tm(speed < 0 ? s0 : s0 + span)}" interp="linear"/>`,
        `${pad}  </timeMap>`,
      );
    }
    if (c.gain !== undefined && kind === 'audio') body.push(`${pad}  <adjust-volume amount="${c.gain}dB"/>`);
    return [
      `${pad}<asset-clip ref="${a?.id ?? ''}"${attrs} name="${xmlEscape(c.name)}" start="${tm(sec(c.srcIn))}"${lengthAttr}${src}${enabled} tcFormat="NDF">`,
      ...body,
      ...inner,
      `${pad}</asset-clip>`,
    ];
  };

  const spine: string[] = [];
  for (const it of items) {
    const local = (abs: number) => startOf(it.clip) + (abs - it.offset);
    const inner: string[] = [];
    for (const { clip, lane } of it.connected)
      inner.push(...clipXml(clip, ` lane="${lane}" offset="${tm(local(clip.start))}"`, lane < 0 ? 'audio' : 'video', [], '            '));
    for (const m of it.markers)
      inner.push(`            <marker start="${tm(local(m.at))}" duration="${tm(Math.max(1, m.length))}" value="${xmlEscape(m.name || 'Marker')}"/>`);
    if (it.clip) spine.push(...clipXml(it.clip, ` offset="${tm(it.offset)}"`, 'video', inner, '          '));
    else spine.push(`          <gap name="Gap" offset="${tm(it.offset)}" start="0s" duration="${tm(it.length)}">`, ...inner, '          </gap>');
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.10">',
    '  <resources>',
    ...formatLines,
    ...assetLines,
    ...(titleEffect
      ? [`    <effect id="${titleEffect}" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>`]
      : []),
    '  </resources>',
    '  <library>',
    '    <event name="Lumora Studio">',
    `      <project name="${xmlEscape(t.name)}">`,
    `        <sequence format="${seqFormat}" duration="${tm(Math.max(total, 1))}" tcStart="0s" tcFormat="${dropFrameRate(fps) ? 'DF' : 'NDF'}" audioLayout="stereo" audioRate="48k">`,
    '          <spine>',
    ...spine.map((l) => `  ${l}`),
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    '',
  ].join('\n');
}

const exactFps = (fps: number): number => {
  const [n, d] = frameDuration(fps);
  return d / n;
};

function fcpFrame(fps: number): string {
  const [n, d] = frameDuration(fps);
  const g = gcd(n, d);
  return `${n / g}/${d / g}s`;
}

function formatName(w: number, h: number, fps: number): string {
  const r = standardFps(fps);
  const rate = String(r).replace('.', '');
  const size = h === 2160 && w === 3840 ? '2160p' : h === 1080 && w === 1920 ? '1080p' : h === 720 && w === 1280 ? '720p' : null;
  return size ? `FFVideoFormat${size}${rate}` : `FFVideoFormatRateUndefined`;
}

// ---------------------------------------------------------------- reading

interface Asset {
  file: XFile;
  start: number;
}

/** Read an FCPXML file (from Final Cut Pro, DaVinci Resolve, Premiere’s exporter…). */
export function readFcpxml(text: string): XTimeline {
  const doc = parseXml(text);
  const root = doc.documentElement;
  if (root.tagName !== 'fcpxml') throw new Error('This is not an FCPXML file.');
  const notes = new Map<string, number>();
  const note = (what: string) => notes.set(what, (notes.get(what) ?? 0) + 1);

  const formats = new Map<string, { fps: number; width: number; height: number }>();
  for (const f of Array.from(root.getElementsByTagName('format'))) {
    const fd = fcpSeconds(f.getAttribute('frameDuration'));
    formats.set(f.getAttribute('id') ?? '', {
      fps: fd > 0 ? standardFps(1 / fd) : 0,
      width: Number(f.getAttribute('width') ?? 0),
      height: Number(f.getAttribute('height') ?? 0),
    });
  }
  const assets = new Map<string, Asset>();
  for (const a of Array.from(root.getElementsByTagName('asset'))) {
    const rep = kid(a, 'media-rep');
    const src = rep?.getAttribute('src') ?? a.getAttribute('src') ?? '';
    const path = pathFromUrl(src);
    const fmt = formats.get(a.getAttribute('format') ?? '');
    assets.set(a.getAttribute('id') ?? '', {
      start: fcpSeconds(a.getAttribute('start')),
      file: {
        name: fileNameOf(path) || a.getAttribute('name') || 'Clip',
        path,
        duration: fcpSeconds(a.getAttribute('duration')),
        width: fmt?.width ?? 0,
        height: fmt?.height ?? 0,
        fps: fmt?.fps ?? 0,
        hasVideo: a.getAttribute('hasVideo') === '1',
        hasAudio: a.getAttribute('hasAudio') === '1',
      },
    });
  }

  const seq = root.getElementsByTagName('sequence')[0];
  if (!seq) throw new Error('There is no timeline (sequence) in this FCPXML file.');
  const project = seq.parentElement?.tagName === 'project' ? seq.parentElement : null;
  const fmt = formats.get(seq.getAttribute('format') ?? '') ?? { fps: 30, width: 1920, height: 1080 };
  const fps = fmt.fps || 30;
  const fr = (s: number) => Math.round(s * exactFps(fps));
  const tcStart = fcpSeconds(seq.getAttribute('tcStart'));

  // Clips by lane: picture and its sound.
  const lanes = new Map<string, XClip[]>();
  const add = (key: string, c: XClip) => {
    const list = lanes.get(key) ?? [];
    list.push(c);
    lanes.set(key, list);
  };
  const markers: XMarker[] = [];
  let pendingDissolve = 0;

  /** The asset an element plays (asset-clip, or a clip's video / audio inside). */
  const assetOf = (el: Element): { asset: Asset; srcStart: number } | null => {
    const ref = el.getAttribute('ref');
    if (ref && assets.has(ref)) return { asset: assets.get(ref) as Asset, srcStart: 0 };
    for (const k of kids(el, 'video', 'audio')) {
      const r = k.getAttribute('ref');
      if (r && assets.has(r)) return { asset: assets.get(r) as Asset, srcStart: fcpSeconds(k.getAttribute('start')) - fcpSeconds(el.getAttribute('start')) };
    }
    return null;
  };

  const speedOf = (el: Element): number => {
    const tmap = kid(el, 'timeMap');
    const pts = tmap ? kids(tmap, 'timept') : [];
    if (pts.length < 2) return 1;
    const a = pts[0] as Element;
    const b = pts[pts.length - 1] as Element;
    const dt = fcpSeconds(b.getAttribute('time')) - fcpSeconds(a.getAttribute('time'));
    const dv = fcpSeconds(b.getAttribute('value')) - fcpSeconds(a.getAttribute('value'));
    if (pts.length > 2) note('speed ramp (read as one speed)');
    return dt > 0 ? Math.round((dv / dt) * 10000) / 10000 : 1;
  };

  /** One element placed at `abs` (seconds on the timeline), on `lane`. */
  const visit = (el: Element, abs: number, lane: number) => {
    const tag = el.tagName;
    const dur = fcpSeconds(el.getAttribute('duration'));
    const localStart = fcpSeconds(el.getAttribute('start'));
    const enabled = el.getAttribute('enabled') !== '0';
    if (tag === 'transition') return;
    if (tag === 'asset-clip' || tag === 'clip' || tag === 'video' || tag === 'audio' || tag === 'sync-clip') {
      const found = tag === 'sync-clip' ? assetOf(kids(el, 'asset-clip', 'clip')[0] ?? el) : assetOf(el);
      if (found) {
        const speed = speedOf(el);
        const tmap = kid(el, 'timeMap');
        const values = tmap ? kids(tmap, 'timept').map((x) => fcpSeconds(x.getAttribute('value'))) : [];
        // The earliest second of the file used (a time map says it outright).
        const srcIn = values.length ? Math.min(...values) - found.asset.start : localStart - found.asset.start + found.srcStart;
        const start = fr(abs);
        const length = fr(abs + dur) - start;
        const vol = kid(el, 'adjust-volume')?.getAttribute('amount');
        const gain = vol ? Number.parseFloat(vol) : undefined;
        const base: XClip = {
          name: el.getAttribute('name') || found.asset.file.name.replace(/\.[^.]+$/, ''),
          file: found.asset.file,
          start,
          length,
          srcIn: Math.max(0, srcIn),
          speed: Math.abs(speed),
          reverse: speed < 0,
          enabled,
          ...(pendingDissolve && lane === 0 ? { dissolveIn: pendingDissolve } : {}),
          ...(gain !== undefined && Number.isFinite(gain) && gain !== 0 ? { gain } : {}),
        };
        if (lane === 0) pendingDissolve = 0;
        const only = el.getAttribute('srcEnable') ?? (tag === 'audio' ? 'audio' : tag === 'video' ? 'video' : 'all');
        const pic = found.asset.file.hasVideo && only !== 'audio' && lane >= 0;
        const snd = found.asset.file.hasAudio && only !== 'video';
        if (pic) add(`v${lane}`, base);
        if (snd) add(lane < 0 ? `a${-lane}` : `e${lane}`, { ...base, dissolveIn: undefined });
        if (!pic && !snd && found.asset.file.hasVideo) add(`v${Math.max(0, lane)}`, base);
      } else note('compound or multicam clip (left as a gap)');
    } else if (tag === 'title') {
      const words = Array.from(el.getElementsByTagName('text-style'))
        .filter((x) => x.parentElement?.tagName === 'text')
        .map((x) => x.textContent ?? '')
        .join('');
      add(`v${Math.max(0, lane)}`, {
        name: el.getAttribute('name') || 'Title',
        file: null,
        start: fr(abs),
        length: fr(abs + dur) - fr(abs),
        srcIn: 0,
        speed: 1,
        reverse: false,
        enabled,
        text: words || el.getAttribute('name') || 'Title',
      });
      note('title (its words carry over, not its look)');
    } else if (tag === 'ref-clip' || tag === 'mc-clip') note(tag === 'ref-clip' ? 'compound clip (left as a gap)' : 'multicam clip (left as a gap)');
    else if (tag !== 'gap' && tag !== 'spine') return;

    // What hangs off it: connected clips, storylines and markers, in its own time.
    for (const k of kids(el)) {
      const kt = k.tagName;
      if (kt === 'marker' || kt === 'chapter-marker')
        markers.push({
          at: fr(abs + fcpSeconds(k.getAttribute('start')) - localStart),
          length: kt === 'marker' && fr(fcpSeconds(k.getAttribute('duration'))) > 1 ? fr(fcpSeconds(k.getAttribute('duration'))) : 0,
          name: k.getAttribute('value') ?? '',
        });
      const kl = k.getAttribute('lane');
      if (kl === null) continue;
      const at = abs + fcpSeconds(k.getAttribute('offset')) - localStart;
      if (kt === 'spine') spineAt(k, at, lane + Number(kl));
      else visit(k, at, lane + Number(kl));
    }
  };

  const spineAt = (sp: Element, abs: number, lane: number) => {
    const children = kids(sp);
    const first = children.find((c) => c.tagName !== 'transition');
    const base = fcpSeconds(first?.getAttribute('offset'));
    let cursor = abs;
    for (const c of children) {
      if (c.tagName === 'transition') {
        if (lane === 0) pendingDissolve = fr(fcpSeconds(c.getAttribute('duration')));
        continue;
      }
      const off = c.getAttribute('offset');
      const at = off !== null ? abs + fcpSeconds(off) - base : cursor;
      visit(c, at, lane);
      cursor = at + fcpSeconds(c.getAttribute('duration'));
    }
  };

  const top = kid(seq, 'spine');
  if (top) spineAt(top, fcpSeconds(kids(top)[0]?.getAttribute('offset')) - tcStart, 0);

  // Lanes into tracks: picture lanes upward from V1; sound from the picture lanes, then the lanes below.
  const keys = [...lanes.keys()];
  const vLanes = keys
    .filter((k) => k.startsWith('v'))
    .map((k) => Number(k.slice(1)))
    .sort((a, b) => a - b);
  const eLanes = keys
    .filter((k) => k.startsWith('e'))
    .map((k) => Number(k.slice(1)))
    .sort((a, b) => a - b);
  const aLanes = keys
    .filter((k) => k.startsWith('a'))
    .map((k) => Number(k.slice(1)))
    .sort((a, b) => a - b);
  const tracks: XTrack[] = [];
  const sorted = (k: string) => [...(lanes.get(k) ?? [])].sort((a, b) => a.start - b.start);
  vLanes.forEach((l, i) => tracks.push({ kind: 'video', name: `V${i + 1}`, clips: sorted(`v${l}`) }));
  let n = 0;
  for (const l of eLanes) tracks.push({ kind: 'audio', name: `A${++n}`, clips: sorted(`e${l}`) });
  for (const l of aLanes) tracks.push({ kind: 'audio', name: `A${++n}`, clips: sorted(`a${l}`) });

  return {
    name: project?.getAttribute('name') || seq.getAttribute('name') || 'Imported timeline',
    width: fmt.width || 1920,
    height: fmt.height || 1080,
    fps,
    tracks,
    markers: markers.sort((a, b) => a.at - b.at),
    notes: [...notes].map(([what, k]) => `${k} × ${what}`),
  };
}
