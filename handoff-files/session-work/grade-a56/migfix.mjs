import { writeFileSync } from "node:fs";
//#region editor/app/src/model/types.ts
let n$1 = 0;
function uid(prefix = "c") {
	n$1 += 1;
	return `${prefix}${Date.now().toString(36)}${n$1.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}
const NO_MOTION = {
	x: 0,
	y: 0,
	scale: 100,
	scaleX: 100,
	rotation: 0,
	rotX: 0,
	rotY: 0,
	z: 0,
	cropL: 0,
	cropR: 0,
	cropT: 0,
	cropB: 0,
	opacity: 100,
	blend: "normal",
	fill: false
};
function newClip(track, start, length, source, name) {
	return {
		id: uid(),
		track,
		start,
		length,
		name,
		source,
		speed: 1,
		reverse: false,
		enabled: true,
		link: null,
		label: null,
		motion: { ...NO_MOTION },
		effects: [],
		gain: 0,
		pan: 0,
		tIn: null,
		tOut: null
	};
}
//#endregion
//#region editor/app/src/model/effects.ts
const P = (key, label, min, max, def, step = 1, unit) => ({
	key,
	label,
	min,
	max,
	def,
	step,
	...unit ? { unit } : {}
});
const EFFECTS = [
	{
		type: "basic",
		name: "Basic correction",
		kind: "video",
		group: "Color",
		params: [
			P("exposure", "Exposure", -4, 4, 0, .05),
			P("contrast", "Contrast", -100, 100, 0),
			P("highlights", "Highlights", -100, 100, 0),
			P("shadows", "Shadows", -100, 100, 0),
			P("whites", "Whites", -100, 100, 0),
			P("blacks", "Blacks", -100, 100, 0),
			P("temperature", "Temperature", -100, 100, 0),
			P("tint", "Tint", -100, 100, 0),
			P("saturation", "Saturation", 0, 200, 100, 1, "%"),
			P("vibrance", "Vibrance", -100, 100, 0)
		]
	},
	{
		type: "wheels",
		name: "Color wheels",
		kind: "video",
		group: "Color",
		params: [
			P("liftX", "Shadows color ↔", -1, 1, 0, .01),
			P("liftY", "Shadows color ↕", -1, 1, 0, .01),
			P("lift", "Shadows level", -100, 100, 0),
			P("gammaX", "Midtones color ↔", -1, 1, 0, .01),
			P("gammaY", "Midtones color ↕", -1, 1, 0, .01),
			P("gamma", "Midtones level", -100, 100, 0),
			P("gainX", "Highlights color ↔", -1, 1, 0, .01),
			P("gainY", "Highlights color ↕", -1, 1, 0, .01),
			P("gain", "Highlights level", -100, 100, 0)
		]
	},
	{
		type: "curves",
		name: "Curves",
		kind: "video",
		group: "Color",
		params: [P("mix", "Amount", 0, 100, 100, 1, "%")],
		data: {
			master: [[0, 0], [1, 1]],
			r: [[0, 0], [1, 1]],
			g: [[0, 0], [1, 1]],
			b: [[0, 0], [1, 1]]
		}
	},
	{
		type: "lut",
		name: "LUT (look)",
		kind: "video",
		group: "Color",
		params: [P("mix", "Amount", 0, 100, 100, 1, "%")],
		data: {
			path: "",
			name: ""
		}
	},
	{
		type: "hsl",
		name: "Change one color",
		kind: "video",
		group: "Color",
		params: [
			P("hue", "Which color (hue)", 0, 360, 30, 1, "°"),
			P("range", "How wide", 5, 180, 30, 1, "°"),
			P("shift", "Hue shift", -180, 180, 0, 1, "°"),
			P("sat", "Saturation", -100, 100, 0),
			P("light", "Lightness", -100, 100, 0)
		]
	},
	{
		type: "vignette",
		name: "Vignette",
		kind: "video",
		group: "Color",
		params: [
			P("amount", "Amount", -100, 100, -40),
			P("size", "Size", 0, 100, 60),
			P("feather", "Feather", 0, 100, 50)
		]
	},
	{
		type: "grade",
		name: "Color grade (nodes)",
		kind: "video",
		group: "Color",
		params: [],
		hidden: true
	},
	{
		type: "bw",
		name: "Black & white",
		kind: "video",
		group: "Color",
		params: [P("mix", "Amount", 0, 100, 100, 1, "%")]
	},
	{
		type: "invert",
		name: "Invert",
		kind: "video",
		group: "Color",
		params: [P("mix", "Amount", 0, 100, 100, 1, "%")]
	},
	{
		type: "blur",
		name: "Gaussian blur",
		kind: "video",
		group: "Blur & sharpen",
		params: [P("radius", "Blurriness", 0, 200, 20, .5)]
	},
	{
		type: "sharpen",
		name: "Sharpen",
		kind: "video",
		group: "Blur & sharpen",
		params: [P("amount", "Amount", 0, 300, 60)]
	},
	{
		type: "chromakey",
		name: "Green screen key",
		kind: "video",
		group: "Keying",
		params: [
			P("tolerance", "Tolerance", 0, 100, 30),
			P("softness", "Softness", 0, 100, 15),
			P("spill", "Spill removal", 0, 100, 50)
		],
		data: { color: "#00b140" }
	},
	{
		type: "lumakey",
		name: "Luma key",
		kind: "video",
		group: "Keying",
		params: [
			P("threshold", "Threshold", 0, 100, 10),
			P("softness", "Softness", 0, 100, 10),
			{
				...P("invert", "Key out bright", 0, 1, 0),
				toggle: true
			}
		]
	},
	{
		type: "mask",
		name: "Shape mask",
		kind: "video",
		group: "Keying",
		params: [
			{
				...P("shape", "Shape", 0, 1, 0),
				options: ["Ellipse", "Rectangle"]
			},
			P("cx", "Center ↔", -100, 100, 0, .5, "%"),
			P("cy", "Center ↕", -100, 100, 0, .5, "%"),
			P("w", "Width", 1, 200, 40, .5, "%"),
			P("h", "Height", 1, 200, 50, .5, "%"),
			P("feather", "Feather", 0, 100, 10),
			{
				...P("invert", "Invert", 0, 1, 0),
				toggle: true
			}
		]
	},
	{
		type: "mosaic",
		name: "Mosaic (pixelate)",
		kind: "video",
		group: "Stylize",
		params: [P("size", "Block size", 2, 200, 24)]
	},
	{
		type: "grain",
		name: "Film grain",
		kind: "video",
		group: "Stylize",
		params: [P("amount", "Amount", 0, 100, 20), P("size", "Size", 1, 4, 1.5, .1)]
	},
	{
		type: "glow",
		name: "Glow",
		kind: "video",
		group: "Stylize",
		params: [
			P("threshold", "Threshold", 0, 100, 65),
			P("radius", "Radius", 1, 100, 25),
			P("amount", "Amount", 0, 200, 80)
		]
	},
	{
		type: "flip",
		name: "Flip",
		kind: "video",
		group: "Transform",
		params: [{
			...P("h", "Left ↔ right", 0, 1, 1),
			toggle: true
		}, {
			...P("v", "Upside down", 0, 1, 0),
			toggle: true
		}]
	},
	{
		type: "shadow",
		name: "Drop shadow",
		kind: "video",
		group: "Stylize",
		params: [
			P("distance", "Distance", 0, 100, 12),
			P("angle", "Direction", 0, 360, 135, 1, "°"),
			P("softness", "Softness", 0, 100, 20),
			P("opacity", "Opacity", 0, 100, 60, 1, "%")
		]
	},
	{
		type: "cornerpin",
		name: "Corner pin",
		kind: "video",
		group: "3D & VFX",
		params: [
			P("tlx", "Top left ↔", -2e3, 2e3, 0, 1, "px"),
			P("tly", "Top left ↕", -2e3, 2e3, 0, 1, "px"),
			P("trx", "Top right ↔", -2e3, 2e3, 0, 1, "px"),
			P("try", "Top right ↕", -2e3, 2e3, 0, 1, "px"),
			P("blx", "Bottom left ↔", -2e3, 2e3, 0, 1, "px"),
			P("bly", "Bottom left ↕", -2e3, 2e3, 0, 1, "px"),
			P("brx", "Bottom right ↔", -2e3, 2e3, 0, 1, "px"),
			P("bry", "Bottom right ↕", -2e3, 2e3, 0, 1, "px")
		]
	},
	{
		type: "chromatic",
		name: "Color fringe (chromatic)",
		kind: "video",
		group: "3D & VFX",
		params: [P("amount", "Amount", 0, 100, 30)]
	},
	{
		type: "glitch",
		name: "Glitch",
		kind: "video",
		group: "3D & VFX",
		params: [P("amount", "Amount", 0, 100, 40), P("speed", "Speed", 0, 100, 50)]
	},
	{
		type: "vhs",
		name: "Old tape (VHS)",
		kind: "video",
		group: "3D & VFX",
		params: [P("amount", "Amount", 0, 100, 50)]
	},
	{
		type: "zoomblur",
		name: "Zoom blur",
		kind: "video",
		group: "Blur & sharpen",
		params: [
			P("amount", "Amount", 0, 100, 30),
			P("cx", "Center ↔", -100, 100, 0, .5, "%"),
			P("cy", "Center ↕", -100, 100, 0, .5, "%")
		]
	},
	{
		type: "dirblur",
		name: "Motion blur (direction)",
		kind: "video",
		group: "Blur & sharpen",
		params: [P("angle", "Direction", 0, 360, 0, 1, "°"), P("length", "Length", 0, 200, 30)]
	},
	{
		type: "displace",
		name: "Turbulence",
		kind: "video",
		group: "3D & VFX",
		params: [
			P("amount", "Amount", 0, 200, 30),
			P("size", "Size", 1, 200, 50),
			P("speed", "Speed", 0, 200, 50)
		]
	},
	{
		type: "wave",
		name: "Wave",
		kind: "video",
		group: "3D & VFX",
		params: [
			P("amount", "Amount", 0, 200, 20),
			P("size", "Waves", 1, 200, 30),
			P("speed", "Speed", 0, 200, 50)
		]
	},
	{
		type: "posterize",
		name: "Posterize",
		kind: "video",
		group: "Stylize",
		params: [P("levels", "Levels", 2, 32, 6)]
	},
	{
		type: "edges",
		name: "Find edges",
		kind: "video",
		group: "Stylize",
		params: [P("amount", "Amount", 0, 100, 100), {
			...P("invert", "Dark lines", 0, 1, 0),
			toggle: true
		}]
	},
	{
		type: "eq",
		name: "Equalizer",
		kind: "audio",
		group: "Sound",
		params: [
			P("low", "Low (100 Hz)", -18, 18, 0, .5, "dB"),
			P("lowMid", "Low-mid (400 Hz)", -18, 18, 0, .5, "dB"),
			P("highMid", "High-mid (2.5 kHz)", -18, 18, 0, .5, "dB"),
			P("high", "High (8 kHz)", -18, 18, 0, .5, "dB"),
			P("lowCut", "Low cut", 0, 300, 0, 5, "Hz")
		]
	},
	{
		type: "compressor",
		name: "Compressor",
		kind: "audio",
		group: "Sound",
		params: [
			P("threshold", "Threshold", -60, 0, -20, .5, "dB"),
			P("ratio", "Ratio", 1, 20, 4, .1),
			P("attack", "Attack", 1, 200, 10, 1, "ms"),
			P("release", "Release", 10, 1e3, 150, 5, "ms"),
			P("makeup", "Make-up gain", 0, 24, 3, .5, "dB")
		]
	},
	{
		type: "denoise",
		name: "Noise reduction",
		kind: "audio",
		group: "Sound",
		params: [P("amount", "Amount", 0, 100, 50)],
		previewNote: "You hear it in the exported film."
	},
	{
		type: "deess",
		name: "De-esser",
		kind: "audio",
		group: "Sound",
		params: [P("amount", "Amount", 0, 100, 50)],
		previewNote: "You hear it in the exported film."
	},
	{
		type: "limiter",
		name: "Limiter",
		kind: "audio",
		group: "Sound",
		params: [P("ceiling", "Ceiling", -12, 0, -1, .1, "dB")]
	},
	{
		type: "voice",
		name: "Voice clarity",
		kind: "audio",
		group: "Sound",
		params: [P("amount", "Amount", 0, 100, 50)]
	}
];
const effectDef = (type) => EFFECTS.find((e) => e.type === type);
function newEffect(type) {
	const def = effectDef(type);
	const p = {};
	for (const x of def?.params ?? []) p[x.key] = x.def;
	return {
		id: uid("e"),
		type,
		on: true,
		p,
		...def?.data ? { d: structuredClone(def.data) } : {}
	};
}
//#endregion
//#region editor/app/src/model/anim.ts
const isAnim = (p) => typeof p === "object" && p !== null && Array.isArray(p.k);
const smooth = (x) => x * x * (3 - 2 * x);
/** The value at a frame (from the clip's start). */
function valueAt(p, t, fallback = 0) {
	if (p === void 0) return fallback;
	if (!isAnim(p)) return p;
	const k = p.k;
	if (k.length === 0) return fallback;
	const first = k[0];
	if (t <= first.t) return first.v;
	for (let i = 0; i < k.length - 1; i++) {
		const a = k[i];
		const b = k[i + 1];
		if (t < b.t) {
			if (a.e === "hold") return a.v;
			const x = (t - a.t) / (b.t - a.t);
			return a.v + (b.v - a.v) * (a.e === "ease" ? smooth(x) : x);
		}
	}
	return k[k.length - 1].v;
}
//#endregion
//#region editor/app/src/model/grade.ts
const N = (key, label, def, min, max, step = 1, unit) => ({
	key,
	label,
	def,
	min,
	max,
	step,
	...unit ? { unit } : {}
});
/** Primary corrections (the same as the Basic correction effect, plus a contrast pivot and a hue turn). */
const BASIC_PARAMS = [
	N("exposure", "Exposure", 0, -4, 4, .05),
	N("contrast", "Contrast", 0, -100, 100),
	N("pivot", "Pivot", 50, 0, 100, 1, "%"),
	N("highlights", "Highlights", 0, -100, 100),
	N("shadows", "Shadows", 0, -100, 100),
	N("whites", "Whites", 0, -100, 100),
	N("blacks", "Blacks", 0, -100, 100),
	N("temperature", "Temperature", 0, -100, 100),
	N("tint", "Tint", 0, -100, 100),
	N("saturation", "Saturation", 100, 0, 200, 1, "%"),
	N("vibrance", "Vibrance", 0, -100, 100),
	N("hue", "Hue", 0, -180, 180, 1, "°")
];
const WHEEL_PARAMS = [
	"lift",
	"gamma",
	"gain",
	"offset"
].flatMap((w) => [
	N(`${w}X`, `${w} ↔`, 0, -1, 1, .01),
	N(`${w}Y`, `${w} ↕`, 0, -1, 1, .01),
	N(w, w, 0, -100, 100)
]);
/** Change one color (the same as the Change one color effect). */
const HSL_PARAMS = [
	N("hslHue", "Which color", 30, 0, 360, 1, "°"),
	N("hslRange", "How wide", 30, 5, 180, 1, "°"),
	N("hslShift", "Hue shift", 0, -180, 180, 1, "°"),
	N("hslSat", "Saturation", 0, -100, 100),
	N("hslLight", "Lightness", 0, -100, 100)
];
const NODE_PARAMS = [
	...BASIC_PARAMS,
	...WHEEL_PARAMS,
	N("curveMix", "Curves amount", 100, 0, 100, 1, "%"),
	...HSL_PARAMS
];
Object.fromEntries(NODE_PARAMS.map((x) => [x.key, x.def]));
function newNode(label = "") {
	return {
		id: uid("n"),
		label,
		on: true,
		p: {},
		curves: null,
		qualifier: null,
		window: null
	};
}
const newGrade = () => ({ steps: [{
	kind: "serial",
	node: newNode()
}] });
function newGradeEffect(grade = newGrade()) {
	return {
		id: uid("e"),
		type: "grade",
		on: true,
		p: {},
		d: grade
	};
}
const isGrade = (e) => e.type === "grade";
/** The grade stored in a grade effect (an empty one if it is damaged). */
function gradeOf(e) {
	const g = e?.d;
	return g && Array.isArray(g.steps) ? g : { steps: [] };
}
const gradeEffect = (c) => c.effects.find(isGrade);
/** The grade's numbers at a frame of the clip; bypassed nodes are left out. */
function gradeAt(g, t) {
	const now = (n) => ({
		id: n.id,
		p: Object.fromEntries(NODE_PARAMS.map((x) => [x.key, valueAt(n.p[x.key], t, x.def)])),
		curves: n.curves,
		qualifier: n.qualifier,
		window: n.window
	});
	const steps = [];
	for (const s of g.steps) {
		if (s.kind === "serial") {
			if (s.node.on) steps.push({
				kind: "serial",
				node: now(s.node)
			});
			continue;
		}
		const nodes = s.nodes.filter((n) => n.on).map(now);
		if (nodes.length) steps.push({
			kind: s.kind,
			nodes
		});
	}
	return { steps };
}
/** The color effects that a node can hold, in the order a node applies them. */
const NODE_ORDER = [
	"basic",
	"wheels",
	"curves",
	"hsl"
];
const HSL_KEYS = {
	hue: "hslHue",
	range: "hslRange",
	shift: "hslShift",
	sat: "hslSat",
	light: "hslLight"
};
/** Put one old color effect's settings into a node. */
function absorb(n, e) {
	if (e.type === "curves") {
		const d = e.d;
		return {
			...n,
			p: {
				...n.p,
				...e.p.mix !== void 0 ? { curveMix: e.p.mix } : {}
			},
			curves: d?.master ? structuredClone(d) : null
		};
	}
	const keyOf = (k) => e.type === "hsl" ? HSL_KEYS[k] ?? k : k;
	return {
		...n,
		p: {
			...n.p,
			...Object.fromEntries(Object.entries(e.p).map(([k, v]) => [keyOf(k), structuredClone(v)]))
		}
	};
}
/**
* Old color effects in a row (Basic, Color wheels, Curves, Change one color)
* as nodes that look exactly the same: one node while they are in the order a
* node applies them, a new node when the order goes back (or for one that was off).
*/
function nodesFromEffects(list) {
	const nodes = [];
	let cur = null;
	let last = -1;
	for (const e of list) {
		const k = NODE_ORDER.indexOf(e.type);
		if (!cur || !cur.on || !e.on || k <= last) {
			cur = {
				...newNode(),
				on: e.on
			};
			nodes.push(cur);
		}
		const next = absorb(cur, e);
		nodes[nodes.length - 1] = next;
		cur = next;
		last = k;
	}
	return nodes;
}
/** The first row of old color effects on a clip: where it starts and how many. */
function legacyRun(c) {
	const from = c.effects.findIndex((e) => NODE_ORDER.includes(e.type));
	if (from < 0) return null;
	let count = 0;
	while (from + count < c.effects.length && NODE_ORDER.includes(c.effects[from + count].type)) count++;
	return {
		from,
		count
	};
}
/**
* The clip with a node grade: an old row of color effects becomes the grade
* (in the same place, so it looks the same); with none, an empty grade is
* added at the end. A clip that already has a grade is unchanged.
*/
function withGrade(c) {
	if (gradeEffect(c)) return c;
	const run = legacyRun(c);
	if (!run) return {
		...c,
		effects: [...c.effects, newGradeEffect()]
	};
	const fx = newGradeEffect({ steps: nodesFromEffects(c.effects.slice(run.from, run.from + run.count)).map((node) => ({
		kind: "serial",
		node
	})) });
	const effects = [...c.effects];
	effects.splice(run.from, run.count, fx);
	return {
		...c,
		effects
	};
}
//#endregion
//#region editor/app/src/render/color.ts
/** A smooth curve through the points (monotone, so it never overshoots), as 256 steps. */
function curveTable(points) {
	const pts = [...points].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
	const out = /* @__PURE__ */ new Float32Array(256);
	if (pts.length < 2) {
		for (let i = 0; i < 256; i++) out[i] = i / 255;
		return out;
	}
	const n = pts.length;
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	const d = [];
	const m = [];
	for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
	m.push(d[0]);
	for (let i = 1; i < n - 1; i++) {
		const a = d[i - 1];
		const b = d[i];
		m.push(a * b <= 0 ? 0 : (a + b) / 2);
	}
	m.push(d[n - 2]);
	for (let i = 0; i < n - 1; i++) {
		const di = d[i];
		if (di === 0) {
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i] / di;
		const b = m[i + 1] / di;
		const h = a * a + b * b;
		if (h > 9) {
			const t = 3 / Math.sqrt(h);
			m[i] = t * a * di;
			m[i + 1] = t * b * di;
		}
	}
	for (let i = 0; i < 256; i++) {
		const x = i / 255;
		let k = 0;
		while (k < n - 2 && x > xs[k + 1]) k++;
		const x0 = xs[k];
		const x1 = xs[k + 1];
		if (x <= x0) {
			out[i] = ys[0];
			continue;
		}
		if (x >= xs[n - 1]) {
			out[i] = ys[n - 1];
			continue;
		}
		const h = x1 - x0;
		const t = (x - x0) / h;
		const t2 = t * t;
		const t3 = t2 * t;
		out[i] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
		out[i] = Math.max(0, Math.min(1, out[i]));
	}
	return out;
}
/** The curves as one 256×1 picture: each color through its own curve after the master one. */
function curvesImage(c) {
	const master = curveTable(c.master);
	const r = curveTable(c.r);
	const g = curveTable(c.g);
	const b = curveTable(c.b);
	const look = (t, x) => t[Math.round(Math.max(0, Math.min(1, x)) * 255)];
	const out = /* @__PURE__ */ new Uint8Array(1024);
	for (let i = 0; i < 256; i++) {
		const m = master[i];
		out[i * 4] = Math.round(look(r, m) * 255);
		out[i * 4 + 1] = Math.round(look(g, m) * 255);
		out[i * 4 + 2] = Math.round(look(b, m) * 255);
		out[i * 4 + 3] = 255;
	}
	return out;
}
const flatCurve = (p) => p.length === 2 && p[0]?.[0] === 0 && p[0]?.[1] === 0 && p[1]?.[0] === 1 && p[1]?.[1] === 1;
/** A color wheel's puck (x, y in -1…1) as a red/green/blue push that adds up to nothing. */
function wheelColor(x, y) {
	const angle = Math.atan2(y, x);
	const amount = Math.min(1, Math.hypot(x, y));
	const r = Math.cos(angle);
	const g = Math.cos(angle - 2 * Math.PI / 3);
	const b = Math.cos(angle + 2 * Math.PI / 3);
	return [
		r * amount,
		g * amount,
		b * amount
	];
}
//#endregion
//#region editor/app/src/render/grade.ts
const BASIC_KEYS = BASIC_PARAMS.filter((x) => x.key !== "hue" && x.key !== "pivot");
/** Which parts of a node change the picture. */
function nodeParts(n) {
	const basic = BASIC_KEYS.some((x) => (n.p[x.key] ?? x.def) !== x.def);
	const wheels = WHEEL_PARAMS.some((x) => (n.p[x.key] ?? 0) !== 0);
	const c = n.curves;
	return {
		basic,
		wheels,
		curves: !!c?.master && !(flatCurve(c.master) && flatCurve(c.r) && flatCurve(c.g) && flatCurve(c.b)),
		hsl: (n.p.hslShift ?? 0) !== 0 || (n.p.hslSat ?? 0) !== 0 || (n.p.hslLight ?? 0) !== 0,
		hue: (n.p.hue ?? 0) !== 0
	};
}
const wheel$1 = (n, w, k) => {
	const c = wheelColor(n.p[`${w}X`] ?? 0, n.p[`${w}Y`] ?? 0);
	const l = (n.p[w] ?? 0) / 100;
	return c.map((v) => v * k + l);
};
/** Lift, gamma and gain as the Color wheels effect has always worked them out, and the offset wheel. */
function wheelVectors(n) {
	return {
		lift: wheel$1(n, "lift", .15).map((v) => v * .5),
		gamma: wheel$1(n, "gamma", .25).map((v) => 1 + v),
		gain: wheel$1(n, "gain", .3).map((v) => 1 + v),
		offset: wheel$1(n, "offset", .2).map((v) => v * .5)
	};
}
/** The node's settings as the GPU program's numbers (the curves picture is bound separately). */
function nodeUniforms(n) {
	const parts = nodeParts(n);
	const p = (k, d = 0) => n.p[k] ?? d;
	const w = wheelVectors(n);
	const q = n.qualifier;
	const win = n.window;
	return {
		uUseBasic: parts.basic ? 1 : 0,
		uUseWheels: parts.wheels ? 1 : 0,
		uUseCurves: parts.curves ? 1 : 0,
		uUseHsl: parts.hsl ? 1 : 0,
		uUseHue: parts.hue ? 1 : 0,
		uBasicA: [
			p("exposure"),
			p("contrast") / 100,
			p("pivot", 50) / 100,
			p("highlights") / 100
		],
		uBasicB: [
			p("shadows") / 100,
			p("whites") / 100,
			p("blacks") / 100,
			p("temperature") / 100
		],
		uBasicC: [
			p("tint") / 100,
			p("saturation", 100) / 100,
			p("vibrance") / 100,
			p("hue") / 360
		],
		uLift: w.lift,
		uGamma: w.gamma,
		uGain: w.gain,
		uOffset: w.offset,
		uCurveMix: p("curveMix", 100) / 100,
		uHslA: [
			p("hslHue", 30) / 360,
			p("hslRange", 30) / 360,
			p("hslShift") / 360,
			p("hslSat") / 100
		],
		uHslLight: p("hslLight") / 100,
		uUseQual: q ? 1 : 0,
		uQHue: q ? [
			q.hue / 360,
			q.hueWidth / 720,
			q.soft / 500,
			q.invert ? 1 : 0
		] : [
			0,
			0,
			0,
			0
		],
		uQBand: q ? [
			q.satLo / 100,
			q.satHi / 100,
			q.lumLo / 100,
			q.lumHi / 100
		] : [
			0,
			1,
			0,
			1
		],
		uUseWin: win ? 1 : 0,
		uWin: win ? [
			win.x,
			win.y,
			Math.max(.001, win.w / 2),
			Math.max(.001, win.h / 2)
		] : [
			.5,
			.5,
			1,
			1
		],
		uWinOpt: win ? [
			win.shape === "rect" ? 1 : 0,
			win.soft / 100,
			win.invert ? 1 : 0
		] : [
			0,
			0,
			0
		]
	};
}
//#endregion
//#region ../../../../../../tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/grade-a56/migfix.ts
const fx = (type, p) => {
	const e = newEffect(type);
	return {
		...e,
		p: {
			...e.p,
			...p
		}
	};
};
const curves = fx("curves", { mix: 80 });
const set = {
	master: [
		[0, .05],
		[.4, .5],
		[1, .95]
	],
	r: [
		[0, 0],
		[.5, .6],
		[1, 1]
	],
	g: [[0, 0], [1, 1]],
	b: [[0, .1], [1, .9]]
};
curves.d = set;
const effects = [
	fx("basic", {
		exposure: .4,
		contrast: 25,
		highlights: -30,
		shadows: 20,
		whites: 5,
		blacks: -10,
		temperature: -20,
		tint: 10,
		saturation: 120,
		vibrance: 15
	}),
	fx("wheels", {
		liftX: .2,
		liftY: .1,
		lift: -5,
		gammaX: -.3,
		gammaY: .2,
		gamma: 10,
		gainX: .1,
		gainY: -.4,
		gain: 15
	}),
	curves,
	fx("hsl", {
		hue: 200,
		range: 60,
		shift: -25,
		sat: 30,
		light: 10
	})
];
const n = (e, k, d = 0) => typeof e.p[k] === "number" ? e.p[k] : d;
const [b, w, , h] = effects;
const wheel = (x, y, level, k) => wheelColor(n(w, x), n(w, y)).map((v) => v * k + n(w, level) / 100);
const legacy = [
	{
		name: "basic",
		u: {
			uExposure: n(b, "exposure"),
			uContrast: n(b, "contrast") / 100,
			uHighlights: n(b, "highlights") / 100,
			uShadows: n(b, "shadows") / 100,
			uWhites: n(b, "whites") / 100,
			uBlacks: n(b, "blacks") / 100,
			uTemp: n(b, "temperature") / 100,
			uTint: n(b, "tint") / 100,
			uSat: n(b, "saturation", 100) / 100,
			uVib: n(b, "vibrance") / 100
		}
	},
	{
		name: "wheels",
		u: {
			uLift: wheel("liftX", "liftY", "lift", .15).map((v) => v * .5),
			uGamma: wheel("gammaX", "gammaY", "gamma", .25).map((v) => 1 + v),
			uGain: wheel("gainX", "gainY", "gain", .3).map((v) => 1 + v)
		}
	},
	{
		name: "curves",
		u: { uMix: .8 }
	},
	{
		name: "hsl",
		u: {
			uHue: n(h, "hue") / 360,
			uRange: n(h, "range", 30) / 360,
			uShift: n(h, "shift") / 360,
			uSatS: n(h, "sat") / 100,
			uLight: n(h, "light") / 100
		}
	}
];
const now = gradeAt(gradeOf(gradeEffect(withGrade({
	...newClip("v", 0, 10, {
		kind: "color",
		color: "#000000"
	}, "x"),
	effects
}))), 0);
if (now.steps.length !== 1 || now.steps[0]?.kind !== "serial") throw new Error("expected one node");
const node = now.steps[0].node;
writeFileSync(`${process.argv[2]}/migfix.json`, JSON.stringify({
	legacy,
	curve: Array.from(curvesImage(set)),
	node: nodeUniforms(node),
	nodeCurve: Array.from(curvesImage(node.curves))
}));
console.log("migration fixture written");
//#endregion
export {};
