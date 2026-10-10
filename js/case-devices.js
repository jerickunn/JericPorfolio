/* ============================================================
   Case devices — the reference ships a pre-rendered clip per case of a white
   phone (or tablet) flying into place, drawn as a line sketch first and
   filling in mid-flight. We can't use its clips, so the same devices are
   modelled here and animated along the same paths, with Jeric's screenshots
   on their screens.

   One hidden WebGL renderer draws every section; each frame is copied into
   that section's own 2D canvas (three.js's "multiple elements" pattern), so
   there is a single GL context and idle sections cost nothing.
   ============================================================ */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const FOV = 28;
const DURATION = { phone: 2.65, tablet: 2.3 };   // the clips' lengths
const REVERSE_RATE = 4;                          // the reversed clip plays at 4x
const SETTLE_AT = .6;                            // fraction of the clip after which the device is still
const SKETCH = { from: .3, to: .62 };            // the line drawing fills in over this window

const deg = THREE.MathUtils.degToRad;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const expoOut = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

// millimetres; the camera distance is derived so the settled device fills
// the fraction of the box measured on the reference
const SPEC = {
  // rim = the white body showing around the black bezel plate on the front
  phone:  { w: 71.5, h: 146.7, d: 7.8, r: 10, rim: 2.6, bezel: 2.4, screenR: 7.5, island: true, buttons: true },
  tablet: { w: 247, h: 178, d: 6.1, r: 12, rim: 3.2, bezel: 6, screenR: 5, island: false, buttons: false, camera: true }
};

/* Where each layout starts and ends, in box units (x, y ∈ −.5..+.5 of the
   canvas box; the settled numbers are the reference's measured poses). */
const PATHS = {
  // the reference's settled poses inside its clip boxes: the phone at
  // (24.6%, 42%) of its box, 84% of the box tall; the tablet low in its square
  'phone-left': {
    kind: 'phone', fill: .84,
    from: { x: -.55, y: .55, rx: 10, ry: -80, rz: 35 },
    to:   { x: -.2, y: .08, rx: 6, ry: 22, rz: 12 }
  },
  'phone-right': {
    kind: 'phone', fill: .84,
    from: { x: .55, y: .55, rx: 10, ry: 80, rz: -35 },
    to:   { x: .2, y: .08, rx: 6, ry: -22, rz: -12 }
  },
  tablet: {
    kind: 'tablet', fill: .84,
    from: { x: -.35, y: -.75, rx: -40, ry: 0, rz: -28 },
    to:   { x: 0, y: .01, rx: 9, ry: -8, rz: -2 }
  }
};

/* Each tablet case enters its own way (data-entrance on the section); they all
   settle into the same pose. */
const TABLET_ENTRANCES = {
  rise:          { x: -.35, y: -.75, rx: -40, ry: 0, rz: -28 },    // up from below, leaning back
  'slide-left':  { x: -.9, y: .1, rx: 0, ry: -85, rz: 12 },        // in from the left, edge-on
  'slide-right': { x: .9, y: .1, rx: 0, ry: 85, rz: -12 },         // in from the right, edge-on
  drop:          { x: .2, y: .8, rx: 70, ry: 25, rz: 20 }          // down from above, face-down, spinning in
};

function roundedRectShape(w, h, r) {
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

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/* ---------------- the device ---------------- */

// Two looks of the same parts: `solid` is the PBR white device, `sketch` is
// the white-filled line drawing (an inverted hull for the silhouette plus
// hard edges). They crossfade mid-flight.
function buildDevice(spec, texture) {
  const group = new THREE.Group();
  const solid = new THREE.Group();
  const sketch = new THREE.Group();
  group.add(solid, sketch);

  const solidMats = [];
  const sketchMats = [];
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xececee, metalness: .55, roughness: .32, clearcoat: .6, clearcoatRoughness: .25, transparent: true, opacity: 0 });
  const railMat = new THREE.MeshPhysicalMaterial({ color: 0xd6d6d9, metalness: .9, roughness: .28, transparent: true, opacity: 0 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: .2, roughness: .6, transparent: true, opacity: 0 });
  const screenMat = new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xffffff : 0xf2f2f2, transparent: true, opacity: 0, toneMapped: false });
  const glossMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: .05, transparent: true, opacity: 0, envMapIntensity: 1.6, depthWrite: false });
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: .5, transparent: true, opacity: 0 });
  solidMats.push(bodyMat, railMat, bezelMat, screenMat, glossMat, islandMat);

  const sketchFill = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
  const sketchLine = new THREE.MeshBasicMaterial({ color: 0x9a9a9a, side: THREE.BackSide, transparent: true, opacity: 1 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 1 });
  sketchMats.push(sketchFill, sketchLine, edgeMat);

  const { w, h, d, r } = spec;
  const half = d / 2;

  // body
  const bodyGeo = new RoundedBoxGeometry(w, h, d, 6, r);
  solid.add(new THREE.Mesh(bodyGeo, bodyMat));
  // a hair-proud rail around the sides catches the light like the real frame
  const railGeo = new RoundedBoxGeometry(w + .5, h + .5, d - 1.2, 6, r + .25);
  solid.add(new THREE.Mesh(railGeo, railMat));

  // front: bezel plate, then the screen inside it, then the gloss
  const bezelGeo = new THREE.ShapeGeometry(roundedRectShape(w - spec.rim * 2, h - spec.rim * 2, r - spec.rim), 24);
  const bezel = new THREE.Mesh(bezelGeo, bezelMat);
  bezel.position.z = half + .05;
  solid.add(bezel);

  const sw = w - (spec.rim + spec.bezel) * 2, sh = h - (spec.rim + spec.bezel) * 2;
  const screenGeo = new THREE.ShapeGeometry(roundedRectShape(sw, sh, spec.screenR), 24);
  {
    const uv = screenGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + sw / 2) / sw, (uv.getY(i) + sh / 2) / sh);
    uv.needsUpdate = true;
  }
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.z = half + .12;
  solid.add(screen);
  const gloss = new THREE.Mesh(screenGeo, glossMat);
  gloss.position.z = half + .2;
  gloss.renderOrder = 3;
  solid.add(gloss);

  if (spec.island) {
    const island = new THREE.Mesh(new RoundedBoxGeometry(18, 5.4, .6, 3, 2.6), islandMat);
    island.position.set(0, sh / 2 - 6.2, half + .3);
    solid.add(island);
  }
  if (spec.camera) {
    const cam = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), islandMat);
    cam.position.set(0, sh / 2 + spec.bezel / 2, half + .16);
    solid.add(cam);
  }
  if (spec.buttons) {
    const mk = (bw, bh, x, y) => {
      const b = new THREE.Mesh(new RoundedBoxGeometry(1.2, bh, d * .45, 2, .5), railMat);
      b.position.set(x, y, 0);
      solid.add(b);
      return b;
    };
    mk(1.2, 7, -w / 2 - .4, h * .27);       // silent switch
    mk(1.2, 13, -w / 2 - .4, h * .16);      // volume up
    mk(1.2, 13, -w / 2 - .4, h * .04);      // volume down
    mk(1.2, 20, w / 2 + .4, h * .12);       // power
  }

  // sketch: white fill + inverted-hull silhouette + hard edges
  solid.children.forEach((m) => {
    if (m.geometry === screenGeo && m.material === glossMat) return;
    const fill = new THREE.Mesh(m.geometry, sketchFill);
    fill.position.copy(m.position);
    sketch.add(fill);
    if (m.geometry === bodyGeo || m.geometry === railGeo || m.material === railMat) {
      const hull = new THREE.Mesh(m.geometry, sketchLine);
      hull.position.copy(m.position);
      hull.scale.setScalar(1.012);
      sketch.add(hull);
    }
    if (m.geometry !== bodyGeo && m.geometry !== railGeo) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), edgeMat);
      edges.position.copy(m.position);
      edges.position.z += .02;
      sketch.add(edges);
    }
  });

  return { group, solidMats, sketchMats };
}

/* ============================================================ */

export function createCaseDevices(sections, { waitFor } = {}) {
  if (!webglOk()) return null;

  const gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  gl.setClearColor(0xffffff, 0);
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  gl.setPixelRatio(DPR);
  const pmrem = new THREE.PMREMGenerator(gl);
  const env = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  pmrem.dispose();
  const loader = new THREE.TextureLoader();

  const views = new Map();

  const setup = (section) => {
    const layout = section.dataset.layout;
    const path = PATHS[layout];
    const canvas = section.querySelector('.case-device__canvas');
    if (!path || !canvas) return null;
    const spec = SPEC[path.kind];

    const scene = new THREE.Scene();
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 4000);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-1, 1.4, 1.2);
    scene.add(key, new THREE.AmbientLight(0xffffff, .25));

    // the settled device spans `fill` of the box's shorter side
    const size = path.kind === 'phone' ? spec.h : spec.w;
    const visible = size / path.fill;
    const dist = visible / (2 * Math.tan(deg(FOV / 2)));
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);

    let texLoaded = false;
    const device = buildDevice(spec, null);
    scene.add(device.group);

    const from = (path.kind === 'tablet' && TABLET_ENTRANCES[section.dataset.entrance]) || path.from;
    const view = {
      section, canvas, ctx: canvas.getContext('2d'), scene, camera, device, path, from, spec, visible,
      t: 0, dir: 0, rate: 1, raf: 0, last: 0, w: 0, h: 0, drawn: -1
    };

    view.loadTexture = () => {
      if (texLoaded) return;
      texLoaded = true;
      const screenAspect = (spec.w - (spec.rim + spec.bezel) * 2) / (spec.h - (spec.rim + spec.bezel) * 2);
      loader.load(section.dataset.shot, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = gl.capabilities.getMaxAnisotropy();
        const img = t.image;
        const a = img.width / img.height;
        // object-fit: cover, anchored to the top of the shot
        if (a > screenAspect) { const r = screenAspect / a; t.repeat.set(r, 1); t.offset.set((1 - r) / 2, 0); }
        else { const r = a / screenAspect; t.repeat.set(1, r); t.offset.set(0, 1 - r); }
        const mat = device.solidMats[3];
        mat.map = t;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        view.drawn = -1;
        draw(view);
      });
    };
    return view;
  };

  // narrow screens centre the device under the copy
  const narrow = matchMedia('(max-width: 760px)');
  const pose = (view) => {
    const { path, device, t, visible, camera } = view;
    const e = expoOut(clamp(t / SETTLE_AT, 0, 1));
    const A = view.from;
    const B = narrow.matches ? { ...path.to, x: 0, y: 0 } : path.to;
    const vw = visible * camera.aspect, vh = visible;
    const g = device.group;
    g.position.set(THREE.MathUtils.lerp(A.x, B.x, e) * vw, THREE.MathUtils.lerp(A.y, B.y, e) * vh, 0);
    g.rotation.set(deg(THREE.MathUtils.lerp(A.rx, B.rx, e)), deg(THREE.MathUtils.lerp(A.ry, B.ry, e)), deg(THREE.MathUtils.lerp(A.rz, B.rz, e)));
    // sketch → solid
    const f = clamp((t - SKETCH.from) / (SKETCH.to - SKETCH.from), 0, 1);
    device.solidMats.forEach((m) => { m.opacity = m === device.solidMats[4] ? f * .16 : f; });
    device.sketchMats.forEach((m) => { m.opacity = 1 - f; });
    device.group.children[1].visible = f < 1;
    device.group.children[0].visible = f > 0;
  };

  const fit = (view) => {
    const r = view.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === view.w && h === view.h) return;
    view.w = w; view.h = h;
    view.canvas.width = Math.round(w * DPR);
    view.canvas.height = Math.round(h * DPR);
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
    view.drawn = -1;
  };

  const draw = (view) => {
    fit(view);
    if (view.drawn === view.t) return;
    view.drawn = view.t;
    pose(view);
    gl.setSize(view.w, view.h, false);
    gl.render(view.scene, view.camera);
    const c = view.canvas;
    view.ctx.clearRect(0, 0, c.width, c.height);
    view.ctx.drawImage(gl.domElement, 0, 0, c.width, c.height);
  };

  const step = (view) => (now) => {
    view.raf = 0;
    const dt = Math.min(.05, (now - view.last) / 1000);
    view.last = now;
    const dur = DURATION[view.path.kind];
    view.t = clamp(view.t + view.dir * view.rate * dt / dur, 0, 1);
    draw(view);
    if ((view.dir > 0 && view.t < 1) || (view.dir < 0 && view.t > 0)) view.raf = requestAnimationFrame(step(view));
    else {
      view.dir = 0;
      if (view.t === 0) view.canvas.parentElement.classList.remove('is-on');
    }
  };
  const run = (view, dir, rate) => {
    view.dir = dir; view.rate = rate;
    view.last = performance.now();
    if (!view.raf) view.raf = requestAnimationFrame(step(view));
  };

  sections.forEach((s) => { const v = setup(s); if (v) views.set(s, v); });

  // textures are fetched once a section is within reach, and never before the
  // hero has its own art — otherwise they share the connection with it
  const watchTextures = () => {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { views.get(en.target)?.loadTexture(); io.unobserve(en.target); } });
      }, { rootMargin: '150% 0px' });
      views.forEach((_, s) => io.observe(s));
    } else views.forEach((v) => v.loadTexture());
  };
  if (waitFor) waitFor.then(watchTextures); else watchTextures();

  window.addEventListener('resize', () => views.forEach((v) => { if (v.canvas.parentElement.classList.contains('is-on')) { v.drawn = -1; draw(v); } }));

  return {
    play(section) {
      const v = views.get(section); if (!v) return;
      v.loadTexture();
      v.canvas.parentElement.classList.add('is-on');
      if (v.t < 1) run(v, 1, 1);
    },
    reverse(section) {
      const v = views.get(section); if (!v) return;
      if (v.t > 0) run(v, -1, REVERSE_RATE); else v.canvas.parentElement.classList.remove('is-on');
    },
    settle(section) {
      const v = views.get(section); if (!v) return;
      v.loadTexture();
      v.canvas.parentElement.classList.add('is-on');
      v.t = 1;
      draw(v);
    },
    progress: (section) => views.get(section)?.t ?? null
  };
}
