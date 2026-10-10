/* ============================================================
   Case deep dives — a case opens in place the way the reference's do: the
   header leaves, the "Gallery" pill takes over, the stack collapses to the
   one case, and its story slides up from below. Hash-routed (#case/<slug>)
   so Back and Escape both close it.
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function createCaseDive({ sections, scrollTo, devices, reduceMotion }) {
  const body = document.body;
  const back = $('.case-back');
  let open = null;
  let savedScroll = 0;

  const bySlug = (slug) => sections.find((s) => s.dataset.slug === slug) ?? null;

  // count a figure up from 0 (numbers only; "0" and text stay as they are)
  const countUp = (el) => {
    const target = el.dataset.statValue ?? el.textContent;
    const m = target.match(/^(\d+)(.*)$/);
    if (!m || reduceMotion || el.dataset.counted) { el.textContent = target; return; }
    el.dataset.counted = '1';
    const n = parseInt(m[1], 10), suffix = m[2];
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 900);
      const e = 1 - (1 - p) ** 3;
      el.textContent = Math.round(n * e) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ---------------- scroll reveals ---------------- */

  // the reference's rule: a block is "in" once its top crosses 55% of the
  // viewport (the More-cases aside at 70%); reels cycle while they are in
  let queued = false;
  let reels = [];
  const REEL_EVERY = 3200;
  const update = () => {
    queued = false;
    if (!open) return;
    const vh = window.innerHeight;
    $$('.case-story__row, .case-stats__cell, .case-story__coda, .case-next', open).forEach((el) => {
      if (el.classList.contains('is-in')) return;
      const limit = el.classList.contains('case-next') ? .7 : .55;
      if (el.getBoundingClientRect().top < vh * limit) {
        el.classList.add('is-in');
        $$('.case-stats__value', el).forEach(countUp);
      }
    });
  };
  const queue = () => { if (!queued && open) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);

  const startReels = (section) => {
    stopReels();
    $$('.case-reel', section).forEach((reel) => {
      const cards = $$('.case-reel__card', reel);
      if (cards.length < 2) return;
      let front = 0;
      const id = setInterval(() => {
        const r = reel.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight || !reel.closest('.is-in')) return;
        front = (front + 1) % cards.length;
        cards.forEach((c, i) => { c.dataset.pos = String((i - front + cards.length) % cards.length); });
      }, REEL_EVERY);
      reels.push(id);
    });
  };
  const stopReels = () => { reels.forEach(clearInterval); reels = []; };

  const revealAll = (section) => {
    $$('.case-story__row, .case-stats__cell, .case-story__coda, .case-next', section).forEach((t) => t.classList.add('is-in'));
    $$('.case-stats__value', section).forEach(countUp);
  };

  /* ---------------- open / close ---------------- */

  const OPEN_MS = 1120;
  let busy = false;

  // fit the device between the lifted copy and the band: tablets always,
  // phones on narrow screens (desktop phones keep the reference's fixed lift).
  // Fractions are where the device sits inside its box: the tablet spans
  // 18.7% -> 79.2% of the box height, the phone (centred, 84%) 8% -> 92%.
  const narrow = matchMedia('(max-width: 760px)');
  const fitDevice = (section) => {
    const layout = section.dataset.layout;
    const isTablet = layout === 'tablet';
    if (!isTablet && !narrow.matches) { section.style.removeProperty('--case-device-scale'); section.style.removeProperty('--case-device-shift'); return; }
    const content = section.querySelector('.case-cover__content');
    const dev = section.querySelector('.case-device');
    const box = section.querySelector('.case-device__box');
    if (!content || !dev || !box) return;
    const topFrac = isTablet ? .187 : .08;
    const hFrac = isTablet ? .605 : .84;
    const copyBottom = content.getBoundingClientRect().bottom - 24;
    const bandTop = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vh-lock')) || window.innerHeight) * .66;
    const P = dev.getBoundingClientRect().top;
    const r = box.getBoundingClientRect();
    const H = r.height;
    const scale = Math.max(.3, Math.min(.8, (bandTop - 48 - copyBottom) / (hFrac * H)));
    const devTop = r.top + topFrac * H;
    const shift = (copyBottom + 24) - (P + (devTop - P) * scale);
    section.style.setProperty('--case-device-scale', scale.toFixed(3));
    section.style.setProperty('--case-device-shift', `${shift.toFixed(1)}px`);
  };
  window.addEventListener('resize', () => { if (open) fitDevice(open); });

  const openCase = (section, { push = true } = {}) => {
    if (!section || section === open || busy) return;
    // switching from another dive keeps the gallery position we came from
    if (open) closeNow(open);
    else savedScroll = window.scrollY;
    open = section;
    devices?.settle(section);
    // the band starts right under the frame and slides up to 66vh
    const frame = section.querySelector('.case-frame');
    const frameBottom = frame ? frame.getBoundingClientRect().bottom : window.innerHeight;
    const start = Math.max(0, frameBottom - window.innerHeight * .66 + 54);
    section.style.setProperty('--case-body-start', `${start.toFixed(1)}px`);
    section.classList.add('is-in', 'is-open');
    body.classList.add('page--case-open');
    back.setAttribute('aria-hidden', 'false');
    back.tabIndex = 0;
    if (push) history.pushState({ caseSlug: section.dataset.slug }, '', `#case/${section.dataset.slug}`);
    scrollTo(0, true);
    const bodyEl = section.querySelector('.case-page-body');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitDevice(section);
      bodyEl?.classList.add('is-up');
      if (reduceMotion) { section.classList.add('is-settled'); revealAll(section); return; }
      setTimeout(() => { section.classList.add('is-settled'); update(); startReels(section); }, OPEN_MS);
    }));
  };

  // instant reset (used when jumping straight to another case)
  const closeNow = (section) => {
    stopReels();
    section.classList.remove('is-open', 'is-settled');
    body.classList.remove('page--case-open', 'page--case-closing', 'page--case-veil');
    $$('.case-story__row, .case-stats__cell, .case-story__coda, .case-next', section).forEach((t) => t.classList.remove('is-in'));
    section.querySelector('.case-page-body')?.classList.remove('is-up');
    open = null;
  };

  // the reference's close: a white veil, then the open runs backwards under
  // it, then the gallery is back where it was
  const closeCase = ({ pop = true } = {}) => {
    if (!open || busy) return;
    const section = open;
    busy = true;
    if (pop && location.hash.startsWith('#case/')) history.replaceState(null, '', location.pathname + location.search);
    stopReels();
    const finish = () => {
      closeNow(section);
      scrollTo(savedScroll, true);
      busy = false;
      back.setAttribute('aria-hidden', 'true');
      back.tabIndex = -1;
    };
    if (reduceMotion) { finish(); return; }
    body.classList.add('page--case-veil');
    setTimeout(() => {
      scrollTo(0, true);
      section.classList.remove('is-settled');
      section.querySelector('.case-page-body')?.classList.remove('is-up');
      body.classList.add('page--case-closing');
      setTimeout(() => body.classList.remove('page--case-veil'), 350);
      setTimeout(finish, OPEN_MS);
    }, 300);
  };

  // Deep dive buttons, on covers and in the "more cases" strips
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open]');
    if (!btn) return;
    e.preventDefault();
    openCase(bySlug(btn.dataset.open));
  });
  back?.addEventListener('click', () => closeCase());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCase(); });
  window.addEventListener('popstate', () => {
    const m = location.hash.match(/^#case\/([\w-]+)$/);
    if (m) openCase(bySlug(m[1]), { push: false });
    else closeCase({ pop: false });
  });

  return { open: (slug) => openCase(bySlug(slug)), close: () => closeCase(), current: () => open?.dataset.slug ?? null };
}
