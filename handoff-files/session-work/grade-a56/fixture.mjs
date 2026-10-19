import { writeFileSync } from "node:fs";
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
//#region editor/app/src/model/types.ts
let n = 0;
function uid(prefix = "c") {
	n += 1;
	return `${prefix}${Date.now().toString(36)}${n.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
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
/** The node doesn't change any color (whatever its qualifier or window says). */
function idle(n) {
	const p = nodeParts(n);
	return !p.basic && !p.wheels && !p.curves && !p.hsl && !p.hue;
}
/** One kind of step from a group's nodes: none, a single serial node, or the group. */
function group(kind, nodes) {
	if (nodes.length === 0) return [];
	if (nodes.length === 1) return [{
		kind: "serial",
		node: nodes[0]
	}];
	return [{
		kind,
		nodes
	}];
}
/**
* What to draw for a grade. Nodes that change nothing are left out (in a
* layer mix only from the bottom, since a node higher up still shows the
* picture as it came in, over the nodes under it).
*/
function planGrade(g, matteNode = null) {
	const steps = [];
	for (const s of g.steps) {
		const nodes = s.kind === "serial" ? [s.node] : s.nodes;
		const shown = matteNode ? nodes.find((n) => n.id === matteNode) : void 0;
		if (shown) return {
			steps,
			matte: shown
		};
		if (s.kind === "serial") steps.push(...idle(s.node) ? [] : [s]);
		else if (s.kind === "parallel") steps.push(...group("parallel", s.nodes.filter((n) => !idle(n))));
		else {
			const from = s.nodes.findIndex((n) => !idle(n));
			steps.push(...group("layer", from < 0 ? [] : s.nodes.slice(from)));
		}
	}
	return {
		steps,
		matte: null
	};
}
const wheel = (n, w, k) => {
	const c = wheelColor(n.p[`${w}X`] ?? 0, n.p[`${w}Y`] ?? 0);
	const l = (n.p[w] ?? 0) / 100;
	return c.map((v) => v * k + l);
};
/** Lift, gamma and gain as the Color wheels effect has always worked them out, and the offset wheel. */
function wheelVectors(n) {
	return {
		lift: wheel(n, "lift", .15).map((v) => v * .5),
		gamma: wheel(n, "gamma", .25).map((v) => 1 + v),
		gain: wheel(n, "gain", .3).map((v) => 1 + v),
		offset: wheel(n, "offset", .2).map((v) => v * .5)
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
const luma = (c) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
const smoothstep = (a, b, x) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
const fract = (x) => x - Math.floor(x);
const lerp = (a, b, t) => a * (1 - t) + b * t;
const map3 = (c, f) => [
	f(c[0], 0),
	f(c[1], 1),
	f(c[2], 2)
];
function rgb2hsv([r, g, b]) {
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	let h = 0;
	if (d > 0) h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [
		fract(h / 6),
		max > 0 ? d / max : 0,
		max
	];
}
function hsv2rgb([h, s, v]) {
	const k = (n) => fract(h + n / 3) * 6;
	return map3([
		0,
		2,
		1
	], (n) => v * lerp(1, Math.max(0, Math.min(1, Math.abs(k(n) - 3) - 1)), s));
}
/** Basic correction (exposure, white balance, tones, contrast around a pivot, saturation). */
function basicPx(c, u) {
	const [exposure, contrast, pivot, hi] = u.uBasicA;
	const [sh, wh, bl, temp] = u.uBasicB;
	const [tint, sat, vib] = u.uBasicC;
	let x = map3(c, (v) => v * 2 ** exposure);
	x = [
		x[0] * (1 + temp * .25 + tint * .1),
		x[1] * (1 - tint * .2),
		x[2] * (1 - temp * .25 + tint * .1)
	];
	let l = luma(x);
	const hw = smoothstep(.35, 1, l);
	const sw = 1 - smoothstep(0, .65, l);
	x = map3(x, (v) => v + v * hi * .6 * hw);
	x = map3(x, (v) => v + sh * .35 * sw * (1 - v));
	const lo = -bl * .15;
	const top = 1 - wh * .2;
	x = map3(x, (v) => (v - lo) / Math.max(.05, top - lo));
	x = map3(x, (v) => (v - pivot) * (1 + contrast) + pivot);
	l = luma(x);
	const k = sat * (1 + vib * (1 - (Math.max(...x) - Math.min(...x))));
	return map3(x, (v) => Math.max(0, lerp(l, v, k)));
}
function wheelsPx(c, lift, gamma, gain) {
	return map3(c, (v, i) => Math.max(0, v * gain[i] + lift[i] * (1 - v)) ** (1 / Math.max(gamma[i], .05)));
}
/** Curves, read the way the GPU reads the 256-step curves picture (blended between steps). */
function curvesPx(c, set, amount) {
	const img = curvesImage(set);
	const look = (v, ch) => {
		const x = v * 255;
		const i = Math.min(254, Math.floor(x));
		return lerp(img[i * 4 + ch], img[(i + 1) * 4 + ch], x - i) / 255;
	};
	return map3(c, (v, i) => {
		const x = Math.max(0, Math.min(1, v));
		return lerp(x, look(x, i), amount);
	});
}
function hslPx(c, hue, range, shift, sat, light) {
	const h = rgb2hsv(c);
	const d = Math.abs(fract(h[0] - hue + .5) - .5);
	const w = (1 - smoothstep(range * .5, range, d)) * smoothstep(.05, .2, h[1]);
	return hsv2rgb([
		fract(h[0] + shift * w),
		Math.max(0, Math.min(1, h[1] * (1 + sat * w))),
		Math.max(0, Math.min(4, h[2] * (1 + light * w)))
	]);
}
/** How much a node applies at a pixel (1 everywhere without a qualifier or window). `uv` is 0–1 across and down. */
function mattePx(n, c, uv, aspect) {
	const u = nodeUniforms(n);
	let m = 1;
	if (n.qualifier) {
		const [hue, half, soft, inv] = u.uQHue;
		const [sLo, sHi, lLo, lHi] = u.uQBand;
		const s = Math.max(soft, 1e-4);
		const x = map3(c, (v) => Math.max(0, Math.min(1, v)));
		const h = rgb2hsv(x);
		const d = Math.abs(fract(h[0] - hue + .5) - .5);
		const hk = half >= .5 ? 1 : 1 - smoothstep(half, half + s, d);
		const band = (v, lo, hi) => smoothstep(lo - s, lo, v) * (1 - smoothstep(hi, hi + s, v));
		const q = hk * band(h[1], sLo, sHi) * band(luma(x), lLo, lHi);
		m *= inv > .5 ? 1 - q : q;
	}
	if (n.window) {
		const [cx, cy, hw, hh] = u.uWin;
		const [shape, soft, inv] = u.uWinOpt;
		const dx = (uv[0] - cx) * aspect / hw;
		const dy = (uv[1] - cy) / hh;
		const d = shape > .5 ? Math.max(Math.abs(dx), Math.abs(dy)) - 1 : Math.hypot(dx, dy) - 1;
		const a = smoothstep(0, 1, -d / Math.max(soft, 1e-4));
		m *= inv > .5 ? 1 - a : a;
	}
	return m;
}
/** One node on one pixel: its correction, mixed over `base` by its matte. */
function nodePx(n, c, base, uv, aspect) {
	const u = nodeUniforms(n);
	const m = mattePx(n, c, uv, aspect);
	let x = c;
	if (u.uUseBasic) x = basicPx(x, u);
	if (u.uUseWheels) {
		x = wheelsPx(x, u.uLift, u.uGamma, u.uGain);
		x = map3(x, (v, i) => v + u.uOffset[i]);
	}
	if (u.uUseCurves && n.curves) x = curvesPx(x, n.curves, u.uCurveMix);
	if (u.uUseHsl) {
		const [hue, range, shift, sat] = u.uHslA;
		x = hslPx(x, hue, range, shift, sat, u.uHslLight);
	}
	if (u.uUseHue) {
		const h = rgb2hsv(map3(x, (v) => Math.max(0, v)));
		x = hsv2rgb([
			fract(h[0] + u.uBasicC[3]),
			h[1],
			h[2]
		]);
	}
	return map3(base, (b, i) => lerp(b, x[i], m));
}
/** A whole plan on one pixel, as the GPU passes do it. */
function gradePx(plan, c, uv = [.5, .5], aspect = 16 / 9) {
	let cur = c;
	for (const s of plan.steps) {
		const input = cur;
		if (s.kind === "serial") cur = nodePx(s.node, input, input, uv, aspect);
		else if (s.kind === "parallel") {
			cur = input;
			for (const n of s.nodes) {
				const o = nodePx(n, input, input, uv, aspect);
				cur = map3(cur, (v, i) => Math.max(0, v + o[i] - input[i]));
			}
		} else {
			cur = nodePx(s.nodes[0], input, input, uv, aspect);
			for (const n of s.nodes.slice(1)) cur = nodePx(n, input, cur, uv, aspect);
		}
	}
	if (plan.matte) {
		const m = mattePx(plan.matte, cur, uv, aspect);
		return [
			m,
			m,
			m
		];
	}
	return cur;
}
//#endregion
//#region ../../../../../../tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/fixture.ts
const nodes = [
	{
		...newNode(),
		p: {
			exposure: .7,
			contrast: 30,
			pivot: 40,
			highlights: -20,
			shadows: 25,
			whites: 10,
			blacks: -15,
			temperature: 30,
			tint: -20,
			saturation: 130,
			vibrance: 20
		}
	},
	{
		...newNode(),
		p: {
			liftX: .3,
			liftY: -.2,
			lift: 10,
			gammaX: -.4,
			gamma: -15,
			gainY: .5,
			gain: 20,
			offsetX: .2,
			offset: 5
		}
	},
	{
		...newNode(),
		p: {
			hslHue: 20,
			hslRange: 50,
			hslShift: 30,
			hslSat: 40,
			hslLight: -20,
			hue: 45
		}
	},
	{
		...newNode(),
		p: { exposure: 1 },
		qualifier: {
			hue: 20,
			hueWidth: 80,
			satLo: 20,
			satHi: 90,
			lumLo: 10,
			lumHi: 90,
			soft: 20,
			invert: false
		},
		window: {
			shape: "circle",
			x: .4,
			y: .6,
			w: .5,
			h: .4,
			soft: 40,
			invert: false
		}
	},
	{
		...newNode(),
		p: { gain: -30 },
		window: {
			shape: "rect",
			x: .5,
			y: .5,
			w: .6,
			h: .3,
			soft: 20,
			invert: true
		}
	}
];
const pixels = [];
for (let i = 0; i < 64; i++) pixels.push([
	i * 37 % 64 / 63,
	i * 11 % 64 / 63,
	i * 53 % 64 / 63
]);
const out = nodes.map((n) => {
	const now = gradeAt({ steps: [{
		kind: "serial",
		node: n
	}] }, 0);
	const step = now.steps[0];
	if (step?.kind !== "serial") throw new Error("no node");
	const plan = planGrade(now);
	const expected = pixels.map((c, i) => gradePx(plan, c, [(i % 8 + .5) / 8, 1 - (Math.floor(i / 8) + .5) / 8], 1));
	return {
		uniforms: nodeUniforms(step.node),
		expected
	};
});
writeFileSync(`${process.argv[2]}/fixture.json`, JSON.stringify({
	pixels,
	nodes: out
}));
console.log("fixture written");
//#endregion
export {};
