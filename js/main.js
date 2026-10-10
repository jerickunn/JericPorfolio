/* ============================================================
   Behaviour layer. Vanilla — no framework, no animation library.
   Effects mirror s0animation.com/design.
   ============================================================ */

import { createHeroScene } from './hero-scene.js';
import { createCaseDevices } from './case-devices.js';
import { createCaseDive } from './case-dive.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

$('#year').textContent = String(new Date().getFullYear());

/* Locked viewport height. iOS Safari changes the viewport height as its
   address bar collapses during a scroll; anything sized in vh would relayout
   mid-scroll (the hero flickered). --vh-lock only follows real size changes:
   a width change or a rotation. */
{
  const html = document.documentElement;
  let lockedW = window.innerWidth;
  // measure what 100vh resolves to (on iOS that is the large viewport, with
  // the address bar hidden) so the locked layout is exactly the vh layout
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const lock = () => { html.style.setProperty('--vh-lock', `${probe.offsetHeight || window.innerHeight}px`); lockedW = window.innerWidth; };
  lock();
  let t = 0;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lockedW) return;
    clearTimeout(t); t = setTimeout(lock, 120);
  });
  window.addEventListener('orientationchange', () => { clearTimeout(t); t = setTimeout(lock, 250); });
}

/* A refresh always lands on the hero: no browser scroll restoration, and any
   #anchor left in the URL from an earlier click is dropped. */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
window.scrollTo(0, 0);

/* ---------------- smooth scroll ---------------- */

/* The reference runs Lenis; without it the sticky stack + footer curtain feel
   stiff under a raw wheel event. Defaults match theirs (lerp .1, smoothWheel). */
let lenis = null;
if (!reduceMotion && window.Lenis) {
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  window.__lenis = lenis;
}

const scrollToEl = (el) => {
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset: 0 });
  else el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
};

/* ---------------- intro loader ---------------- */

/* The reference's timeline, from the moment the scene is ready (t0):
     t0        --enter        logo assembles (.9s)
     +1050ms   --transition   red, collapse, dot splash; character reveal from +900ms
               is-media       the stage fades in
     +1900ms   --fade         loader background clears (.7s)
     +2200ms   scene.start()  cards spin in and fade up, title rises, taglines slide in
     +2550ms   is-character   the real character takes over from the loader's copy
     +2650ms   --done
     +3000ms   is-text        cursor tilt engages
     +3150ms   is-header / is-explore, and the word cycle begins */
function loader(scene) {
  const el = $('#loader');
  const html = document.documentElement;
  const words = HERO_WORDS;
  let wordIndex = 0;
  const cycleWords = () => {
    if (!scene || reduceMotion) return;
    setInterval(() => { wordIndex = (wordIndex + 1) % words.length; scene.setWord(words[wordIndex]); }, 3000);
  };
  const settle = () => {
    html.classList.add('is-media', 'is-character', 'is-text', 'is-header', 'is-explore');
    scene?.start({ still: true });
    scene?.engage();
  };
  if (!el) { settle(); cycleWords(); return; }
  if (reduceMotion) { el.remove(); settle(); return; }

  el.classList.add('intro-loader--enter');
  const at = (ms, fn) => setTimeout(fn, ms);
  at(1050, () => { el.classList.add('intro-loader--transition'); html.classList.add('is-media'); });
  at(1900, () => el.classList.add('intro-loader--fade'));
  at(2200, () => scene?.start());
  at(2550, () => html.classList.add('is-character'));
  at(2650, () => { el.classList.add('intro-loader--done'); at(200, () => el.remove()); });
  at(3000, () => { html.classList.add('is-text'); scene?.engage(); });
  at(3150, () => { html.classList.add('is-header', 'is-explore'); cycleWords(); });
}

/* ---------------- header tabs ---------------- */

function tabs() {
  const nav = $('.tabs');
  const indicator = $('#tabsIndicator');
  const items = $$('.tab');
  if (!nav || !indicator || !items.length) return;

  const move = (el) => {
    indicator.style.width = `${el.offsetWidth}px`;
    indicator.style.transform = `translateX(${el.offsetLeft}px)`;
  };

  const setActive = (el) => {
    items.forEach((t) => t.classList.toggle('is-active', t === el));
    move(el);
  };

  items.forEach((t) => {
    t.addEventListener('click', () => {
      setActive(t);
      scrollToEl($(t.dataset.target));
    });
  });

  // the indicator can only be placed once the webfont has settled
  const place = () => setActive($('.tab.is-active') || items[0]);
  place();
  document.fonts.ready.then(place);
  window.addEventListener('resize', place);

  // reflect whichever section is actually on screen
  const about = $('#about');
  const work = $('#work');
  if (!about || !work || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const match = items.find((t) => t.dataset.target === `#${e.target.id}`);
      if (match && !match.classList.contains('is-active')) setActive(match);
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  io.observe(work);
  io.observe(about);
}

/* ---------------- click-to-copy email ---------------- */

function emailCopy() {
  const btn = $('#emailCopy');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.email);
    } catch {
      const t = document.createElement('textarea');
      t.value = btn.dataset.email;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    btn.classList.add('is-copied');
    setTimeout(() => btn.classList.remove('is-copied'), 1400);
  });
}

/* ---------------- case sections ---------------- */

/* The reference's rule: a case is "seen" once its top crosses 55% of the
   viewport (unseen again when it scrolls back above); on phones it is seen at
   88% and never unseen, and its device starts early at 122%. Seen toggles the
   CSS entrances and plays the device clip; unseen reverses it. */
function caseMotion() {
  const sections = $$('.case-section');
  if (!sections.length) return;

  // titles flip up line by line; only the editorial (Playfair) titles break
  // into two lines, with the second in italics, as the reference's do
  sections.forEach((sec) => {
    const title = sec.querySelector('.case-title');
    if (!title || title.querySelector('.case-title-line')) return;
    const words = title.textContent.trim().split(/\s+/);
    const editorial = title.classList.contains('case-title--editorial');
    let lines;
    if (!editorial || words.length === 1) lines = [words.join(' ')];
    else {
      const cut = Math.ceil(words.length / 2);
      lines = [words.slice(0, cut).join(' '), `<em class="case-title-italic">${words.slice(cut).join(' ')}</em>`];
    }
    title.innerHTML = lines.map((l) => `<span class="case-title-line">${l}</span>`).join('');
  });

  const devices = reduceMotion ? null : createCaseDevices(sections, { waitFor: heroArtLoaded });
  if (!devices) document.documentElement.classList.add('no-case-devices');

  if (reduceMotion) {
    sections.forEach((s) => { s.classList.add('is-in'); });
    return devices;
  }

  const narrow = matchMedia('(max-width: 760px)');
  let queued = false;
  const update = () => {
    queued = false;
    if (document.body.classList.contains('page--case-open')) return;
    const vh = window.innerHeight;
    const mobile = narrow.matches;
    sections.forEach((sec) => {
      const top = sec.getBoundingClientRect().top;
      const seen = top < vh * (mobile ? .88 : .55);
      const was = sec.classList.contains('is-in');
      if (seen && !was) { sec.classList.add('is-in'); if (!mobile) devices?.play(sec); }
      else if (!seen && was && !mobile) { sec.classList.remove('is-in'); devices?.reverse(sec); }
      // phones: the device box sits low in the frame, so its flight starts when
      // the box itself is about to appear, not when the section does
      if (mobile && !sec.dataset.flown) {
        const box = sec.querySelector('.case-device__box');
        if (box && box.getBoundingClientRect().top < vh * .9) { sec.dataset.flown = '1'; devices?.play(sec); }
      }
    });
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  update();
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  window.__caseDevices = devices;
  return devices;
}

/* ---------------- go ---------------- */

/* The leading word cycles like the reference's PRODUCT / UX/UI / BRAND ...
   before DESIGN; these sit before APPS. Kept short so the longest pair fits
   the same arc the reference sized its title for. */
const HERO_WORDS = ['AI-Native', 'Full-Stack', 'Production', 'Mobile', 'Web', 'POS'];

/* the case devices wait for this before fetching their own textures, so the
   hero's art gets the connection to itself (with a fallback if it never fires) */
let heroReady;
const heroArtLoaded = new Promise((r) => { heroReady = r; setTimeout(r, 4000); });

tabs();
emailCopy();
const caseDevices = caseMotion();
window.__caseDive = createCaseDive({
  sections: $$('.case-section'),
  devices: caseDevices,
  reduceMotion,
  scrollTo: (y, immediate) => { if (lenis) lenis.scrollTo(y, { immediate: !!immediate, force: true }); else window.scrollTo(0, y); }
});

const heroCanvas = $('#carouselCanvas');
const scene = heroCanvas ? createHeroScene({
  canvas: heroCanvas,
  stage: $('#carouselStage'),
  wheel: $('#screenWheel'),
  /* card.webp: each shot pre-cropped to the card's own aspect and sized for
     the ring (432x974), so the hero pulls 81KB instead of 922KB */
  shots: [
    './assets/projects/kuyaj/card.webp',
    './assets/projects/smartbigasan/card.webp',
    './assets/projects/aquamanage/card.webp',
    './assets/projects/airconhub/card.webp',
    './assets/projects/hydra/card.webp'
  ],
  words: HERO_WORDS,
  staticWord: 'APPS',
  taglines: ['AI-NATIVE FULL-STACK DEVELOPER', 'SPEC → BUILD → SHIP'],
  onReady: () => heroReady()
}) : null;

if (scene) {
  window.__heroScene = scene;
  // the cursor, normalised across the window, tilts the whole scene
  if (canHover && !reduceMotion) {
    window.addEventListener('pointermove', (e) => {
      scene.setCursor((e.clientX / window.innerWidth - .5) * 2, (e.clientY / window.innerHeight - .5) * 2);
    }, { passive: true });
  }
} else {
  document.documentElement.classList.add('no-webgl');
  const fb = $('#heroFallback');
  if (fb) { fb.hidden = false; fb.removeAttribute('aria-hidden'); }
}

loader(scene);

/* The header is see-through over the hero and turns solid as the first case
   section docks under it. */
{
  const firstCase = $('.case-section');
  const html = document.documentElement;
  let last = -1;
  const dock = () => {
    let p = 1;
    if (firstCase) {
      const top = firstCase.getBoundingClientRect().top - HEADER_H();
      p = Math.min(1, Math.max(0, 1 - top / 260));
    }
    if (p !== last) { last = p; html.style.setProperty('--first-case-dock-progress', p.toFixed(3)); }
  };
  const HEADER_H = () => parseFloat(getComputedStyle(html).getPropertyValue('--header-height')) || 78;
  dock();
  window.addEventListener('scroll', dock, { passive: true });
  window.addEventListener('resize', dock);
}

// the EXPLORE cue and any other in-page anchor must go through the smoother
$$('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (!id || id === '#') return;
    const target = $(id);
    if (!target) return;
    e.preventDefault();
    scrollToEl(target);
  });
});
