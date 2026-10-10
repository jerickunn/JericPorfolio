/* ============================================================
   Hero scene — a port of the reference's Three.js carousel component.

   The camera sits at the origin INSIDE a ring of 26 cards (radius 7.2), so the
   cards you see are the near wall of the cylinder, facing you. The title and
   the two taglines are text textures wrapped onto the same cylinder, which is
   what gives them their cove: they follow the wall exactly as the cards do.
   Every constant here is the reference's own.
   ============================================================ */

import * as THREE from 'three';

const RADIUS = 7.2;
const FOV = 34;
const FOV_NARROW = 46;                 // canvases under 600px wide
const GROUP_Y = .28;                   // the whole scene rides this high

const CARD = { w: 1.34, h: 3.02, r: .14, edge: .012 };
const CARD_OPACITY = { rest: .62, hover: 1 };
const CARD_HOVER_SCALE = 1.045;
const CARD_LIFT = .72;                 // extra white on resting cards (ours, see the shader)
const OUTLINE = { rest: .006, hover: .072, opacity: { rest: .42, hover: .85 }, color: { rest: 0xb8b8b8, hover: 0xf6f6f6 } };
const SLOTS = 13;                      // unique slots; the ring holds them twice

const SPIN = { idle: .095, intro: 4.1, introNarrow: 2.5, settle: 3.6, flickMax: 6.5, flickDecay: 1.45 };
const TILT = { y: .14, x: -.075, follow: .08, engage: .022, cursorFollow: .075 };
const CHARACTER = { z: 5.02, bottom: -2.44, h: 3.88 };   // group-local; bottom is the pivot

const TITLE = {
  font: "400 210px Anton, Impact, 'Arial Black', sans-serif",
  letterSpacing: '-0.04em',
  stripH: 1, texH: 293, pad: 15, gap: 3,
  refTheta: .92, refPair: ['PRODUCT', 'DESIGN'],   // the pair the reference sized .92 rad for
  y: 2.08,
  typeIn: .058, typeOut: .032, cooldown: .14
};
const TAG = {
  font: '600 52px Montserrat, Arial, sans-serif',
  stripH: .24, texH: 92, pad: 10, widthMul: 1.45, theta: .5, y: -1.9, inset: .16,
  refWidth: 883.2,                     // the reference's left tagline at 52px; keeps our glyphs the same size
  hoverScale: .055
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const cubicOut = (t) => 1 - (1 - t) ** 3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = THREE.MathUtils.lerp;

/* ---------------- text textures ---------------- */

const measure = (text, font) => {
  const c = document.createElement('canvas').getContext('2d');
  c.font = font;
  return c.measureText(text).width;
};

// static text, centred in a padded strip. Mirrored (repeat.x = -1) because the
// cylinder is read from the inside.
function textTexture(text, o) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d');
  const s = 2;
  c.font = o.font;
  if (o.letterSpacing) c.letterSpacing = o.letterSpacing;
  const w = Math.ceil((c.measureText(text).width + o.pad * 2) * (o.widthMul ?? 1));
  const h = o.texH;
  cv.width = w * s; cv.height = h * s;
  c.scale(s, s);
  c.clearRect(0, 0, w, h);
  c.font = o.font;
  if (o.letterSpacing) c.letterSpacing = o.letterSpacing;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const m = c.measureText(text);
  const x = ((m.actualBoundingBoxRight ?? 0) - (m.actualBoundingBoxLeft ?? 0)) / 2;
  c.fillStyle = o.color ?? '#000';
  c.fillText(text, w / 2 - x, h / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.wrapS = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.repeat.x = -1;
  t.offset.x = 1;
  return t;
}

// the typewriter: the first `count` characters, the newest one stroked
function typedTexture(text, count, o) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d');
  const s = 2;
  c.font = o.font;
  if (o.letterSpacing) c.letterSpacing = o.letterSpacing;
  const full = c.measureText(text).width;
  const w = Math.ceil(full + o.pad * 2);
  const h = o.texH;
  cv.width = w * s; cv.height = h * s;
  c.scale(s, s);
  c.clearRect(0, 0, w, h);
  c.font = o.font;
  if (o.letterSpacing) c.letterSpacing = o.letterSpacing;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  const n = clamp(count, 0, text.length);
  const m = c.measureText(text);
  const half = ((m.actualBoundingBoxRight ?? full) - (m.actualBoundingBoxLeft ?? 0)) / 2;
  let x = w / 2 - half;
  c.lineJoin = 'round';
  c.lineWidth = 5;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (o.outlineLast && i === n - 1) { c.strokeStyle = o.color; c.strokeText(ch, x, h / 2); }
    else { c.fillStyle = o.color; c.fillText(ch, x, h / 2); }
    x += c.measureText(ch).width;
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = -1;
  t.offset.x = 1;
  return t;
}

function strip(tex, { stripH, thetaStart, thetaLength, y }) {
  const g = new THREE.CylinderGeometry(RADIUS, RADIUS, stripH, 96, 1, true, thetaStart, thetaLength);
  const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, alphaTest: 0, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = y;
  mesh.renderOrder = 10;
  return mesh;
}

const disposeMesh = (mesh) => {
  mesh.geometry.dispose();
  mesh.material.map?.dispose();
  mesh.material.dispose();
};

/* ---------------- card shapes ---------------- */

function roundedRect(w, h, r) {
  const x = -w / 2, y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function outlineGeometry(t) {
  const W = CARD.w + CARD.edge * 2, H = CARD.h + CARD.edge * 2, R = CARD.r + CARD.edge;
  const outer = roundedRect(W + t * 2, H + t * 2, R + t);
  outer.holes.push(roundedRect(W, H, R));
  return new THREE.ShapeGeometry(outer);
}

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/* ============================================================ */

export function createHeroScene({ canvas, stage, wheel, shots, words, staticWord, taglines, onReady }) {
  if (!webglOk()) return null;

  const narrow = matchMedia('(max-width: 760px)').matches;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas, powerPreference: 'high-performance' });
  renderer.setClearColor(0xffffff, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 3 : 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, .1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, 1);              // +z is ahead, which puts +x on screen-left

  const K = new THREE.Group();         // tilts with the cursor
  K.position.y = GROUP_Y;
  scene.add(K);
  const V = new THREE.Group();         // the ring
  K.add(V);
  const X = new THREE.Group();         // text, shown once the intro reaches it
  K.add(X);
  const titleGroup = new THREE.Group();
  const tagGroup = new THREE.Group();
  X.add(titleGroup, tagGroup);
  X.visible = false;
  if (narrow) {
    tagGroup.visible = false;
    V.scale.setScalar(1.2);
    V.position.y = -1.2;
    titleGroup.scale.setScalar(1.3);
    titleGroup.position.set(.06, 1.62, 0);
  }

  /* ---------------- cards ---------------- */

  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const cardAspect = CARD.w / CARD.h;
  let texPending = shots.length;
  const textures = shots.map((src) => {
    const t = loader.load(src, (tex) => {
      const img = tex.image;
      if (img?.width && img?.height) {
        // object-fit: cover
        const a = img.width / img.height;
        if (a > cardAspect) { const r = cardAspect / a; tex.repeat.set(r, 1); tex.offset.set((1 - r) / 2, 0); }
        else { const r = a / cardAspect; tex.repeat.set(1, r); tex.offset.set(0, (1 - r) / 2); }
      }
      tex.needsUpdate = true;
      if (--texPending === 0) ready('textures');
    }, undefined, () => { if (--texPending === 0) ready('textures'); });
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  });

  const cardGeo = new THREE.ShapeGeometry(roundedRect(CARD.w, CARD.h, CARD.r));
  {
    // ShapeGeometry uvs are in shape units; remap to 0..1 so the map fills the card
    const uv = cardGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + CARD.w / 2) / CARD.w, (uv.getY(i) + CARD.h / 2) / CARD.h);
    uv.needsUpdate = true;
  }

  const slotList = Array.from({ length: SLOTS }, (_, i) => textures[i % textures.length]);
  const ringList = narrow ? [...slotList, ...slotList.slice(0, 3)] : [...slotList, ...slotList];
  const step = Math.PI * 2 / ringList.length;
  const cards = [];

  ringList.forEach((tex, i) => {
    const saturation = { value: 0 };
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: tex, opacity: 0, side: THREE.DoubleSide, transparent: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSaturation = saturation;
      sh.fragmentShader = `uniform float uSaturation;\n${sh.fragmentShader}`.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
  float _luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(_luma), gl_FragColor.rgb, uSaturation);
  // our screenshots run darker than the reference's white UIs; lift the
  // resting cards toward white so the band reads as pale as theirs (mean ~240)
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), ${CARD_LIFT.toFixed(2)} * (1.0 - uSaturation));`
      );
    };
    mat.customProgramCacheKey = () => 'card-saturation';

    const mesh = new THREE.Mesh(cardGeo, mat);
    const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE.color.rest, depthWrite: false, opacity: 0, transparent: true });
    const outline = new THREE.Mesh(outlineGeometry(OUTLINE.rest), outlineMat);
    outline.position.z = .006;
    outline.renderOrder = 2;
    mesh.add(outline);

    const a = i * step;
    mesh.position.set(Math.sin(a) * RADIUS, 0, Math.cos(a) * RADIUS);
    mesh.rotation.y = a + Math.PI;     // face the centre
    mesh.userData = { saturation, outline, outlineT: OUTLINE.rest, outlineMix: 0 };
    V.add(mesh);
    cards.push(mesh);
  });

  /* ---------------- title ---------------- */

  const titleWidth = (t) => measure(t, TITLE.font);
  // narrow screens stack the two words, 1.31x larger, both centred
  const NARROW_SCALE = 1.31;
  const NARROW_SPLIT = .5;
  const MAX_WORD_THETA = .68;          // what fits across a phone (half-fov 20deg)
  const titleScale = (() => {
    if (!narrow) return 1;
    const ref = titleWidth(TITLE.refPair[0]) + TITLE.gap + titleWidth(TITLE.refPair[1]);
    const widest = Math.max(...words.map((w) => titleWidth(w.toUpperCase())), titleWidth(staticWord)) * TITLE.refTheta / ref;
    return Math.min(NARROW_SCALE, MAX_WORD_THETA / widest);
  })();
  const wordY = narrow ? TITLE.y + NARROW_SPLIT : TITLE.y;
  const staticY = narrow ? TITLE.y - NARROW_SPLIT : TITLE.y;
  const layoutTitle = (word) => {
    const w = word.toUpperCase();
    const ref = titleWidth(TITLE.refPair[0]) + TITLE.gap + titleWidth(TITLE.refPair[1]);
    const o = TITLE.refTheta * titleScale / ref;
    const c = Math.max(.08, titleWidth(w) * o);
    const u = Math.max(.08, titleWidth(staticWord) * o);
    const h = TITLE.gap * o;
    return narrow
      ? { word: w, wordTheta: c, wordCenter: 0, staticTheta: u, staticCenter: 0 }
      : { word: w, wordTheta: c, wordCenter: (u + h) / 2, staticTheta: u, staticCenter: -(c + h) / 2 };
  };
  const titleStrip = (text, theta, y) => strip(
    textTexture(text, { font: TITLE.font, letterSpacing: TITLE.letterSpacing, texH: TITLE.texH, pad: TITLE.pad }),
    { stripH: TITLE.stripH * titleScale, thetaStart: -theta / 2, thetaLength: theta, y }
  );
  const typedOpts = { font: TITLE.font, letterSpacing: TITLE.letterSpacing, texH: TITLE.texH, pad: TITLE.pad, color: '#000' };

  let staticMesh = null;
  let wordMesh = null;
  let currentWord = words[0];
  let textShown = false;

  const fades = [];      // opacity / scale / rise tweens
  const turns = [];      // the static word sliding to its new centre
  const typers = [];     // typewriter jobs

  const setOpacity = (mesh, v) => { mesh.material.opacity = v; };

  const showText = (now) => {
    const L = layoutTitle(currentWord);
    staticMesh = titleStrip(staticWord, L.staticTheta, staticY);
    staticMesh.rotation.y = L.staticCenter;
    staticMesh.position.y = staticY - .28;
    staticMesh.scale.setScalar(.965);
    setOpacity(staticMesh, 0);
    titleGroup.add(staticMesh);
    fades.push({ mesh: staticMesh, start: now, duration: .72, fromY: staticY - .28, toY: staticY, fromScale: .965, toScale: 1, fromOpacity: 0, toOpacity: 1 });

    wordMesh = titleStrip(L.word, L.wordTheta, wordY);
    wordMesh.userData.word = L.word;
    wordMesh.rotation.y = L.wordCenter;
    wordMesh.position.y = wordY - .28;
    wordMesh.scale.setScalar(.965);
    setOpacity(wordMesh, 0);
    titleGroup.add(wordMesh);
    fades.push({ mesh: wordMesh, start: now, duration: .72, fromY: wordY - .28, toY: wordY, fromScale: .965, toScale: 1, fromOpacity: 0, toOpacity: 1 });

    tagMeshes.forEach((m, i) => {
      m.material.opacity = 0;
      slides.push({ mesh: m, start: now, duration: .72, from: i === 0 ? 0 : 2, to: 1 });
    });
    textShown = true;
    X.visible = true;
  };

  // later swaps: the static word glides, the old word erases, the new one types
  const swapWord = (word, now) => {
    if (!textShown || !staticMesh) { currentWord = word; return; }
    currentWord = word;
    const L = layoutTitle(word);
    turns.length = 0;
    turns.push({ mesh: staticMesh, start: now, duration: .58, from: staticMesh.rotation.y, to: L.staticCenter });

    const old = wordMesh;
    const oldWord = old?.userData.word ?? '';
    if (old) typers.push({ mesh: old, mode: 'erase', word: oldWord, interval: TITLE.typeOut, start: now, last: oldWord.length, remove: true, cooldownAt: null });
    const eraseTime = oldWord.length * TITLE.typeOut;

    const next = strip(typedTexture(L.word, 0, { ...typedOpts, outlineLast: true }), { stripH: TITLE.stripH * titleScale, thetaStart: -L.wordTheta / 2, thetaLength: L.wordTheta, y: wordY });
    next.userData.word = L.word;
    next.rotation.y = L.wordCenter;
    setOpacity(next, 1);
    titleGroup.add(next);
    wordMesh = next;
    typers.push({ mesh: next, mode: 'type', word: L.word, interval: TITLE.typeIn, start: now + eraseTime + .05, last: 0, remove: false, cooldownAt: null });
  };

  const retype = (mesh, word, count, outlineLast) => {
    mesh.material.map?.dispose();
    mesh.material.map = typedTexture(word, count, { ...typedOpts, outlineLast });
    mesh.material.needsUpdate = true;
  };

  /* ---------------- taglines ---------------- */

  const slides = [];
  const tagMeshes = [];
  {
    const n = TAG.theta / TAG.widthMul / TAG.refWidth;   // rad per texture px
    taglines.forEach((text, i) => {
      const o = measure(text, TAG.font) * n;
      const sign = i === 0 ? 1 : -1;                    // first one on screen-left (+x)
      const center = sign * (TAG.inset + o / 2);
      const tex = textTexture(text, { font: TAG.font, texH: TAG.texH, pad: TAG.pad, widthMul: TAG.theta / o, clamp: true });
      const m = strip(tex, { stripH: TAG.stripH, thetaStart: center - TAG.theta / 2, thetaLength: TAG.theta, y: TAG.y });
      m.userData.hover = 0;
      m.userData.glint = { value: 0 };
      m.geometry.computeBoundingBox();
      const pivot = new THREE.Vector3();
      m.geometry.boundingBox.getCenter(pivot);
      m.userData.pivot = pivot;
      m.userData.basePos = m.position.clone();
      const time = { value: 0 };
      m.userData.time = time;
      m.material.onBeforeCompile = (sh) => {
        sh.uniforms.uMetaHover = m.userData.glint;
        sh.uniforms.uMetaTime = time;
        sh.fragmentShader = `uniform float uMetaHover;\nuniform float uMetaTime;\n${sh.fragmentShader}`.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
  {
    float _phase = fract(uMetaTime * 0.675);
    float _c = _phase * 3.4 - 0.35;
    float _d = vMapUv.x - _c;
    float _wide = exp(-_d * _d / 0.15);
    float _core = exp(-_d * _d / 0.006);
    float _band = clamp(_wide * 0.65 + _core, 0.0, 1.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), uMetaHover * _band * 0.9);
  }`
        );
      };
      m.material.customProgramCacheKey = () => 'meta-shimmer';
      tagGroup.add(m);
      tagMeshes.push(m);
    });
  }

  /* ---------------- sizing ---------------- */

  let W = 1, H = 1, canvasH = 1, fullH = 1, topExtra = 0;
  const charBox = { left: 0, top: 0, width: 0, height: 0 };
  const corner = new THREE.Vector3();
  const charAspect = 1024 / 1536;                       // profile.png
  const charH = CHARACTER.h * (687.5 / 665);            // our cutout has no padding; keep the figure the same height
  const charBottom = CHARACTER.bottom - .079;

  // where the character lands on the canvas, so the DOM copy sits exactly there
  const projectCharacter = () => {
    const s = document.documentElement.style;
    if (narrow) {
      // the reference's mobile framing: 116% of the wheel, feet 33% below it
      const r = wheel.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const h = r.height * 1.16, w = h * charAspect;
      s.setProperty('--intro-reveal-left', `${(r.left + r.width / 2 - w / 2).toFixed(2)}px`);
      s.setProperty('--intro-reveal-top', `${(r.bottom + r.height * .33 - h).toFixed(2)}px`);
      s.setProperty('--intro-reveal-width', `${w.toFixed(2)}px`);
      s.setProperty('--intro-reveal-height', `${h.toFixed(2)}px`);
      return;
    }
    const w = charH * charAspect;
    // the first call comes before any render, when the camera's world matrix
    // (its lookAt) hasn't been applied yet — make sure it is before projecting
    camera.updateMatrixWorld(true);
    const pts = [[-w / 2, charBottom], [w / 2, charBottom], [w / 2, charBottom + charH], [-w / 2, charBottom + charH]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => {
      corner.set(x, y + GROUP_Y, CHARACTER.z).project(camera);
      const px = (corner.x * .5 + .5) * W;
      const py = (-corner.y * .5 + .5) * canvasH;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    });
    charBox.left = x0; charBox.top = y0; charBox.width = x1 - x0; charBox.height = y1 - y0;
    s.setProperty('--hero-char-left', `${x0.toFixed(2)}px`);
    s.setProperty('--hero-char-top', `${y0.toFixed(2)}px`);
    s.setProperty('--hero-char-width', `${(x1 - x0).toFixed(2)}px`);
    s.setProperty('--hero-char-height', `${(y1 - y0).toFixed(2)}px`);
    const r = canvas.getBoundingClientRect();
    s.setProperty('--intro-reveal-left', `${(r.left + x0).toFixed(2)}px`);
    s.setProperty('--intro-reveal-top', `${(r.top + y0).toFixed(2)}px`);
    s.setProperty('--intro-reveal-width', `${(x1 - x0).toFixed(2)}px`);
    s.setProperty('--intro-reveal-height', `${(y1 - y0).toFixed(2)}px`);
  };

  let lastW = 0, lastH = 0;
  const resize = () => {
    const r = stage.getBoundingClientRect();
    // nothing to do unless the stage actually changed size (iOS fires resize
    // for its address bar; the locked layout keeps the stage still)
    if (Math.round(r.width) === lastW && Math.round(r.height) === lastH) return;
    lastW = Math.round(r.width); lastH = Math.round(r.height);
    const cs = getComputedStyle(stage);
    topExtra = parseFloat(cs.getPropertyValue('--scene-top-extra')) || 0;
    const bottomExtra = parseFloat(cs.getPropertyValue('--scene-bottom-extra')) || 0;
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvasH = H + bottomExtra;
    fullH = Math.max(1, H - topExtra);
    renderer.setSize(W, canvasH, false);
    camera.fov = W < 600 ? FOV_NARROW : FOV;
    camera.aspect = W / fullH;
    if (topExtra > 0) camera.setViewOffset(W, fullH, 0, -topExtra, W, canvasH);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    projectCharacter();
  };
  resize();
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  /* ---------------- state ---------------- */

  const marquee = document.querySelector('.hero-marquee__track');
  let marqueeW = 0;
  const clock = new THREE.Clock();
  let angle = 0;              // ring rotation
  let flick = 0;              // extra velocity from a drag release or wheel
  let spinStart = null;       // when the spin-in began
  let spinning = false;
  let engaged = 0;            // cursor tilt ramps in after the intro
  let engageTarget = 0;
  let cardsIn = 0;            // cards fade to rest as this goes to 1
  let cardsTarget = 0;
  let prevT = 0;
  let onScreen = true;
  const cursor = { x: 0, y: 0 };
  const cursorTarget = { x: 0, y: 0 };

  let drag = null;            // pointerId while dragging
  let dragBase = 0, dragTime = 0, dragVel = 0;
  const held = { x: 0, y: 0 };
  let hover = null, tagHover = null;
  let pointerX = 0, pointerY = 0, pointerIn = false;

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitCard = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1));
    V.updateMatrixWorld(true);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(cards, false)[0]?.object ?? null;
  };
  const hitTag = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height || !tagGroup.visible) return null;
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1));
    K.updateMatrixWorld(true);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(tagGroup, true)[0]?.object ?? null;
  };
  // pointer x as an angle on the ring, for dragging
  const pointerAngle = (cx) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return null;
    const t = ((cx - r.left) / r.width - .5) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
    return Math.atan2(t, 1);
  };

  const readyFlags = new Set();
  let readyFired = false;
  const ready = (flag) => {
    readyFlags.add(flag);
    if (!readyFired && readyFlags.has('textures') && readyFlags.has('fonts')) { readyFired = true; onReady?.(); }
  };
  document.fonts.ready.then(() => Promise.all([
    document.fonts.load(TITLE.font).catch(() => {}),
    document.fonts.load(TAG.font).catch(() => {})
  ])).then(() => ready('fonts'));

  /* ---------------- frame ---------------- */

  const pivot = new THREE.Vector3();
  const tick = () => {
    const t = clock.getElapsedTime();
    const dt = Math.min(.05, Math.max(0, t - prevT));
    prevT = t;
    if (!onScreen || document.hidden) { requestAnimationFrame(tick); return; }

    // spin: the intro impulse eases down to the idle crawl over 3.6s
    const introSpeed = narrow ? SPIN.introNarrow : SPIN.intro;
    const settle = spinStart === null ? 0 : 1 - (1 - Math.min(1, (t - spinStart) / SPIN.settle)) ** 2;
    const speed = spinning ? lerp(introSpeed, SPIN.idle, settle) : SPIN.idle;
    if (drag === null) {
      angle += (speed + flick) * dt;
      flick *= Math.exp(-SPIN.flickDecay * dt);
      if (Math.abs(flick) < .01) flick = 0;
    }

    // cursor: smoothed, frozen while dragging, and only once the intro lets it in
    cursor.x += (cursorTarget.x - cursor.x) * TILT.cursorFollow;
    cursor.y += (cursorTarget.y - cursor.y) * TILT.cursorFollow;
    if (drag === null) { held.x = cursor.x; held.y = cursor.y; }
    engaged += (engageTarget - engaged) * TILT.engage;
    K.rotation.x = lerp(K.rotation.x, held.y * TILT.x * engaged, TILT.follow);
    K.rotation.y = lerp(K.rotation.y, held.x * TILT.y * engaged, TILT.follow);
    K.rotation.z = lerp(K.rotation.z, 0, TILT.follow);
    // the group pivots on the character's feet, so the character never drifts
    pivot.set(0, CHARACTER.bottom, CHARACTER.z).applyEuler(K.rotation);
    K.position.set(-pivot.x, GROUP_Y + CHARACTER.bottom - pivot.y, CHARACTER.z - pivot.z);
    V.rotation.y = angle;

    // title tweens
    for (let i = fades.length - 1; i >= 0; i--) {
      const f = fades[i];
      if (t < f.start) continue;
      const p = Math.min(1, (t - f.start) / f.duration);
      const e = expoOut(p);
      f.mesh.position.y = lerp(f.fromY, f.toY, e);
      f.mesh.scale.setScalar(lerp(f.fromScale, f.toScale, e));
      setOpacity(f.mesh, clamp(lerp(f.fromOpacity, f.toOpacity, e), 0, 1));
      if (p === 1) fades.splice(i, 1);
    }
    for (let i = turns.length - 1; i >= 0; i--) {
      const r = turns[i];
      const p = Math.min(1, (t - r.start) / r.duration);
      r.mesh.rotation.y = lerp(r.from, r.to, cubicOut(p));
      if (p === 1) turns.splice(i, 1);
    }
    for (let i = typers.length - 1; i >= 0; i--) {
      const j = typers[i];
      if (t < j.start) continue;
      const n = Math.floor((t - j.start) / j.interval);
      const len = j.word.length;
      if (j.mode === 'type') {
        const count = Math.min(len, n + 1);
        if (count !== j.last) { j.last = count; retype(j.mesh, j.word, count, true); }
        if (count >= len) {
          if (j.cooldownAt === null) j.cooldownAt = t + TITLE.cooldown;
          else if (t >= j.cooldownAt) { retype(j.mesh, j.word, len, false); typers.splice(i, 1); }
        }
      } else {
        const count = Math.max(0, len - n);
        if (count !== j.last) {
          j.last = count;
          if (count <= 0) { titleGroup.remove(j.mesh); disposeMesh(j.mesh); typers.splice(i, 1); }
          else retype(j.mesh, j.word, count, false);
        }
      }
    }
    // taglines slide in
    for (let i = slides.length - 1; i >= 0; i--) {
      const s = slides[i];
      const p = clamp((t - s.start) / s.duration, 0, 1);
      s.mesh.material.map.offset.x = lerp(s.from, s.to, expoOut(p));
      s.mesh.material.opacity = Math.min(1, p / .35);
      if (p === 1) slides.splice(i, 1);
    }

    // hover
    cardsIn += (cardsTarget - cardsIn) * .12;
    if (drag === null && pointerIn && textShown) {
      const c = hitCard(pointerX, pointerY);
      hover = c;
      canvas.classList.toggle('carousel-canvas--hovering', c !== null);
      tagHover = c ? null : hitTag(pointerX, pointerY);
    }
    for (const card of cards) {
      const u = card.userData;
      const on = card === hover ? 1 : 0;
      u.saturation.value += (on - u.saturation.value) * .16;
      const m = card.material;
      m.opacity += (lerp(CARD_OPACITY.rest, CARD_OPACITY.hover, on) * cardsIn - m.opacity) * .16;
      const sc = card.scale.x;
      const target = lerp(1, CARD_HOVER_SCALE, on);
      card.scale.setScalar(sc + (target - sc) * .08);
      const om = u.outline.material;
      om.opacity += (lerp(OUTLINE.opacity.rest, OUTLINE.opacity.hover, on) * cardsIn - om.opacity) * .16;
      u.outlineMix += (on - u.outlineMix) * .16;
      om.color.setHex(OUTLINE.color.rest).lerp(new THREE.Color(OUTLINE.color.hover), u.outlineMix);
      const want = lerp(OUTLINE.rest, OUTLINE.hover, on);
      const next = u.outlineT + (want - u.outlineT) * .16;
      if (Math.abs(next - u.outlineT) > 2e-4) {
        u.outlineT = next;
        u.outline.geometry.dispose();
        u.outline.geometry = outlineGeometry(next);
      }
    }
    for (const m of tagMeshes) {
      const u = m.userData;
      u.time.value += dt;
      const on = m === tagHover ? 1 : 0;
      u.hover += (on - u.hover) * .12;
      u.glint.value = u.hover;
      const s = 1 + u.hover * TAG.hoverScale;
      m.scale.setScalar(s);
      m.position.set(u.basePos.x + (1 - s) * u.pivot.x, u.basePos.y + (1 - s) * u.pivot.y, u.basePos.z + (1 - s) * u.pivot.z);
    }

    if (marquee) {
      if (marqueeW <= 0) marqueeW = marquee.scrollWidth / 2;
      if (marqueeW > 0) {
        const x = (angle * 750) % marqueeW;
        marquee.style.transform = `translate3d(${-(x < 0 ? x + marqueeW : x)}px, 0, 0)`;
      }
    }
    window.__wheelAngle = angle;
    window.__wheelSpeed = drag === null ? speed + flick : 0;
    window.__heroTilt = K.rotation.y;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  /* ---------------- input ---------------- */

  const onPointerDown = (e) => {
    if (!textShown || drag !== null) return;
    const a = pointerAngle(e.clientX);
    if (a === null || !hitCard(e.clientX, e.clientY)) return;
    drag = e.pointerId;
    dragBase = a + angle;
    dragTime = performance.now();
    dragVel = 0;
    flick = 0;
    hover = null; tagHover = null;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('carousel-canvas--dragging');
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (e.pointerId !== drag) { pointerX = e.clientX; pointerY = e.clientY; pointerIn = true; return; }
    const a = pointerAngle(e.clientX);
    if (a === null) return;
    const now = performance.now();
    const ms = Math.max(16, now - dragTime);
    const next = dragBase - a;
    dragVel = (next - angle) / ms * 1000;
    angle = next;
    dragTime = now;
    e.preventDefault();
  };
  const onPointerUp = (e) => {
    if (e.pointerId !== drag) return;
    drag = null;
    flick = clamp(dragVel, -SPIN.flickMax, SPIN.flickMax);
    dragVel = 0;
    canvas.classList.remove('carousel-canvas--dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onPointerLeave = () => {
    pointerIn = false;
    if (drag === null) { hover = null; tagHover = null; canvas.classList.remove('carousel-canvas--hovering'); }
  };
  // sideways wheel (or shift+wheel) spins the ring; plain vertical scroll is left alone
  const onWheel = (e) => {
    if (!textShown || drag !== null) return;
    const r = canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < r.height * .36 || y > r.height * .82) return;
    const d = Math.abs(e.deltaX) > .1 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (Math.abs(d) <= .1) return;
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 18 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerWidth : 1;
    const s = d * unit * 75e-5;
    angle += s * .35;
    flick = clamp(flick + s * 7, -SPIN.flickMax, SPIN.flickMax);
    e.preventDefault();
  };
  if (!narrow) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
  }

  const io = new IntersectionObserver(([en]) => { onScreen = !!en?.isIntersecting; prevT = clock.getElapsedTime(); }, { rootMargin: '180px 0px' });
  io.observe(canvas);

  return {
    // the intro: cards spin in and fade up, the title rises, the taglines slide in
    start({ still = false } = {}) {
      if (spinning) return;
      spinning = true;
      // `still` skips the spin-in (reduced motion): the ring is already settled
      spinStart = clock.getElapsedTime() - (still ? SPIN.settle : 0);
      cardsTarget = 1;
      showText(spinStart);
    },
    // lets the cursor tilt the scene
    engage() { engageTarget = 1; },
    setWord(word) { swapWord(word, clock.getElapsedTime()); },
    setCursor(x, y) { cursorTarget.x = clamp(x, -1, 1); cursorTarget.y = clamp(y, -1, 1); },
    angle: () => angle,
    characterBox: () => ({ ...charBox }),
    layout: resize
  };
}
