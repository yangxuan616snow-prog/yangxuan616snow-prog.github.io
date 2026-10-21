// 欢的种草清单：物理下落的好物堆 + 详情页 + 本机「加入喜欢」。
// Matter.js 负责物理，卡片本身是 <button>，每帧用 transform 跟上刚体位置。
// 喜欢只存在访问者自己的浏览器里（localStorage），没有后端。

import { PICKS } from './picks.js';
import { playFX } from './effects.js';

const LIKE_KEY = 'huan-picks-likes';
// 每个好物详情页的专属入场特效
const FX_BY_ID = {
  'bullshit-jobs': 'book',
  'muji-lotion': 'bottle',
  'rose-cake': 'cake',
  'stars': 'stars',
  'depression': 'rain-love',
  'witch-egg': 'feathers',
  'oud-wood': 'ripple',
  'stationery': 'paper-plane',
};

const $ = (id) => document.getElementById(id);
const pileEl = $('pile');
const heroEl = $('hero');
const detailEl = $('detail');
const likesBtn = $('likes-btn');
const likesBadge = $('likes-badge');
const likesPanel = $('likes-panel');
const likesList = $('likes-list');
const likesEmpty = $('likes-empty');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const M = window.Matter;            // CDN 没加载出来时为 undefined
const physicsOn = !!M;

let engine = null;
let runner = null;
let items = [];                     // { pick, el, body, w, h, dropAt }
let images = {};                    // id -> 原始宽高
let walls = [];
let rafId = 0;
let dropSeq = 0;
let lastW = 0;
let draggedRecently = false;
let current = null;                 // 正在展示的好物
let lastFocus = null;
let likesOpen = false;              // “我喜欢的”面板是否展开
let welcomed = false;
try { welcomed = sessionStorage.getItem('huan-picks-welcomed') === '1'; } catch {}

/* ------------------------------------------------------------------ */
/* 喜欢（只在这台设备上）                                              */
/* ------------------------------------------------------------------ */

const liked = new Set();

function readLikes() {
  try {
    const ids = JSON.parse(localStorage.getItem(LIKE_KEY));
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function writeLikes() {
  try {
    localStorage.setItem(LIKE_KEY, JSON.stringify([...liked]));
  } catch {
    /* 隐私模式：本次浏览仍然生效，只是不落盘 */
  }
}

function renderLikes() {
  for (const it of items) {
    const on = liked.has(it.pick.id);
    it.el.classList.toggle('is-liked', on);
    it.el.querySelector('.stamp').hidden = !on;
    it.el.setAttribute('aria-label', on ? `${it.pick.name}，已喜欢` : it.pick.name);
  }
  const text = `共 ${PICKS.length} 件 · 已喜欢 ${liked.size} 件`;
  $('count').textContent = text;
  $('detail-count').textContent = text;
  likesBadge.hidden = liked.size === 0;
  likesBadge.textContent = liked.size;
  likesBtn.setAttribute('aria-label', `我喜欢的，已喜欢 ${liked.size} 件`);
  if (likesOpen) renderLikesPanel();
  if (current) renderDetail();
}

/* ------------------------------------------------------------------ */
/* 我喜欢的面板（购物车式的清单）                                       */
/* ------------------------------------------------------------------ */

function renderLikesPanel() {
  const likedPicks = PICKS.filter((p) => liked.has(p.id));
  likesEmpty.hidden = likedPicks.length > 0;
  likesList.innerHTML = likedPicks
    .map(
      (p) => `
    <li class="likes-item" data-id="${p.id}">
      <img src="${p.img}" alt="" />
      <span class="likes-item-text">
        <span class="likes-item-name">${p.name}</span>
        <span class="likes-item-by">${p.by}</span>
      </span>
      <button class="likes-remove" type="button" data-remove="${p.id}" aria-label="取消喜欢 ${p.name}">×</button>
    </li>`,
    )
    .join('');
}

function openLikesPanel() {
  likesOpen = true;
  renderLikesPanel();
  likesPanel.hidden = false;
  likesPanel.focus({ preventScroll: true });
}

function closeLikesPanel(refocus = true) {
  if (!likesOpen) return;
  likesOpen = false;
  likesPanel.hidden = true;
  if (refocus) likesBtn.focus();
}

/* ------------------------------------------------------------------ */
/* 大字排版：二分查找“刚好撑满”的字号                                  */
/* ------------------------------------------------------------------ */

function fitText(el, maxW, maxH, min, max) {
  let lo = min;
  let hi = max;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = mid + 'px';
    const r = el.getBoundingClientRect();
    if (r.width <= maxW && r.height <= maxH) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = lo + 'px';
}

// 首页标题：两行各自撑满宽度（短的那行字更大），整体高度不超过屏幕的一小半。
function layoutHero() {
  const w = innerWidth;
  heroEl.style.top = Math.round($('topbar').getBoundingClientRect().bottom + 6) + 'px';

  const gutter = parseFloat(getComputedStyle(heroEl).paddingLeft) || 14;
  const lines = [...heroEl.querySelectorAll('.hero-line')];

  // 先按 100px 量出每行文字的宽度，再换算成铺满可用宽度所需的字号。
  const sizes = lines.map((line) => {
    line.style.display = 'inline-block';
    line.style.fontSize = '100px';
    const width = line.getBoundingClientRect().width;
    line.style.display = '';
    return Math.max(20, ((w - gutter * 2) / width) * 100 * 0.92);
  });

  const lineHeight = 0.8; // 与 styles.css 里的 line-height 保持一致
  const maxH = innerHeight * (w / innerHeight < 1.15 ? 0.26 : 0.34);
  const total = sizes.reduce((sum, s) => sum + s * lineHeight, 0);
  const k = Math.min(1, maxH / total);
  lines.forEach((line, i) => (line.style.fontSize = sizes[i] * k + 'px'));
}

function layoutDetailName() {
  const el = $('detail-name');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.className = 'detail-name-text';
  span.textContent = current.short;
  el.appendChild(span);

  const pad = parseFloat(getComputedStyle(detailEl).paddingLeft) || 18;
  const maxW = innerWidth - pad * 2;
  const maxH = innerHeight * (innerWidth <= 820 ? 0.2 : 0.3);
  fitText(el, maxW, maxH, 34, innerWidth <= 820 ? 150 : 300);

  // 让贴纸往上压住大字的下沿，露出一点重叠。
  detailEl.style.setProperty('--name-h', Math.round(span.getBoundingClientRect().height) + 'px');
}

/* ------------------------------------------------------------------ */
/* 好物堆                                                              */
/* ------------------------------------------------------------------ */

function loadImages() {
  return Promise.all(
    PICKS.map(
      (p) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            images[p.id] = { w: img.naturalWidth, h: img.naturalHeight };
            resolve();
          };
          img.onerror = () => {
            images[p.id] = { w: 4, h: 5 }; // 图挂了也照常摆出来
            resolve();
          };
          img.src = p.img;
        }),
    ),
  );
}

function buildStickers() {
  pileEl.innerHTML = '';
  for (const pick of PICKS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'gift';
    el.dataset.id = pick.id;
    el.setAttribute('aria-label', pick.name);
    el.innerHTML = `<img src="${pick.img}" alt="" draggable="false" /><span class="stamp" hidden>已喜欢</span>`;
    // 鼠标/触摸的轻点统一由 pointerup 处理；这里的 click 只服务键盘激活
    // （回车/空格时 e.detail 为 0），避免移动端重复触发或漏触发。
    el.addEventListener('click', (e) => {
      if (e.detail === 0 && !draggedRecently) openPick(pick.id);
    });
    pileEl.appendChild(el);
    items.push({ pick, el, body: null, w: 0, h: 0 });
  }
}

// 从标题以下的空余面积反推贴纸的边长，让堆看起来刚好填满屏幕。
function stickerScale() {
  const vw = innerWidth;
  const vh = innerHeight;
  const heroBottom = heroEl.getBoundingClientRect().bottom;
  const free = vw * Math.max(vh * 0.45, vh - heroBottom * 0.6);
  const unit = items.reduce((sum, it) => {
    const im = images[it.pick.id] || { w: 4, h: 5 };
    const r = im.w / im.h;
    return sum + (r >= 1 ? 1 / r : r);
  }, 0) || 1;
  const fill = vw < 600 ? 0.7 : 0.76; // 窄屏堆得更差，留点余量
  return Math.max(96, Math.min(Math.sqrt((fill * free) / unit), vw < 600 ? 300 : 440));
}

function buildWalls() {
  if (!engine) return;
  const vw = innerWidth;
  const vh = innerHeight;
  const t = 400; // 墙够厚，飞再快也漏不出去
  if (walls.length) M.Composite.remove(engine.world, walls);
  walls = [
    M.Bodies.rectangle(vw / 2, vh + t / 2, vw * 3, t, { isStatic: true }),          // 地板
    M.Bodies.rectangle(-t / 2, vh / 2 - vh * 2, t, vh * 6, { isStatic: true }),     // 左墙
    M.Bodies.rectangle(vw + t / 2, vh / 2 - vh * 2, t, vh * 6, { isStatic: true }), // 右墙
  ];
  M.Composite.add(engine.world, walls);
}

// 把每件好物从屏幕上方依次放下来。delay 让标题先落定。
function dropAll(delay = 420) {
  if (!physicsOn) {
    layoutStatic();
    return;
  }
  const run = ++dropSeq;
  const vw = innerWidth;
  const L = stickerScale();
  const order = [...items].sort(() => Math.random() - 0.5); // 每次堆得都不一样

  order.forEach((it, i) => {
    if (it.body) M.Composite.remove(engine.world, it.body);

    const im = images[it.pick.id] || { w: 4, h: 5 };
    const r = im.w / im.h;
    it.w = r >= 1 ? L : L * r;
    it.h = r >= 1 ? L / r : L;
    it.el.style.width = it.w + 'px';
    it.el.style.height = it.h + 'px';
    it.el.style.setProperty('--stamp-size', Math.round(Math.max(14, Math.min(it.w, it.h) * 0.17)) + 'px');
    it.el.style.visibility = 'hidden';

    // 碰撞体比贴纸小一圈，因为视觉边缘是圆角。
    const body = M.Bodies.rectangle(0, 0, it.w * 0.94, it.h * 0.94, {
      chamfer: { radius: Math.min(it.w, it.h) * 0.1 },
      restitution: 0.16,
      friction: 0.55,
      frictionAir: 0.014,
      density: 0.0016,
    });
    body.plugin.item = it;
    M.Body.setPosition(body, {
      x: it.w / 2 + Math.random() * Math.max(1, vw - it.w),
      y: -it.h - i * (reduceMotion ? 0 : 150) - Math.random() * 90,
    });
    M.Body.setAngle(body, (Math.random() - 0.5) * 1.1);
    M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);

    it.body = body;
    it.dropAt = i * 160; // 依次掉下来的错落感
  });

  if (reduceMotion) {
    // 不做下落动画：直接算到静止，再亮出来。
    order.forEach((it) => M.Composite.add(engine.world, it.body));
    for (let i = 0; i < 900; i++) M.Engine.update(engine, 1000 / 60);
    order.forEach((it) => (it.el.style.visibility = 'visible'));
    renderPile();
    return;
  }

  const start = performance.now();
  const pending = [...order];
  const release = () => {
    if (run !== dropSeq) return; // 有更新的一次下落接管了
    const now = performance.now() - start;
    while (pending.length && pending[0].dropAt <= now) {
      const it = pending.shift();
      M.Composite.add(engine.world, it.body);
      it.el.style.visibility = 'visible';
    }
    if (pending.length) requestAnimationFrame(release);
  };
  setTimeout(() => requestAnimationFrame(release), delay);
}

function renderPile() {
  for (const it of items) {
    if (!it.body) continue;
    const { x, y } = it.body.position;
    it.el.style.transform = `translate(${x - it.w / 2}px, ${y - it.h / 2}px) rotate(${it.body.angle}rad)`;
  }
}

function loopPile() {
  renderPile();
  rafId = requestAnimationFrame(loopPile);
}

// 物理库不可用时的兜底：排成一张静态的贴纸墙，功能照旧。
function layoutStatic() {
  pileEl.classList.add('is-static');
  for (const it of items) {
    it.el.style.visibility = 'visible';
    it.el.style.transform = '';
    it.el.style.width = '';
    it.el.style.height = '';
    it.el.style.removeProperty('--stamp-size');
  }
}

function setupPointer() {
  const mouse = M.Mouse.create(pileEl);
  // Matter 默认会拦住页面滚轮，这个页面不需要滚，直接摘掉。
  ['wheel', 'mousewheel', 'DOMMouseScroll'].forEach((t) => pileEl.removeEventListener(t, mouse.mousewheel));
  const mc = M.MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, damping: 0.1, render: { visible: false } },
  });
  M.Composite.add(engine.world, mc);

  const bodies = () => items.filter((it) => it.body && it.el.style.visibility !== 'hidden').map((it) => it.body);
  // 落点最上面那张贴纸（DOM 越靠后画得越上）。
  const stickerAt = (x, y) => {
    const hits = M.Query.point(bodies(), { x, y });
    if (!hits.length) return null;
    return hits.reduce((top, b) => (items.indexOf(b.plugin.item) > items.indexOf(top.plugin.item) ? b : top)).plugin.item;
  };

  let down = null;
  pileEl.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, target: e.target };
  });
  window.addEventListener('pointercancel', () => {
    down = null;
  });
  window.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const target = down.target;
    down = null;
    // 拖过了就不当成点击，避免拽着贴纸玩的时候误进详情页。
    if (moved >= 8) {
      draggedRecently = true;
      setTimeout(() => (draggedRecently = false), 300);
      return;
    }
    // Matter 在 touchstart 里 preventDefault，移动端不会再有合成的 click，
    // 所以轻点的手指抬起时直接判定一次。
    const gift = target && target.closest && target.closest('.gift');
    if (gift && !draggedRecently) openPick(gift.dataset.id);
  });

  // 甩出屏幕的贴纸，从上面放回来。
  M.Events.on(engine, 'afterUpdate', () => {
    for (const it of items) {
      if (!it.body) continue;
      if (it.body.position.y > innerHeight + 400) {
        M.Body.setPosition(it.body, { x: innerWidth / 2, y: -it.h });
        M.Body.setVelocity(it.body, { x: 0, y: 0 });
      }
    }
  });
}

function onResize() {
  layoutHero();
  buildWalls();
  // 宽度变了（转屏、拉窗口）就重堆；只变高度（手机地址栏）只挪地板。
  if (Math.abs(innerWidth - lastW) > 60) {
    lastW = innerWidth;
    dropAll(0);
  }
}

/* ------------------------------------------------------------------ */
/* 详情页                                                              */
/* ------------------------------------------------------------------ */

function openPick(id) {
  if (location.hash !== `#/pick/${id}`) location.hash = `#/pick/${id}`;
}

function renderDetail() {
  const on = liked.has(current.id);
  $('detail-stamp').hidden = !on;
  $('like-btn').hidden = on;
  $('like-note').hidden = on;
  $('unlike-btn').hidden = !on;
}

function showDetail(pick) {
  const firstOpen = !current;
  current = pick;
  if (firstOpen) lastFocus = document.activeElement;

  detailEl.hidden = false;
  detailEl.scrollTop = 0;
  document.title = `${pick.name} · Huan’s Picks`;

  $('detail-img').src = pick.img;
  $('detail-img').alt = pick.alt || pick.name;
  $('detail-by').textContent = pick.by;
  $('detail-blurb').innerHTML = pick.blurb; // blurb 支持 <a> 超链接（保留推荐语里的扩展链接）
  $('detail-msg').textContent = '';
  $('detail-links').innerHTML = pick.links
    .map(
      (l) =>
        `<a class="btn btn-buy" href="${l.url}">${l.label}` +
        `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`,
    )
    .join('');

  renderDetail();
  layoutDetailName();
  if (runner) M.Runner.stop(runner); // 堆看不见了，先别算了
  detailEl.focus({ preventScroll: true });
  playFX(FX_BY_ID[pick.id]);       // 专属入场特效
}

function hideDetail() {
  if (!current) return;
  current = null;
  detailEl.hidden = true;
  document.title = 'Huan’s Picks · 欢的种草清单';
  if (runner) M.Runner.run(runner, engine);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function onLike() {
  if (!current) return;
  liked.add(current.id);
  writeLikes();
  $('detail-msg').textContent = '已加入喜欢。';
  renderLikes();
  // 爱心从按钮位置炸开
  const r = $('like-btn').getBoundingClientRect();
  playFX('like', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

function onUnlike() {
  if (!current) return;
  liked.delete(current.id);
  writeLikes();
  $('detail-msg').textContent = '已取消喜欢。';
  renderLikes();
}

// hash 路由：#/pick/<id> 看详情，其它回好物堆。
function route() {
  const m = location.hash.match(/^#\/pick\/([a-z0-9-]+)$/);
  const pick = m ? PICKS.find((p) => p.id === m[1]) : null;
  if (pick) {
    showDetail(pick);
  } else {
    hideDetail();
    // 撒金粉欢迎：每次会话第一次进首页撒满，之后回来意思一下就好
    playFX(welcomed ? 'home-lite' : 'home');
    if (!welcomed) {
      welcomed = true;
      try { sessionStorage.setItem('huan-picks-welcomed', '1'); } catch {}
    }
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function start() {
  // 量字之前先确保字体真的到位，否则算出来的字号会偏。
  await Promise.all([
    document.fonts.load('400 100px "Bagel Fat One"'),
    document.fonts.load('100px "ZCOOL KuaiLe"'),
    document.fonts.load('900 100px "Noto Sans SC"'),
  ]).catch(() => {});
  await document.fonts.ready.catch(() => {});

  layoutHero();
  if ('ResizeObserver' in window) new ResizeObserver(() => layoutHero()).observe($('topbar'));

  await loadImages();
  buildStickers();

  if (physicsOn) {
    engine = M.Engine.create({ gravity: { y: 1.1 } });
    runner = M.Runner.create();
    buildWalls();
    setupPointer();
    lastW = innerWidth;
    M.Runner.run(runner, engine);
    loopPile();
    dropAll();
  } else {
    layoutStatic();
  }

  readLikes().forEach((id) => liked.add(id));
  renderLikes();
  route();

  $('like-btn').addEventListener('click', onLike);
  $('unlike-btn').addEventListener('click', onUnlike);
  $('again-btn').addEventListener('click', () => dropAll(0));

  likesBtn.addEventListener('click', () => (likesOpen ? closeLikesPanel() : openLikesPanel()));
  $('likes-close').addEventListener('click', () => closeLikesPanel());
  likesList.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      liked.delete(rm.dataset.remove);
      writeLikes();
      renderLikes();
      return;
    }
    const item = e.target.closest('.likes-item');
    if (item) {
      closeLikesPanel(false);
      openPick(item.dataset.id);
    }
  });
  // 点到面板外面就收起
  document.addEventListener('pointerdown', (e) => {
    if (likesOpen && !likesPanel.contains(e.target) && !likesBtn.contains(e.target)) closeLikesPanel(false);
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (likesOpen) closeLikesPanel();
    else if (current) location.hash = '#/';
  });

  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      onResize();
      if (current) layoutDetailName();
    }, 150);
  });
  // 手机切回前台时，刷新一下喜欢的状态。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderLikes();
  });
}

start();
