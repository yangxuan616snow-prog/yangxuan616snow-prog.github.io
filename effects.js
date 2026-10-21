// 轻量粒子特效：一块全屏 canvas，按需播放一次性的小彩蛋（约 2 秒自动消散）。
// 首页金粉雨 / 书的彩纸 / MUJI 的气泡 / 蛋糕的花瓣 / 加入喜欢的爱心。
// 不依赖任何库；系统开了“减少动态效果”时全部跳过。

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2;

const GOLD = ['#F2C94C', '#E8B84B', '#F6E27A', '#D9A441'];
const SITE = ['#D9502E', '#8FD0F2', '#4E7EA3', '#F6C9CB'];
const BOOK = ['#F26D8D', '#F5C242', '#FAF7E4', '#2F4B3A'];
const PINKS = ['#F6C9CB', '#F2A7B3', '#E88BA0', '#B7D6A8'];
const HEARTS = ['#D9502E', '#F26D8D', '#F6C9CB'];
// 5 个新主题
const STARS = ['#F6E27A', '#FFFFFF', '#E8B84B', '#F2C94C'];
const RAIN = ['#8FD0F2', '#4E7EA3', '#C7DBEE'];
const FEATHERS = ['#D9502E', '#2F4B3A', '#F2C94C', '#8FD0F2', '#F6C9CB'];
const OUD = ['#6B4C36', '#4A3526', '#8A6B4C', '#B59060'];
const PAPER = ['#FAF7E4', '#FFFFFF', '#F6C9CB'];

let cv = null;
let ctx = null;
let dpr = 1;
let raf = 0;
let last = 0;
let parts = [];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick1 = (arr) => arr[(Math.random() * arr.length) | 0];

function ensure() {
  if (reduce) return false;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'fx';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.position = 'fixed';
    cv.style.inset = '0';
    cv.style.pointerEvents = 'none';
    cv.style.zIndex = '9999';
    document.body.appendChild(cv);
    ctx = cv.getContext('2d');
    addEventListener('resize', () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
    });
  }
  // 每次调用都确保尺寸正确（防止首次加载时 innerWidth=0 的边界情况）
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = innerWidth * dpr, h = innerHeight * dpr;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return true;
}

/* ---------- 粒子行为 ---------- */

function step(p, dt) {
  p.t += dt;
  if (p.t < 0) return; // 负的 t 当作延迟出场
  if (p.swayA) p.x += Math.sin((p.t + p.seed) * p.swayF * TAU) * p.swayA * dt;
  p.x += p.vx * dt;
  p.vy += p.g * dt;
  p.y += p.vy * dt;
  p.rot += p.vr * dt;
}

function alphaOf(p) {
  if (p.t < 0) return 0;
  const a = Math.min(p.t / (p.life * 0.12), 1, (p.life - p.t) / (p.life * 0.3));
  const tw = p.tw ? 0.65 + 0.35 * Math.sin(p.t * p.tw + p.seed) : 1; // 金粉的闪烁
  return Math.max(0, a) * tw;
}

function draw(p) {
  const a = alphaOf(p);
  if (a <= 0) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.globalAlpha = a;

  if (p.shape === 'dot') {
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.size * 3;
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, TAU);
    ctx.fill();
  } else if (p.shape === 'rect') {
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  } else if (p.shape === 'petal') {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, TAU);
    ctx.fill();
  } else if (p.shape === 'bubble') {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.arc(-p.size * 0.25, -p.size * 0.25, p.size * 0.4, Math.PI * 0.9, Math.PI * 1.5);
    ctx.stroke();
  } else if (p.shape === 'heart') {
    const s = p.size;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.9);
    ctx.bezierCurveTo(-s * 1.4, 0, -s * 0.6, -s * 0.9, 0, -s * 0.25);
    ctx.bezierCurveTo(s * 0.6, -s * 0.9, s * 1.4, 0, 0, s * 0.9);
    ctx.fill();
  } else if (p.shape === 'ripple') {
    // 檀香涟漪：从中心向外扩散的同心描边圈
    const r = p.radius + p.t * 200;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
  } else if (p.shape === 'feather') {
    // 细长羽毛 + 中心线
    const s = p.size;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.35, s, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(0, s);
    ctx.stroke();
  } else if (p.shape === 'paper-plane') {
    // 小纸飞机：三角形
    const s = p.size;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = '#2F4B3A';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, s * 0.6);
    ctx.lineTo(-s * 0.3, 0);
    ctx.lineTo(-s * 0.7, -s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function loop(ts) {
  if (!parts.length) {
    raf = 0;
    ctx.clearRect(0, 0, cv.width, cv.height);
    return;
  }
  const dt = Math.min((ts - last) / 1000, 0.05);
  last = ts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.t < p.life && p.y < innerHeight + 80 && p.y > -innerHeight - 80);
  for (const p of parts) {
    step(p, dt);
    draw(p);
  }
  raf = requestAnimationFrame(loop);
}

/* ---------- 各类粒子 ---------- */

function goldDust(n) {
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'dot', x: rnd(0, innerWidth), y: rnd(-innerHeight * 0.25, -10),
      vx: rnd(-10, 10), vy: rnd(40, 100), g: 14,
      rot: 0, vr: 0, size: rnd(1.8, 4.2),
      color: pick1(GOLD), t: -rnd(0, 0.6), life: rnd(3, 5),
      tw: rnd(6, 14), seed: rnd(0, TAU),
    });
}

function confetti(n, colors) {
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'rect', x: innerWidth / 2 + rnd(-50, 50), y: -20,
      vx: rnd(-240, 240), vy: rnd(60, 320), g: 300,
      rot: rnd(0, TAU), vr: rnd(-8, 8), w: rnd(6, 10), h: rnd(8, 14),
      color: pick1(colors), t: -rnd(0, 0.3), life: rnd(2.5, 4),
    });
}

function bubbles(n) {
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'bubble', x: rnd(0, innerWidth), y: innerHeight + rnd(10, 70),
      vx: 0, vy: -rnd(90, 210), g: 0,
      rot: 0, vr: 0, size: rnd(6, 18),
      swayA: rnd(10, 30), swayF: rnd(0.4, 0.9), seed: rnd(0, TAU),
      color: '#4E7EA3', t: -rnd(0, 0.5), life: rnd(2.4, 3.6),
    });
}

function petals(n) {
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'petal', x: rnd(0, innerWidth), y: rnd(-innerHeight * 0.2, -10),
      vx: rnd(-35, 35), vy: rnd(70, 150), g: 30,
      rot: rnd(0, TAU), vr: rnd(-3, 3), size: rnd(8, 14),
      swayA: rnd(24, 55), swayF: rnd(0.4, 0.9), seed: rnd(0, TAU),
      color: pick1(PINKS), t: -rnd(0, 0.5), life: rnd(2.6, 3.6),
    });
}

function hearts(n, x, y) {
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'heart', x: x + rnd(-14, 14), y: y + rnd(-8, 8),
      vx: rnd(-60, 60), vy: -rnd(140, 280), g: 160,
      rot: rnd(-0.4, 0.4), vr: rnd(-2, 2), size: rnd(9, 16),
      color: pick1(HEARTS), t: -rnd(0, 0.15), life: rnd(1.5, 2.2),
    });
}

/* ---------- 新增 5 个主题粒子 ---------- */

// 群星闪耀时：金色星点从下方缓缓上浮，闪烁
function twinkleStars(n) {
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'dot', x: rnd(0, innerWidth), y: innerHeight + rnd(10, 80),
      vx: rnd(-12, 12), vy: -rnd(40, 90), g: 0,
      rot: 0, vr: 0, size: rnd(1.6, 3.8),
      color: pick1(STARS), t: -rnd(0, 0.6), life: rnd(3, 4.5),
      tw: rnd(4, 12), seed: rnd(0, TAU),
    });
}

// 抑郁的力量：淡蓝细雨落，接触底部后变成粉色爱心飞起来（雨过天晴）
function rainAndHearts(n) {
  // 先撒雨粒
  for (let i = 0; i < n * 2; i++)
    parts.push({
      shape: 'rect', x: rnd(0, innerWidth), y: rnd(-innerHeight * 0.4, -10),
      vx: rnd(-20, 20), vy: rnd(260, 360), g: 120,
      rot: 0, vr: 0, w: 1.2, h: rnd(10, 18),
      color: pick1(RAIN), t: -rnd(0, 0.4), life: rnd(2.2, 3.2),
    });
  // 底部同时冒出几颗小爱心
  for (let i = 0; i < Math.max(4, n / 4 | 0); i++)
    parts.push({
      shape: 'heart', x: rnd(innerWidth * 0.1, innerWidth * 0.9), y: innerHeight - 10,
      vx: rnd(-20, 20), vy: -rnd(80, 140), g: 40,
      rot: rnd(-0.3, 0.3), vr: rnd(-1, 1), size: rnd(8, 12),
      color: '#F6C9CB', t: -rnd(1.0, 1.6), life: rnd(2.5, 3.6),
    });
}

// 芭芭雅嘎：彩色羽毛从上方飘落
function coloredFeathers(n) {
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'feather', x: rnd(0, innerWidth), y: rnd(-innerHeight * 0.3, -20),
      vx: rnd(-30, 30), vy: rnd(50, 120), g: 18,
      rot: rnd(0, TAU), vr: rnd(-2.5, 2.5), size: rnd(14, 26),
      swayA: rnd(20, 45), swayF: rnd(0.3, 0.7), seed: rnd(0, TAU),
      color: pick1(FEATHERS), t: -rnd(0, 0.5), life: rnd(3.4, 4.8),
    });
}

// Oud Wood：中心向外扩散的檀香棕同心涟漪
function woodRipples(n) {
  const cx = innerWidth / 2;
  const cy = innerHeight * 0.4;
  for (let i = 0; i < n; i++)
    parts.push({
      shape: 'ripple', x: cx, y: cy,
      vx: 0, vy: 0, g: 0, rot: 0, vr: 0, size: 0,
      radius: rnd(8, 24), // 初始半径
      color: pick1(OUD), t: -rnd(0, 1.8), life: rnd(3.4, 4.4),
    });
}

// 文创小店：白色小纸飞机从左向右飞过
function paperPlanes(n) {
  for (let i = 0; i < n; i++) {
    const fromLeft = Math.random() < 0.6;
    parts.push({
      shape: 'paper-plane',
      x: fromLeft ? -40 - rnd(0, 80) : innerWidth + 40 + rnd(0, 80),
      y: rnd(innerHeight * 0.2, innerHeight * 0.7),
      vx: fromLeft ? rnd(120, 220) : -rnd(120, 220),
      vy: rnd(-20, 20), g: 0,
      rot: fromLeft ? rnd(-0.15, 0.15) : rnd(Math.PI - 0.15, Math.PI + 0.15),
      vr: rnd(-0.5, 0.5),
      size: rnd(10, 18),
      color: pick1(PAPER), t: -rnd(0, 0.9), life: rnd(3, 4.5),
    });
  }
}

/* ---------- 对外 ---------- */

const PRESETS = {
  home: () => { goldDust(110); confetti(30, SITE); },
  'home-lite': () => goldDust(60),
  book: () => confetti(52, BOOK),
  bottle: () => bubbles(34),
  cake: () => petals(36),
  like: (o) => hearts(16, o.x || innerWidth / 2, o.y || innerHeight / 2),
  stars: () => twinkleStars(40),
  'rain-love': () => rainAndHearts(30),
  feathers: () => coloredFeathers(26),
  ripple: () => woodRipples(5),
  'paper-plane': () => paperPlanes(12),
};

export function playFX(name, opts = {}) {
  if (!ensure()) return;
  PRESETS[name]?.(opts);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
}

// 调试钩子：当前还在飞的粒子数
window.__fxCount = () => parts.length;
