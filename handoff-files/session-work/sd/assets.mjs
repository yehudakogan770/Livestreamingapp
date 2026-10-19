//#region streamdeck/src/actions.ts
const KINDS = [
	"take",
	"cut",
	"blank",
	"panic",
	"input",
	"overlay",
	"preset",
	"replay",
	"record",
	"golive",
	"countdown",
	"nextcue",
	"screen",
	"rehearsal",
	"backup"
];
function screenFor(s, deck) {
	return s.screen === "live" || s.screen === "back" ? s.screen : deck;
}
/** The input a key is for: by id, else by its remembered name (an event opened again). */
function findInput(state, s) {
	return state.inputs.find((i) => i.id === s.input) ?? (s.inputName ? state.inputs.find((i) => i.name === s.inputName) : void 0);
}
function findPreset(state, s) {
	return state.presets.find((p) => p.id === s.preset) ?? (s.presetName ? state.presets.find((p) => p.name === s.presetName) : void 0);
}
function findCountdown(state, s) {
	return state.countdowns.find((c) => c.id === s.countdown) ?? (s.countdownName ? state.countdowns.find((c) => c.name === s.countdownName) : void 0) ?? (s.countdown ? void 0 : state.countdowns[0]);
}
const channelOf = (s) => {
	const n = Number.parseInt(s.channel ?? "1", 10);
	return n >= 1 && n <= 4 ? n : 1;
};
const secondsOf = (s) => {
	const n = Number.parseInt(s.seconds ?? "10", 10);
	return n >= 1 && n <= 60 ? n : 10;
};
/** Does this press need a hold before anything happens? */
function needsHold(kind, s, state) {
	if (kind === "panic" || kind === "golive") return true;
	if (kind === "record") return s.holdToStop !== false && !!state?.app.recording;
	return false;
}
//#endregion
//#region streamdeck/src/icons.ts
const ICONS = {
	take: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"12\" rx=\"1.5\"/><path d=\"M12 21v-9\"/><path d=\"M8.5 15.5 12 12l3.5 3.5\"/>",
	cut: "<rect x=\"2.5\" y=\"6\" width=\"8\" height=\"12\" rx=\"1\"/><rect x=\"13.5\" y=\"6\" width=\"8\" height=\"12\" rx=\"1\"/><path d=\"M12 3v18\"/>",
	blank: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"13\" rx=\"1.5\"/><path d=\"M8 20h8\"/><path d=\"M12 17v3\"/><path d=\"M3 10.5 9.5 4\"/><path d=\"M3 17 16 4\"/><path d=\"M9.5 17 21 5.5\"/>",
	panic: "<path d=\"M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2z\"/><path d=\"M12 7.5v5.5\"/><path d=\"M12 16.4v.1\"/>",
	input: "<rect x=\"2.5\" y=\"6.5\" width=\"13\" height=\"11\" rx=\"1.5\"/><path d=\"m15.5 10.5 6-3.5v10l-6-3.5\"/>",
	overlay: "<path d=\"m12 3 9 5-9 5-9-5z\"/><path d=\"m3 12.5 9 5 9-5\"/><path d=\"m3 16.5 9 5 9-5\"/>",
	preset: "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"13.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1\"/>",
	replay: "<path d=\"M3.5 12a8.5 8.5 0 1 0 2.5-6\"/><path d=\"M3 3.5V8h4.5\"/><path d=\"m10.5 9 4.5 3-4.5 3z\"/>",
	record: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><circle cx=\"12\" cy=\"12\" r=\"4\" fill=\"currentColor\"/>",
	live: "<circle cx=\"12\" cy=\"12\" r=\"2\" fill=\"currentColor\"/><path d=\"M8.2 8.2a5.4 5.4 0 0 0 0 7.6\"/><path d=\"M15.8 8.2a5.4 5.4 0 0 1 0 7.6\"/><path d=\"M5.2 5.2a9.6 9.6 0 0 0 0 13.6\"/><path d=\"M18.8 5.2a9.6 9.6 0 0 1 0 13.6\"/>",
	countdown: "<circle cx=\"12\" cy=\"13.5\" r=\"7.5\"/><path d=\"M12 13.5V9.5\"/><path d=\"M9.5 2.5h5\"/><path d=\"M12 2.5V6\"/><path d=\"m18.5 6.5 1.5-1.5\"/>",
	cue: "<path d=\"m5 5.5 9 6.5-9 6.5z\"/><path d=\"M18.5 5.5v13\"/>",
	screen: "<rect x=\"2.5\" y=\"4\" width=\"8.5\" height=\"7\" rx=\"1\"/><rect x=\"13\" y=\"13\" width=\"8.5\" height=\"7\" rx=\"1\"/><path d=\"M15 5h3.5a1.5 1.5 0 0 1 1.5 1.5V10\"/><path d=\"m18 8 2 2 2-2\"/><path d=\"M9 19H5.5A1.5 1.5 0 0 1 4 17.5V14\"/><path d=\"m2 16 2-2 2 2\"/>",
	rehearsal: "<rect x=\"5\" y=\"4\" width=\"14\" height=\"17\" rx=\"1.5\"/><path d=\"M9 4V2.8h6V4\"/><path d=\"m8.5 13 2.5 2.5 4.5-5\"/>",
	backup: "<rect x=\"2.5\" y=\"9\" width=\"11\" height=\"9\" rx=\"1.5\"/><path d=\"m13.5 12 4-2.5v8l-4-2.5\"/><path d=\"M6 6h9.5A1.5 1.5 0 0 1 17 7.5\"/><path d=\"M19.5 7.5 21.5 6v6\"/>",
	warning: "<path d=\"M12 3.5 21.5 20h-19z\"/><path d=\"M12 10v4.5\"/><path d=\"M12 17.3v.1\"/>",
	lumora: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\"/><circle cx=\"12\" cy=\"12\" r=\"1.2\" fill=\"currentColor\"/>"
};
/** One icon as a stand-alone SVG (for the action list in the Stream Deck app). */
function iconSvg(name, size, color = "#FFFFFF", stroke = 1.6) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" color="${color}">${ICONS[name]}</svg>\n`;
}
//#endregion
//#region streamdeck/src/show.ts
/** An input's tally on a screen. */
function tally(state, id, on) {
	if (!id) return "none";
	const sc = state.screens[on];
	if (sc.program === id) return "program";
	if (sc.preview === id) return "preview";
	return "none";
}
/** Time left on a countdown at `now` (Lumora's clock), in ms. */
function remaining(c, now) {
	return c.endsAt === null ? c.remainingMs : Math.max(0, c.endsAt - now);
}
/** 83 000 ms → "1:23"; an hour or more → "1:02:03". */
function clock(ms) {
	const total = Math.ceil(Math.max(0, ms) / 1e3);
	const h = Math.floor(total / 3600);
	const m = Math.floor(total % 3600 / 60);
	const sec = String(total % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
//#endregion
//#region streamdeck/src/keys.ts
const COLORS = {
	background: "#121316",
	text: "#F2F2F3",
	muted: "#8B8E95",
	dim: "#55585E",
	program: "#D7262B",
	preview: "#16A34A",
	on: "#F2F2F3",
	warn: "#E8A10C"
};
const TONES = {
	idle: {
		bg: COLORS.background,
		fg: COLORS.text,
		sub: COLORS.muted
	},
	program: {
		bg: COLORS.program,
		fg: "#FFFFFF",
		sub: "#FFE3E3"
	},
	preview: {
		bg: COLORS.preview,
		fg: "#FFFFFF",
		sub: "#DFF7E7"
	},
	on: {
		bg: COLORS.on,
		fg: COLORS.background,
		sub: "#45484E"
	},
	warn: {
		bg: COLORS.warn,
		fg: COLORS.background,
		sub: "#3A2A00"
	}
};
const escape = (s) => s.replace(/[&<>"']/g, (c) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&apos;"
})[c]);
/** Fit words onto at most `lines` lines of `width` characters, with "…" when cut short. */
function wrap(text, width, lines) {
	const out = [];
	let line = "";
	for (const word of text.trim().split(/\s+/).filter(Boolean)) {
		const w = word.length > width ? `${word.slice(0, width - 1)}…` : word;
		if (!line) line = w;
		else if (line.length + 1 + w.length <= width) line += ` ${w}`;
		else {
			out.push(line);
			line = w;
		}
	}
	if (line) out.push(line);
	if (out.length <= lines) return out;
	const kept = out.slice(0, lines);
	const last = kept[lines - 1];
	if (!last.endsWith("…")) kept[lines - 1] = last.length < width ? `${last}…` : `${last.slice(0, width - 1)}…`;
	return kept;
}
/** About how wide a line is at a font size (capitals are wider). */
function textWidth(line, size) {
	let w = 0;
	for (const c of line) w += c === " " ? .28 : /[A-Z0-9]/.test(c) ? .68 : .55;
	return w * size;
}
/** The largest size at which every line fits across the key. */
function fontSize(lines) {
	return [
		28,
		24,
		21,
		18
	].find((size) => lines.every((l) => textWidth(l, size) <= 128)) ?? 16;
}
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
/** The key's picture as SVG. */
function renderSvg(m) {
	const t = TONES[m.offline ? "idle" : m.tone];
	const fg = m.offline ? COLORS.dim : t.fg;
	const sub = m.offline ? COLORS.muted : t.sub;
	const label = m.label.trim();
	const lines = label.length > 9 ? wrap(label, 11, m.sub ? 1 : 2) : [label];
	const size = fontSize(lines);
	const parts = [];
	parts.push(`<rect width="144" height="144" fill="${t.bg}"/>`);
	const iconSize = lines.length > 1 || m.sub ? 46 : 54;
	const iconY = lines.length > 1 && m.sub ? 12 : 18;
	const scale = iconSize / 24;
	parts.push(`<g transform="translate(${(144 - iconSize) / 2} ${iconY}) scale(${scale})" fill="none" stroke="${fg}" color="${fg}" stroke-width="${1.7 * 2.25 / scale}" stroke-linecap="round" stroke-linejoin="round">${ICONS[m.icon]}</g>`);
	let y = iconY + iconSize + size + 4;
	for (const l of lines) {
		parts.push(`<text x="72" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${fg}">${escape(l)}</text>`);
		y += size + 2;
	}
	if (m.sub) {
		const s = wrap(m.sub, 14, 1)[0] ?? "";
		parts.push(`<text x="72" y="${Math.min(y + 14, 136)}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="500" fill="${sub}">${escape(s)}</text>`);
	}
	if (m.offline) parts.push(`<g transform="translate(104 8) scale(1.35)" fill="none" stroke="${COLORS.warn}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.warning}</g>`);
	if (m.hold != null) {
		const w = Math.round(136 * Math.min(1, Math.max(0, m.hold)));
		parts.push(`<rect x="4" y="4" width="136" height="8" rx="4" fill="${COLORS.background}" opacity="0.55"/>`);
		parts.push(`<rect x="4" y="4" width="${w}" height="8" rx="4" fill="${COLORS.warn}"/>`);
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`;
}
const SCREEN_NAME = {
	live: "LIVE",
	back: "BACK"
};
const OFFLINE_WORDS = {
	off: "Set up",
	connecting: "Connecting",
	offline: "Lumora offline",
	wrongPin: "Wrong PIN"
};
/** What a key shows now. */
function keyModel(kind, s, ctx) {
	const m = baseModel(kind, s, ctx);
	if (s.label?.trim()) m.label = s.label.trim();
	if (ctx.connection !== "online" && kind !== "screen") {
		m.offline = true;
		m.sub = OFFLINE_WORDS[ctx.connection] ?? m.sub;
	}
	if (ctx.hold != null) {
		m.hold = ctx.hold;
		m.sub = "Keep holding";
	}
	return m;
}
function baseModel(kind, s, { state, deck, now }) {
	const screen = screenFor(s, deck);
	const onScreen = screen === "back" ? "Back screen" : null;
	switch (kind) {
		case "take": return {
			icon: "take",
			label: "TAKE",
			sub: onScreen ?? (s.transition ? s.transition.toUpperCase() : null),
			tone: "idle"
		};
		case "cut": return {
			icon: "cut",
			label: "CUT",
			sub: onScreen,
			tone: "idle"
		};
		case "blank": {
			const blank = !!state?.screens[screen].blank;
			return {
				icon: "blank",
				label: s.mode === "ftb" ? "FTB" : "BLANK",
				sub: blank ? "Black now" : onScreen,
				tone: blank ? "warn" : "idle"
			};
		}
		case "panic": {
			const on = !!state?.panic;
			return {
				icon: "panic",
				label: "PANIC",
				sub: on ? "Hold to end" : "Hold",
				tone: on ? "program" : "idle"
			};
		}
		case "input": {
			const input = state ? findInput(state, s) : void 0;
			if (!input) return {
				icon: "input",
				label: s.inputName || "INPUT",
				sub: state ? "Choose input" : null,
				tone: "idle"
			};
			const t = state ? tally(state, input.id, screen) : "none";
			return {
				icon: "input",
				label: input.name,
				sub: t === "program" ? "On air" : t === "preview" ? "In Next" : `Input ${input.number}`,
				tone: t === "none" ? "idle" : t
			};
		}
		case "overlay": {
			const ch = channelOf(s);
			const o = state?.overlays[ch - 1];
			return {
				icon: "overlay",
				label: o?.name || `OVERLAY ${ch}`,
				sub: o?.on ? `Overlay ${ch} on` : o?.inNext ? `Overlay ${ch} in Next` : `Overlay ${ch}`,
				tone: o?.on ? "program" : o?.inNext ? "preview" : "idle"
			};
		}
		case "preset": {
			if (s.preset === "next" || s.preset === "previous") return {
				icon: "preset",
				label: s.preset === "next" ? "NEXT" : "PREVIOUS",
				sub: "Preset",
				tone: "idle"
			};
			const p = state ? findPreset(state, s) : void 0;
			if (!p) return {
				icon: "preset",
				label: s.presetName || "PRESET",
				sub: state ? "Choose preset" : null,
				tone: "idle"
			};
			return {
				icon: "preset",
				label: p.name,
				sub: `Preset ${p.number}`,
				tone: state?.activePreset === p.id ? "on" : "idle"
			};
		}
		case "replay": {
			const label = `${secondsOf(s)}s${s.slow ? " ½×" : ""}`;
			return state?.app.replay ? {
				icon: "replay",
				label,
				sub: "Replay",
				tone: "idle"
			} : {
				icon: "replay",
				label: "REPLAY",
				sub: "Press to arm",
				tone: "idle"
			};
		}
		case "record": {
			const on = !!state?.app.recording;
			return {
				icon: "record",
				label: "REC",
				sub: on ? needsHold("record", s, state) ? "Hold to stop" : "Recording" : null,
				tone: on ? "program" : "idle"
			};
		}
		case "golive": {
			const app = state?.app;
			if (app?.streaming) return {
				icon: "live",
				label: app.rehearsal ? "REHEARSING" : "LIVE",
				sub: "Hold to end",
				tone: app.rehearsal ? "warn" : "program"
			};
			return {
				icon: "live",
				label: app?.rehearsal ? "REHEARSE" : "GO LIVE",
				sub: "Hold",
				tone: "idle"
			};
		}
		case "countdown": {
			const c = state ? findCountdown(state, s) : void 0;
			if (!c) return {
				icon: "countdown",
				label: "COUNTDOWN",
				sub: state ? "None in show" : null,
				tone: "idle"
			};
			return {
				icon: "countdown",
				label: clock(remaining(c, now)),
				sub: c.name,
				tone: c.running ? "on" : "idle"
			};
		}
		case "nextcue": return {
			icon: "cue",
			label: "NEXT CUE",
			sub: state?.run.next ?? (state && !state.run.cues ? "No cues" : null),
			tone: "idle"
		};
		case "screen": return {
			icon: "screen",
			label: SCREEN_NAME[deck],
			sub: "Screen",
			tone: deck === "back" ? "on" : "idle"
		};
		case "rehearsal": {
			const on = !!state?.app.rehearsal;
			return {
				icon: "rehearsal",
				label: "REHEARSAL",
				sub: on ? "On" : "Off",
				tone: on ? "warn" : "idle"
			};
		}
		case "backup": {
			const on = !!state?.backup;
			return {
				icon: "backup",
				label: "BACKUP",
				sub: state ? on ? "Lineup on" : "Lineup off" : null,
				tone: on ? "on" : "idle"
			};
		}
	}
}
//#endregion
//#region streamdeck/src/assets.ts
const ICON_OF = {
	take: "take",
	cut: "cut",
	blank: "blank",
	panic: "panic",
	input: "input",
	overlay: "overlay",
	preset: "preset",
	replay: "replay",
	record: "record",
	golive: "live",
	countdown: "countdown",
	nextcue: "cue",
	screen: "screen",
	rehearsal: "rehearsal",
	backup: "backup"
};
/** The plugin's icon: Lumora's mark on its dark tile. */
function pluginIcon(size) {
	const s = size / 24;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${size * .18}" fill="${COLORS.background}"/><g transform="translate(${size * .18} ${size * .18}) scale(${s * .64})" fill="none" stroke="${COLORS.text}" color="${COLORS.text}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS.lumora}</g></svg>\n`;
}
/** Every generated picture, by its path inside the .sdPlugin folder. */
function assetFiles() {
	const files = {
		"imgs/plugin/icon.svg": pluginIcon(256),
		"imgs/plugin/category.svg": iconSvg("lumora", 28, "#FFFFFF", 1.6)
	};
	for (const kind of KINDS) {
		files[`imgs/actions/${kind}.svg`] = iconSvg(ICON_OF[kind], 20, "#FFFFFF", 1.6);
		const model = keyModel(kind, {}, {
			state: null,
			connection: "online",
			deck: "live",
			now: 0
		});
		files[`imgs/keys/${kind}.svg`] = `${renderSvg(model)}\n`;
	}
	return files;
}
//#endregion
export { ICON_OF, assetFiles };
