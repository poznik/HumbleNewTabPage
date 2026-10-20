/* Фон «символы на ветру».
 *
 * Повторяет фон экрана новой сессии в Claude Code (десктоп): сетка
 * моноширинных глифов, которые проступают там, где по странице идёт порыв
 * ветра, и гаснут за ним. Клик по пустому месту пускает волну с синим
 * свечением, быстрое движение мыши подогревает воздух по следу.
 *
 * Реализация своя, на WebGL2, два прохода на кадр:
 *  1. поле ветра — в маленькую текстуру, по два отсчёта на ячейку сетки:
 *     яркость, направление ветра, доля проявления;
 *  2. глифы — полноэкранный проход: ячейка берёт глиф из атласа и яркость из
 *     поля, сильнее светятся края штрихов, обращённые к ветру.
 * Анимация идёт три минуты, затем поле гаснет и ждёт движения мыши, чтобы
 * проявиться снова; при prefers-reduced-motion рисуется один неподвижный кадр.
 *
 * Подключение: HumbleTexture.mount(контейнер) → {destroy}. Цвет глифов —
 * CSS color контейнера, шрифт — его font-family.
 */
(function() {
'use strict';

var P = {
	cell: 6.5,          // ширина ячейки в CSS px, высота вдвое больше
	glyph: 9,           // кегль глифа в CSS px
	weight: 300,        // начертание на Retina, без неё на 100 жирнее
	alpha: 0.26,        // непрозрачность обычного глифа
	headroom: 3,        // во сколько раз ярче обычного светится глиф в волне
	frameMs: 40,        // 25 кадров в секунду
	rippleFrameMs: 10,  // пока идёт волна — каждый кадр экрана
	budget: 180,        // секунд движения до затихания
	settle: 8,          // секунд на затихание
	resume: 3,          // секунд на разгон после затихания
	reveal: 4,          // секунд на проявление при открытии
	maxPixels: 21e6,    // предел размера холста в физических пикселях
	glow: {light: [0, 0.25, 1], dark: [0.1, 0.68, 1]}
};

// Наборы глифов. Каждая ячейка идёт по набору со своего места и в своём
// темпе; набор выбирается при открытии, не повторяя прошлый.
var LOOKS = {
	mixed: 'a0bcKde1fgRhi2jkAlm3noEpq4rsGtu5vwMxy6zaS7bcT8deW9',
	lettered: 'abcdeFghijk4lmnoPqrstU7vwxyzAbecS2dfhK9gimOu',
	figured: '0a1b2c3D4e5f6g7H8i9j0k1L2m3n4p5Q6r7s8t9U0v1w2X3y4z'
};
var RECENT_KEY = 'texture.recent';

var MAX_TAPS = 6;
var MAX_TRAIL = 32;
var TAP_LIFE = 3.6;
var TRAIL_LIFE = 2.4;

var INTERACTIVE = [
	'a', 'button', 'input', 'textarea', 'select', 'label', 'summary', 'dialog',
	'[contenteditable]:not([contenteditable="false"])', '[draggable="true"]',
	'[tabindex]:not([tabindex="-1"])', '[role]', '#options', '.menu'
].join(',');

// --- шейдеры ---

var HASH = `
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float unit(uint h) { return float(h >> 8u) / 16777216.0; }
`;

// Градиентный шум на целочисленной решётке, примерно от -1 до 1.
var NOISE = `
vec3 slope(ivec3 i, uint salt) {
  uint h = pcg(uint(i.x) ^ pcg(uint(i.y) ^ pcg(uint(i.z) ^ u_seed ^ salt)));
  return vec3(uvec3(h, h >> 10u, h >> 20u) & 1023u) * (2.0 / 1023.0) - 1.0;
}
float noise(vec3 p, uint salt) {
  vec3 fl = floor(p), f = p - fl;
  ivec3 i = ivec3(fl);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(slope(i, salt), f);
  float n100 = dot(slope(i + ivec3(1, 0, 0), salt), f - vec3(1, 0, 0));
  float n010 = dot(slope(i + ivec3(0, 1, 0), salt), f - vec3(0, 1, 0));
  float n110 = dot(slope(i + ivec3(1, 1, 0), salt), f - vec3(1, 1, 0));
  float n001 = dot(slope(i + ivec3(0, 0, 1), salt), f - vec3(0, 0, 1));
  float n101 = dot(slope(i + ivec3(1, 0, 1), salt), f - vec3(1, 0, 1));
  float n011 = dot(slope(i + ivec3(0, 1, 1), salt), f - vec3(0, 1, 1));
  float n111 = dot(slope(i + ivec3(1, 1, 1), salt), f - vec3(1, 1, 1));
  return 1.5 * mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
vec2 noise2(vec2 p, float z, uint salt) {
  return vec2(noise(vec3(p, z), salt), noise(vec3(p + 31.7, z + 5.0), salt + 1u));
}
`;

// Волны от кликов. Возвращает толчок воздуха в CSS px (xy), подъём поля (z),
// возбуждение (w); в glow — свечение фронта (x) и послесвечение (y).
var RIPPLES = `
uniform float u_now;
uniform int u_tapCount;
uniform vec4 u_taps[${MAX_TAPS}];
vec4 ripples(vec2 p, out vec2 glow) {
  vec4 sum = vec4(0.0);
  glow = vec2(0.0);
  for (int i = 0; i < ${MAX_TAPS}; i++) {
    if (i >= u_tapCount) break;
    vec4 tap = u_taps[i];
    float age = u_now - tap.z;
    vec2 away = p - tap.xy;
    float d = length(away);
    float behind = 620.0 * (1.0 - exp(-age / 1.3)) - d;
    float width = 85.0 + 60.0 * age;
    float front = smoothstep(-16.0, 10.0, behind) * exp(-behind * behind / (width * width));
    float swell = tap.w * exp(-age / 1.5) * front;
    sum.xy += away / max(d, 1.0) * 44.0 * swell;
    sum.z += 1.9 * swell * (0.25 + 0.75 * cos(behind * 6.2831853 / 130.0));
    sum.w += swell;
    float wake = smoothstep(0.0, 70.0, behind) * exp(-max(behind, 0.0) / 260.0);
    glow.x += tap.w * (exp(-age) * front + 0.7 * exp(-age / 1.3) * wake);
    glow.y += tap.w * (1.0 - exp(-age / 0.2)) * exp(-age / 1.2) * wake;
  }
  return sum;
}
`;

var FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 c = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Проход 1: поле ветра.
var FIELD_FS = `#version 300 es
precision highp float;
precision highp int;
uniform uint u_seed;
uniform float u_time, u_reveal;
uniform vec2 u_origin, u_step, u_size;
uniform vec4 u_wind;  // курс (рад), скорость (px/с), длина и ширина порыва (px)
uniform vec2 u_bend;  // размах и масштаб изгиба пути (px)
uniform int u_trailCount;
uniform vec4 u_trail[${MAX_TRAIL}];     // середина отрезка следа (xy), тепло, 1/радиус²
uniform vec4 u_trailDir[${MAX_TRAIL}];  // направление отрезка (xy), полудлина
out vec4 o;

const float TAU = 6.2831853;
const float CURL = 0.65;    // насколько завиваются края порывов
const float STREAK = 0.4;   // насколько порыв разбит на полосы
const float TAIL = 0.35;    // насколько длинно тает хвост порыва
const float LEVEL = 0.42;   // порог плотности, выше которого воздух светится
const float BAND = 0.09;    // мягкость порога
${HASH}
${NOISE}
${RIPPLES}

float warmth(vec2 p) {
  float sum = 0.0;
  for (int i = 0; i < ${MAX_TRAIL}; i++) {
    if (i >= u_trailCount) break;
    vec4 seg = u_trail[i];
    vec3 dir = u_trailDir[i].xyz;
    vec2 d = p - seg.xy;
    d -= dir.xy * clamp(dot(d, dir.xy), -dir.z, dir.z);
    sum += seg.z * exp(-dot(d, d) * seg.w);
  }
  return 1.0 - exp(-1.5 * sum);
}

// Плотность воздуха в системе ветра (x — вдоль, y — поперёк): четыре
// масштаба порывов, тонкие пряди между ними и длинная зыбь, которая держит
// порывы группами.
float density(vec2 q, float drift, float span) {
  float sum = 0.0, amp = 1.0, norm = 0.0;
  vec2 size = vec2(0.85, 0.75) * u_wind.zw;
  for (int i = 0; i < 4; i++) {
    float k = float(i);
    vec3 at = vec3((q.x - drift * (1.0 + 0.1 * k)) / size.x, q.y / size.y,
                   u_time * (0.09 + 0.054 * k) + 11.0 * k);
    sum += amp * noise(at, 20u + uint(i));
    norm += amp * amp;
    amp *= 0.52;
    size *= vec2(0.5, 0.58);
  }
  float strand = 1.0 - abs(noise(vec3((q.x - 1.15 * drift) / (0.7 * u_wind.z),
                                      q.y / (0.95 * u_wind.w), u_time * 0.15 + 2.0), 30u));
  float lag = 0.5 * span * noise(vec3(u_time * 0.045, q.y / (2.5 * u_wind.w), 7.0), 31u);
  float swell = cos((q.x - drift + lag) * TAU / span);
  return sum * inversesqrt(norm) + 0.25 * (strand * strand * strand - 0.35) + 0.3 * swell;
}

void main() {
  vec2 p = u_origin + gl_FragCoord.xy * u_step;
  vec2 heading = vec2(cos(u_wind.x), sin(u_wind.x));
  vec2 across = vec2(-heading.y, heading.x);
  float drift = u_wind.y * (u_time + noise(vec3(u_time * 0.09, 3.7, 0.0), 1u));
  float span = 0.58 * (abs(heading.x) * u_size.x + abs(heading.y) * u_size.y);

  vec4 hand = vec4(0.0);
  float warm = 0.0;
  if (u_tapCount + u_trailCount > 0) {
    // Чуть сдвинутая точка — чтобы волна не была ровным кругом.
    vec2 near = p + 24.0 * noise2(p / 95.0, u_now * 0.12, 2u);
    vec2 glow;
    hand = ripples(near, glow);
    warm = warmth(near);
    hand.zw += vec2(0.25, 0.05) * warm;
  }

  // Путь ветра медленно изгибается.
  vec2 from = p - hand.xy;
  vec2 turn = noise2(from / u_bend.y, u_time * 0.04, 4u);
  vec2 bent = from + u_bend.x * turn;
  vec2 q = vec2(dot(bent, heading), dot(bent, across));

  // Вихри: крупные, мелкие и совсем мелкие складки, чтобы край порыва не шёл
  // вдоль строк сетки.
  vec2 riding = vec2(q.x - 0.85 * drift, q.y);
  vec2 eddy = noise2(riding / (1.15 * u_wind.w), u_time * 0.12, 6u);
  vec2 folded = riding + CURL * 0.9 * u_wind.w * eddy;
  vec2 fine = noise2(folded / (0.38 * u_wind.w), u_time * 0.18, 8u);
  vec2 tiny = noise2((folded + 0.3 * u_wind.w * fine) / 24.0, u_time * 0.07, 10u);
  float stirred = 1.0 + 0.9 * min(hand.w, 1.5);
  vec2 curled = q + CURL * stirred * (u_wind.w * (0.9 * eddy + 0.3 * fine) + 18.0 * tiny);
  vec2 blows = normalize(heading + 0.6 * turn + hand.xy / 14.0
    + CURL * ((0.45 * eddy.x + 0.25 * fine.x) * heading + (0.45 * eddy.y + 0.25 * fine.y) * across));

  float here = density(curled, drift, span);
  float field = here + hand.z;
  float lowest = LEVEL - BAND - 0.55 * TAIL;
  float strength = 0.0, streaks = 0.0;
  if (field > lowest || warm > 0.0) {
    float thread = noise(vec3((curled.x - 1.6 * drift) / 140.0, curled.y / 30.0, u_time * 0.16), 12u);
    streaks = 1.0 - smoothstep(0.0, 0.5, abs(thread));
  }
  if (field > lowest) {
    // Порыв вспыхивает сразу с той стороны, куда идёт, и тает позади: даже
    // по неподвижному кадру видно, куда дует.
    float ahead = density(curled + vec2(56.0, 0.0), drift, span);
    float leaving = smoothstep(-0.05, 0.07, ahead - here);
    float lit = smoothstep(LEVEL - BAND - 0.55 * TAIL * leaving, LEVEL + BAND, field);
    strength = lit * lit * mix(0.45, 1.0, clamp((field - LEVEL) / 0.45, 0.0, 1.0)) * (0.82 + 0.18 * fine.y);
    strength *= mix(1.0, 0.25 + 0.95 * streaks, STREAK);
  }
  if (warm > 0.0) {
    // Подогретый рукой воздух светится сам, своим мелким зерном.
    float grain = 0.55 * fine.y + 0.45 * tiny.x + 0.3 * (streaks - 0.4);
    strength = 1.0 - (1.0 - strength) * (1.0 - 0.85 * warm * smoothstep(-0.5, 0.25, grain));
  }
  float shown = max(u_reveal, min(1.0, 2.0 * hand.w + warm));
  o = vec4(strength * shown, blows * 0.5 + 0.5, shown);
}
`;

// Проход 2: глифы.
var GLYPH_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_field, u_atlas;
uniform ivec2 u_cell, u_buffer;
uniform uint u_seed;
uniform float u_time;
uniform int u_count;
uniform vec4 u_cellCss;  // центр первой ячейки и размер ячейки в CSS px
uniform vec3 u_ink, u_glowInk;
uniform float u_inkAlpha;
out vec4 o;

const float FLICK = 1.2;     // смен глифа в секунду ветра
const float FRICTION = 0.6;  // насколько свет держится за наветренные края
const float REST = 0.03;     // остаточный свет рядом с порывом
const float HEAD = ${P.headroom.toFixed(1)};
${HASH}
${RIPPLES}

ivec2 home, lo, hi;
float inkAt(ivec2 at) { return texelFetch(u_atlas, clamp(home + at, lo, hi), 0).r; }

void main() {
  ivec2 px = ivec2(int(gl_FragCoord.x), u_buffer.y - 1 - int(gl_FragCoord.y));
  ivec2 cell = px / u_cell;
  ivec2 inside = px - cell * u_cell;
  uint h = pcg(uint(cell.x) * 0x9E3779B9u ^ pcg(uint(cell.y) ^ u_seed));

  vec2 glow = vec2(0.0);
  float roused = 0.0;
  if (u_tapCount > 0) {
    roused = ripples(u_cellCss.xy + vec2(cell) * u_cellCss.zw, glow).w;
    glow *= 0.65 + 0.35 * unit(pcg(h ^ 0x51u));
  }
  vec4 field = texture(u_field, (vec2(px) + 0.5) / vec2(u_buffer));
  if (field.r <= 0.0 && glow.x < 0.04 && glow.y < 0.015) discard;

  // Ячейка идёт по набору со своего места и в своём темпе, а волна
  // прокручивает её дальше.
  uint pace = pcg(h);
  float steps = floor(u_time * FLICK * (0.6 + 0.8 * unit(pace)) + unit(pcg(pace)))
              + floor(6.0 * roused + unit(pcg(pace ^ 0x33u)));
  int g = int(((h >> 8u) + uint(max(steps, 0.0))) % uint(u_count));
  home = ivec2(g & 15, g >> 4) * u_cell;
  lo = home;
  hi = home + u_cell - 1;

  float ink = inkAt(inside);
  if (ink <= 0.0) discard;

  // Край штриха, обращённый к ветру, ловит больше света.
  vec2 rise = vec2(inkAt(inside + ivec2(1, 0)) - inkAt(inside - ivec2(1, 0)),
                   inkAt(inside + ivec2(0, 1)) - inkAt(inside - ivec2(0, 1)));
  float steep = length(rise);
  vec2 blows = field.gb * 2.0 - 1.0;
  float facing = steep > 0.02 ? max(0.0, dot(rise / steep, blows)) : 0.35;
  float light = min(1.0, field.r * mix(1.0, 0.45 + 1.1 * facing, FRICTION)) + REST * field.a;

  // Холст показан в HEAD раз ярче, а обычный свет рисуется во столько же раз
  // слабее — остаётся запас под свечение волны.
  float tint = smoothstep(0.04, 0.3, glow.x);
  float bright = min(1.0, light) * mix(u_inkAlpha, HEAD, tint);
  float after = 0.3 * glow.y * field.a;
  float a = ink * min(1.0, (bright + after) / HEAD);
  o = vec4((mix(u_ink, u_glowInk, tint) * bright + u_glowInk * after) / (bright + after + 0.0001) * a, a);
}
`;

// --- вспомогательное ---

function ease(x) {
	x = Math.min(1, Math.max(0, x));
	return x * x * (3 - 2 * x);
}

// mulberry32: детерминированный генератор от зерна
function random(seed) {
	return function() {
		seed = (seed + 0x6D2B79F5) | 0;
		var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// набор глифов, отличный от прошлого открытия
function pickLook(rand) {
	var last = null;
	try {
		last = localStorage.getItem(RECENT_KEY);
	} catch (e) {}
	var keys = Object.keys(LOOKS).filter(function(key) { return key !== last; });
	var look = keys[Math.floor(rand() * keys.length)];
	try {
		localStorage.setItem(RECENT_KEY, look);
	} catch (e) {}
	return look;
}

// ветер: дует вниз-вправо или вниз-влево под углом 18–42° к горизонту
function pickWind(rand) {
	var range = function(a, b) { return a + (b - a) * rand(); };
	var tilt = range(Math.PI / 10, Math.PI / 4.3);
	return {
		heading: rand() < 0.5 ? tilt : Math.PI - tilt,
		speed: range(42, 64),
		length: range(380, 560),
		width: range(120, 190),
		bend: range(60, 110),
		bendScale: range(300, 440)
	};
}

// сетка ячеек под размер контейнера в физических пикселях
function layout(deviceWidth, deviceHeight, dpr) {
	var cw = Math.max(5, Math.round(P.cell * dpr));
	var ch = cw * 2;
	var cols = Math.ceil(deviceWidth / cw);
	var rows = Math.ceil(deviceHeight / ch);
	var over = cols * cw * rows * ch / P.maxPixels;
	if (over > 1) {
		cols = Math.floor(cols / Math.sqrt(over));
		rows = Math.floor(rows / Math.sqrt(over));
	}
	return {
		cw: cw,
		ch: ch,
		cols: cols,
		rows: rows,
		left: Math.round((deviceWidth - cols * cw) / 2),
		top: Math.round((deviceHeight - rows * ch) / 2),
		dpr: dpr
	};
}

// атлас глифов: 16 в ряд, по ячейке на глиф, в канале альфа
function buildAtlas(chars, family, cw, ch, dpr) {
	var weight = dpr >= 1.5 ? P.weight : P.weight + 100;
	var canvas = document.createElement('canvas');
	var ctx = canvas.getContext('2d', {willReadFrequently: true});
	ctx.font = weight + ' 100px ' + family;
	var ratio = ctx.measureText('0').width / 100 || 0.6;
	var px = Math.min(Math.round(P.glyph * dpr), Math.floor((cw - 2) / ratio));

	canvas.width = 16 * cw;
	canvas.height = Math.ceil(chars.length / 16) * ch;
	ctx.font = weight + ' ' + px + 'px ' + family;
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = '#fff';
	var m = ctx.measureText('Mg|');
	var baseline = Math.round((ch - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent);
	var left = Math.floor((cw - ctx.measureText('0').width) / 2);
	chars.forEach(function(c, i) {
		var x = i % 16 * cw;
		var y = Math.floor(i / 16) * ch;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, cw, ch);
		ctx.clip();
		ctx.fillText(c, x + left, y + baseline);
		ctx.restore();
	});
	var rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	var alpha = new Uint8Array(canvas.width * canvas.height);
	for (var i = 0; i < alpha.length; i++)
		alpha[i] = rgba[i * 4 + 3];
	return {width: canvas.width, height: canvas.height, data: alpha};
}

// глифы набора той же ширины, что «0», — остальные шрифт рисует не моноширинно
function usableChars(look, family) {
	var ctx = document.createElement('canvas').getContext('2d');
	ctx.font = '400 100px ' + family;
	var width = ctx.measureText('0').width;
	var chars = LOOKS[look].split('').filter(function(c) {
		return Math.abs(ctx.measureText(c).width - width) < 0.5;
	});
	return chars.length ? chars : ['.'];
}

// любой CSS-цвет → [r, g, b] 0..1 и альфа
function readColor(css) {
	var ctx = document.createElement('canvas').getContext('2d', {willReadFrequently: true});
	ctx.fillStyle = css;
	ctx.fillRect(0, 0, 1, 1);
	var d = ctx.getImageData(0, 0, 1, 1).data;
	return {rgb: [d[0] / 255, d[1] / 255, d[2] / 255], alpha: d[3] / 255};
}

function compile(gl, fs) {
	var program = gl.createProgram();
	[[gl.VERTEX_SHADER, FULLSCREEN_VS], [gl.FRAGMENT_SHADER, fs]].forEach(function(pair) {
		var shader = gl.createShader(pair[0]);
		gl.shaderSource(shader, pair[1]);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
			console.warn('texture:', gl.getShaderInfoLog(shader));
		gl.attachShader(program, shader);
		gl.deleteShader(shader);
	});
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.warn('texture:', gl.getProgramInfoLog(program));
		gl.deleteProgram(program);
		return null;
	}
	return program;
}

function uniforms(gl, program, names) {
	var map = {};
	names.forEach(function(name) {
		map[name] = gl.getUniformLocation(program, 'u_' + name);
	});
	return map;
}

// --- рука: клики и след мыши ---

function createHand() {
	var taps = [];
	var trail = [];
	var last = null;
	var anchor = null;
	var speed = 0;
	var state = {
		taps: new Float32Array(MAX_TAPS * 4),
		trail: new Float32Array(MAX_TRAIL * 4),
		trailDir: new Float32Array(MAX_TRAIL * 4),
		tapCount: 0,
		trailCount: 0
	};

	return {
		// след оставляют только быстрые движения: от 60 до 800 px/с
		move: function(x, y, t) {
			if (!last || t - last.t > 0.25) {
				last = anchor = {x: x, y: y, t: t};
				speed = 0;
				return;
			}
			var dt = Math.max(t - last.t, 1 / 240);
			speed += (Math.hypot(x - last.x, y - last.y) / dt - speed) * Math.min(1, dt / 0.08);
			last = {x: x, y: y, t: t};
			var length = Math.hypot(x - anchor.x, y - anchor.y);
			if (length < 18 || t - anchor.t < 0.035)
				return;
			var from = anchor;
			anchor = last;
			var stir = ease((speed - 60) / (800 - 60));
			if (stir < 0.04)
				return;
			trail.push({
				x: (x + from.x) / 2, y: (y + from.y) / 2, t: t,
				force: stir * length / (length + 90),
				dx: (x - from.x) / 2, dy: (y - from.y) / 2
			});
			if (trail.length > MAX_TRAIL)
				trail.shift();
		},
		tap: function(x, y, t) {
			taps.push({x: x, y: y, t: t});
			if (taps.length > MAX_TAPS)
				taps.shift();
		},
		leave: function() {
			last = null;
		},
		busy: function(now) {
			return taps.some(function(tap) { return now - tap.t < TAP_LIFE; }) ||
				trail.some(function(seg) { return now - seg.t < TRAIL_LIFE; });
		},
		rippling: function(now) {
			return taps.some(function(tap) { return now - tap.t < TAP_LIFE; });
		},
		frame: function(now) {
			taps = taps.filter(function(tap) { return now - tap.t < TAP_LIFE; });
			trail = trail.filter(function(seg) { return now - seg.t < TRAIL_LIFE; });
			state.now = now;
			state.tapCount = taps.length;
			taps.forEach(function(tap, i) {
				state.taps.set([tap.x, tap.y, tap.t, 1], i * 4);
			});
			var n = 0;
			trail.forEach(function(seg) {
				var age = Math.max(0, now - seg.t);
				var warmth = seg.force * (1 - Math.exp(-age / 0.05)) * Math.exp(-age / 0.65);
				if (warmth < 0.002)
					return;
				var reach = 50 + 40 * age;
				var half = Math.hypot(seg.dx, seg.dy) || 1;
				state.trail.set([seg.x, seg.y, warmth, 1 / (reach * reach)], n * 4);
				state.trailDir.set([seg.dx / half, seg.dy / half, half, 0], n * 4);
				n++;
			});
			state.trailCount = n;
			return state;
		}
	};
}

// --- монтирование ---

function mount(container) {
	var noop = {destroy: function() {}};
	var win = container.ownerDocument.defaultView;
	if (win.matchMedia('(prefers-contrast: more), (forced-colors: active)').matches ||
		!('devicePixelContentBoxSize' in win.ResizeObserverEntry.prototype))
		return noop;

	var canvas = document.createElement('canvas');
	var gl = canvas.getContext('webgl2', {
		alpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		premultipliedAlpha: true,
		preserveDrawingBuffer: false,
		powerPreference: 'low-power',
		failIfMajorPerformanceCaveat: true
	});
	if (!gl)
		return noop;
	var info = gl.getExtension('WEBGL_debug_renderer_info');
	if (info && /swiftshader|llvmpipe|softpipe|software|warp|basic render/i.test(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)))
		return noop;

	var fieldProgram = compile(gl, FIELD_FS);
	var glyphProgram = compile(gl, GLYPH_FS);
	if (!fieldProgram || !glyphProgram)
		return noop;

	var seed = crypto.getRandomValues(new Uint32Array(1))[0];
	var rand = random(seed);
	var look = pickLook(rand);
	var wind = pickWind(rand);
	var family = win.getComputedStyle(container).fontFamily;
	var still = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var hand = createHand();
	var t0 = performance.now();
	var clock = function() { return (performance.now() - t0) / 1000; };

	var F = uniforms(gl, fieldProgram, ['seed', 'time', 'reveal', 'origin', 'step', 'size', 'wind', 'bend',
		'now', 'tapCount', 'taps', 'trailCount', 'trail', 'trailDir']);
	var G = uniforms(gl, glyphProgram, ['field', 'atlas', 'cell', 'buffer', 'seed', 'time', 'count', 'cellCss',
		'ink', 'glowInk', 'inkAlpha', 'now', 'tapCount', 'taps']);

	gl.useProgram(fieldProgram);
	gl.uniform1ui(F.seed, seed);
	gl.uniform4f(F.wind, wind.heading, wind.speed, wind.length, wind.width);
	gl.uniform2f(F.bend, wind.bend, wind.bendScale);
	gl.useProgram(glyphProgram);
	gl.uniform1ui(G.seed, seed);
	gl.uniform1i(G.field, 0);
	gl.uniform1i(G.atlas, 1);

	var fieldTexture = gl.createTexture();
	var atlasTexture = gl.createTexture();
	[fieldTexture, atlasTexture].forEach(function(texture, i) {
		gl.activeTexture(gl.TEXTURE0 + i);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		var filter = i === 0 ? gl.LINEAR : gl.NEAREST;
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	});
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	var framebuffer = gl.createFramebuffer();

	var grid = null;          // текущая раскладка сетки
	var atlasCell = 0;        // ширина ячейки, под которую собран атлас
	var active = 0;           // секунд работы анимации
	var windTime = rand() * 64;
	var deadline = P.budget;  // когда начать затихать
	var wokeAt = -P.resume;   // когда последний раз проснулась
	var revealFrom = 0;       // откуда отсчитывать проявление поля
	var reveal = still ? 1 : 0;
	var calm = false;
	var destroyed = false;
	var timer = 0;
	var frameRequest = 0;
	var lastFrame = 0;
	var colors = '';

	canvas.style.opacity = '0';
	container.appendChild(canvas);

	function draw() {
		if (!grid || destroyed)
			return;
		var touch = still ? null : hand.frame(clock());

		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.viewport(0, 0, grid.cols, grid.rows * 2);
		gl.useProgram(fieldProgram);
		gl.uniform1f(F.time, windTime);
		gl.uniform1f(F.reveal, reveal);
		setTouch(F, touch, true);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.useProgram(glyphProgram);
		gl.uniform1f(G.time, windTime);
		setTouch(G, touch, false);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	function setTouch(U, touch, withTrail) {
		gl.uniform1i(U.tapCount, touch ? touch.tapCount : 0);
		if (withTrail)
			gl.uniform1i(U.trailCount, touch ? touch.trailCount : 0);
		if (!touch)
			return;
		gl.uniform1f(U.now, touch.now);
		if (touch.tapCount)
			gl.uniform4fv(U.taps, touch.taps);
		if (withTrail && touch.trailCount) {
			gl.uniform4fv(U.trail, touch.trail);
			gl.uniform4fv(U.trailDir, touch.trailDir);
		}
	}

	// --- цикл кадров ---

	function shouldRun() {
		return !still && !calm && !destroyed && grid && !document.hidden;
	}

	function schedule() {
		if (timer || frameRequest || !shouldRun())
			return;
		var interval = hand.rippling(clock()) ? P.rippleFrameMs : P.frameMs;
		timer = setTimeout(function() {
			timer = 0;
			frameRequest = requestAnimationFrame(frame);
		}, interval);
	}

	function halt() {
		clearTimeout(timer);
		cancelAnimationFrame(frameRequest);
		timer = frameRequest = 0;
	}

	function frame(now) {
		frameRequest = 0;
		var dt = Math.min(Math.max(now - lastFrame, 0) / 1000, 0.25);
		lastFrame = now;
		active += dt;
		var calmDown = 1 - ease((active - deadline) / P.settle);
		var spinUp = ease((active - wokeAt) / P.resume);
		windTime += dt * calmDown * spinUp;
		reveal = ease((active - revealFrom) / P.reveal) * calmDown;
		draw();
		if (calmDown === 0 && !hand.busy(clock()))
			calm = true;
		else
			schedule();
	}

	function start() {
		lastFrame = performance.now();
		schedule();
	}

	// движение мыши будит погасший фон: поле проявляется заново
	function stir() {
		if (still || destroyed)
			return;
		if (calm) {
			calm = false;
			deadline = active + P.budget;
			wokeAt = revealFrom = active;
			start();
		} else {
			if (active < deadline)
				deadline = active + P.budget;
			schedule();
		}
	}

	// --- цвета ---

	function updateColors() {
		var style = win.getComputedStyle(container);
		if (style.color === colors)
			return false;
		colors = style.color;
		var ink = readColor(style.color);
		var luma = 0.2126 * ink.rgb[0] + 0.7152 * ink.rgb[1] + 0.0722 * ink.rgb[2];
		gl.useProgram(glyphProgram);
		gl.uniform3fv(G.ink, ink.rgb);
		gl.uniform1f(G.inkAlpha, ink.alpha);
		gl.uniform3fv(G.glowInk, P.glow[luma < 0.5 ? 'light' : 'dark']);
		return true;
	}

	var colorRequest = 0;
	function onStyleChange() {
		if (colorRequest)
			return;
		colorRequest = requestAnimationFrame(function() {
			colorRequest = 0;
			if (updateColors() && (calm || still))
				draw();
		});
	}
	var styleObserver = new MutationObserver(onStyleChange);
	styleObserver.observe(document.head, {childList: true, subtree: true, characterData: true});
	var darkQuery = win.matchMedia('(prefers-color-scheme: dark)');
	darkQuery.addEventListener('change', onStyleChange);

	// --- размер ---

	function resize(size) {
		var next = layout(size.deviceWidth, size.deviceHeight, win.devicePixelRatio);
		if (next.cols < 24 || next.rows < 8) {
			canvas.style.visibility = 'hidden';
			grid = null;
			halt();
			return;
		}
		canvas.style.visibility = '';
		if (next.cw !== atlasCell) {
			var chars = usableChars(look, family);
			var atlas = buildAtlas(chars, family, next.cw, next.ch, next.dpr);
			gl.activeTexture(gl.TEXTURE1);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, atlas.width, atlas.height, 0, gl.RED, gl.UNSIGNED_BYTE, atlas.data);
			gl.useProgram(glyphProgram);
			gl.uniform1i(G.count, chars.length);
			atlasCell = next.cw;
		}
		var width = next.cols * next.cw;
		var height = next.rows * next.ch;
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		var css = function(v) { return v / next.dpr; };
		canvas.style.left = css(next.left) + 'px';
		canvas.style.top = css(next.top) + 'px';
		canvas.style.width = css(width) + 'px';
		canvas.style.height = css(height) + 'px';

		if (!grid || grid.cols !== next.cols || grid.rows !== next.rows) {
			gl.activeTexture(gl.TEXTURE0);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, next.cols, next.rows * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTexture, 0);
		}
		gl.useProgram(fieldProgram);
		gl.uniform2f(F.step, css(next.cw), css(next.ch) / 2);
		gl.uniform2f(F.origin, css(next.left), css(next.top));
		gl.uniform2f(F.size, css(width), css(height));
		gl.useProgram(glyphProgram);
		gl.uniform4f(G.cellCss, css(next.left + next.cw / 2), css(next.top + next.ch / 2), css(next.cw), css(next.ch));
		gl.uniform2i(G.cell, next.cw, next.ch);
		gl.uniform2i(G.buffer, width, height);

		var first = !grid;
		grid = next;
		updateColors();
		draw();
		if (first) {
			canvas.style.transition = 'opacity 1s ease-out';
			canvas.style.opacity = String(Math.min(1, P.alpha * P.headroom));
			start();
		}
	}

	var resizeTimer = 0;
	var sized = false;
	var resizeObserver = new win.ResizeObserver(function(entries) {
		var device = entries[0].devicePixelContentBoxSize && entries[0].devicePixelContentBoxSize[0];
		if (!device || !device.inlineSize || !device.blockSize)
			return;
		var size = {deviceWidth: device.inlineSize, deviceHeight: device.blockSize};
		clearTimeout(resizeTimer);
		if (!sized) {
			sized = true;
			resize(size);
		} else
			resizeTimer = setTimeout(function() { resize(size); }, 150);
	});

	// --- события ---

	function onPointerMove(event) {
		if (event.pointerType !== 'mouse')
			return;
		hand.move(event.clientX, event.clientY, clock());
		stir();
	}
	function onPointerDown(event) {
		if (event.button !== 0 || still)
			return;
		var target = event.target;
		if (target && target.nodeType !== 1)
			target = target.parentElement;
		if (!target || !target.closest(INTERACTIVE))
			hand.tap(event.clientX, event.clientY, clock());
		stir();
	}
	function onPointerLeave() {
		hand.leave();
	}
	function onVisibility() {
		if (document.hidden)
			halt();
		else if (calm)
			stir();
		else
			start();
	}
	function onContextLost() {
		destroy();
	}

	win.addEventListener('pointermove', onPointerMove, {passive: true});
	win.addEventListener('pointerdown', onPointerDown, {passive: true});
	document.documentElement.addEventListener('pointerleave', onPointerLeave, {passive: true});
	win.addEventListener('keydown', stir, {capture: true, passive: true});
	document.addEventListener('visibilitychange', onVisibility);
	canvas.addEventListener('webglcontextlost', onContextLost);

	// атлас строится шрифтом контейнера — сначала дождаться его загрузки
	var fontWeight = win.devicePixelRatio >= 1.5 ? P.weight : P.weight + 100;
	document.fonts.load(fontWeight + ' 16px ' + family, '0').catch(function() {}).then(function() {
		if (!destroyed)
			resizeObserver.observe(container, {box: 'device-pixel-content-box'});
	});

	function destroy() {
		if (destroyed)
			return;
		destroyed = true;
		halt();
		clearTimeout(resizeTimer);
		cancelAnimationFrame(colorRequest);
		resizeObserver.disconnect();
		styleObserver.disconnect();
		darkQuery.removeEventListener('change', onStyleChange);
		win.removeEventListener('pointermove', onPointerMove);
		win.removeEventListener('pointerdown', onPointerDown);
		document.documentElement.removeEventListener('pointerleave', onPointerLeave);
		win.removeEventListener('keydown', stir, {capture: true});
		document.removeEventListener('visibilitychange', onVisibility);
		canvas.removeEventListener('webglcontextlost', onContextLost);
		gl.deleteProgram(fieldProgram);
		gl.deleteProgram(glyphProgram);
		gl.deleteTexture(fieldTexture);
		gl.deleteTexture(atlasTexture);
		gl.deleteFramebuffer(framebuffer);
		var lose = gl.getExtension('WEBGL_lose_context');
		if (lose)
			lose.loseContext();
		canvas.remove();
	}

	return {destroy: destroy};
}

window.HumbleTexture = {mount: mount};
})();
