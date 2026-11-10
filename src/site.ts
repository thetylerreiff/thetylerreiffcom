import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { builders, setBoldEngraving, type Kind, type Station } from "./scenes";

type Look = "chrome" | "pixel";

// One fixed canvas behind the page. Each frame, every object whose slot is on screen is drawn
// into that slot's rectangle, so the objects scroll with the text.
const canvas = document.getElementById("gl") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setClearColor(0x000000, 0);

let pmrem = new THREE.PMREMGenerator(renderer);
let env = pmrem.fromScene(studio(), 0.02).texture;

// A dark studio with a few hard softboxes, so the metal reads as mirror: deep blacks and
// bright streaks rather than an even grey room.
function studio(): THREE.Scene {
  const scene = new THREE.Scene();
  // A sky dome: dark below, a hot horizon band, a soft bright ceiling.
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(20, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir; void main() {
        float y = vDir.y;
        float floorDark = smoothstep(-0.05, -0.6, y);
        vec3 c = mix(vec3(0.35), vec3(0.07), floorDark);
        c += vec3(2.4) * exp(-pow((y - 0.02) / 0.05, 2.0));
        c += vec3(0.6) * exp(-pow((y + 0.38) / 0.035, 2.0));
        c += vec3(0.9) * smoothstep(0.25, 0.95, y);
        c *= 0.6 + 0.4 * smoothstep(-1.0, 1.0, vDir.x);
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  ));
  const box = new THREE.PlaneGeometry(1, 1);
  const panel = (w: number, h: number, power: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }));
    m.scale.set(w, h, 1);
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(6, 3, 6, [0, 6, 1]);
  panel(1.2, 7, 5, [-6, 0, 2]);
  panel(0.6, 7, 4, [6, 0.5, -1]);
  panel(4, 1, 3, [2, -1, 6]);
  panel(3, 3, 1.5, [-3, 2, -6]);
  // A ring of thin strips at varied heights: lots of small hard highlights for the
  // morphing surfaces to break up and carry around.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = 7;
    panel(0.25 + (i % 3) * 0.2, 2 + (i % 4), 2.5 + (i % 3), [Math.cos(a) * r, -0.5 + (i % 5) * 0.8, Math.sin(a) * r]);
  }
  panel(8, 0.3, 4, [0, 1.5, -7]);
  panel(8, 0.2, 3, [0, -1.2, 7]);
  return scene;
}

type Slot = { el: HTMLElement; fig: HTMLElement; tags: HTMLElement[]; station: Station; target?: THREE.WebGLRenderTarget; cell?: number; arrive: number; res: number; glow: number; posed?: boolean };
const slots: Slot[] = [...document.querySelectorAll<HTMLElement>(".view")].map((el) => {
  const fig = el.closest("figure") as HTMLElement;
  return {
    el, fig,
    tags: [...fig.querySelectorAll<HTMLElement>("[data-tag]")],
    station: builders[el.dataset.obj as Kind](env),
    cell: el.dataset.cell ? Number(el.dataset.cell) : undefined,
    arrive: 0, res: 0, glow: 1,
  };
});

// The real lighting: a photographed studio (Poly Haven, CC0). The generated studio above
// lights the first frames; this replaces it as soon as it has loaded.
// The pixel look keeps the generated studio: its broad bands dither into clean gold, where
// the photo's small hot lights turn into specks.
let photo: THREE.Texture | undefined;
function applyEnv(): void {
  setBoldEngraving(look === "pixel");
  for (const slot of slots) slot.station.scene.environment = look === "pixel" || !photo ? env : photo;
}
function loadPhoto(): void {
  new HDRLoader().load("/hdri/studio_small_09_1k.hdr", (hdr) => {
    photo = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    applyEnv();
  });
}
loadPhoto();
// Each object's view of the studio, applied to whichever environment is in use.
for (const slot of slots) {
  // Flat faces mirror what is behind the camera; turn the studio so a softbox edge
  // crosses them rather than the dark back wall or the flat middle of a light.
  if (slot.el.dataset.obj === "stream" || slot.el.dataset.obj === "enclave") slot.station.scene.environmentRotation.set(0.2, Math.PI * 0.8, 0);
  // The hero turns the studio so its big softbox, not the room, fills the reflection.
  if (slot.el.dataset.obj === "blob") slot.station.scene.environmentRotation.set(0, Math.PI * 0.85, 0);
}

// If the GPU drops the context (driver reset, too many tabs), keep it restorable, then rebuild
// the environment maps, which live on the GPU and would otherwise leave every object black.
canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
canvas.addEventListener("webglcontextrestored", () => {
  pmrem = new THREE.PMREMGenerator(renderer);
  env = pmrem.fromScene(studio(), 0.02).texture;
  photo = undefined;
  applyEnv();
  loadPhoto();
});

// Each caption's tail touches a point on its object: project the point into the slot and
// hang the tag from it (tail at the tag's bottom-right for left tags, top-left for right).
const tip = new THREE.Vector3();
function placeTags(slot: Slot, r: DOMRect): void {
  const f = slot.fig.getBoundingClientRect();
  slot.tags.forEach((tag) => {
    const point = slot.station.tags[Number(tag.dataset.tag)];
    if (!point) return;
    if (point instanceof THREE.Vector3) tip.copy(point);
    else tip.copy(point.at).applyMatrix4(point.obj.matrixWorld);
    tip.project(slot.station.camera);
    const x = (tip.x * 0.5 + 0.5) * r.width + r.left - f.left;
    const y = (-tip.y * 0.5 + 0.5) * r.height + r.top - f.top;
    // Keep the whole tag on screen. If that would push it back over its object, hang it from
    // the other side instead, with the tail flipped to match.
    // On desktop a caption may reach into the gutter but never over the text column.
    const minL = (wide.matches ? text.getBoundingClientRect().right + 12 : 8) - f.left;
    const edge = wide.matches ? Math.min(document.documentElement.clientWidth, track.getBoundingClientRect().right + 32) : document.documentElement.clientWidth;
    const maxL = edge - 8 - f.left - tag.offsetWidth;
    const leftSide = tag.classList.contains("tag-l");
    let want = leftSide ? x - tag.offsetWidth + 14 : x - 14;
    let flip = false;
    if (want < minL - 16 || want > maxL + 16) {
      flip = true;
      want = leftSide ? x - 14 : x - tag.offsetWidth + 14;
    }
    // The mirrored side would land on the object. Hang the tag just above (left tags) or below
    // (right tags) the object itself.
    if (flip) {
      tag.classList.remove("flip");
      const left = Math.max(minL, Math.min(x - tag.offsetWidth / 2, maxL));
      const [minY, maxY] = extent(slot, r, f);
      const top = leftSide ? minY - tag.offsetHeight - 8 : maxY + 8;
      tag.style.inset = `${Math.round(top)}px auto auto ${Math.round(left)}px`;
      return;
    }
    tag.classList.toggle("flip", flip);
    const left = Math.max(minL, Math.min(want, maxL));
    const top = leftSide !== flip ? y - tag.offsetHeight - 4 : y + 4;
    tag.style.inset = `${Math.round(top)}px auto auto ${Math.round(left)}px`;
  });
}

// The object's vertical extent on screen, from each mesh's bounding sphere (so round objects
// are not over-estimated the way a box would be). Refreshed every ten frames.
const sphere = new THREE.Sphere();
// Cached in object-local terms (offset from the slot's top) and refreshed every ten frames.
const extentCache = new WeakMap<Slot, [number, number]>();
function extent(slot: Slot, r: DOMRect, f: DOMRect): [number, number] {
  const cached = extentCache.get(slot);
  const offset = r.top - f.top;
  if (cached && frameNo % 10 !== 0) return [cached[0] + offset, cached[1] + offset];
  const { scene, camera } = slot.station;
  scene.updateMatrixWorld(true);
  let minY = Infinity, maxY = -Infinity;
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const add = (p: THREE.Vector3) => {
      p.project(camera);
      const py = (-p.y * 0.5 + 0.5) * r.height;
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    };
    if (o.geometry instanceof THREE.SphereGeometry) {
      // Spheres: the projected top and bottom of the ball.
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      sphere.copy(o.geometry.boundingSphere!).applyMatrix4(o.matrixWorld);
      add(tip.copy(sphere.center).setY(sphere.center.y - sphere.radius));
      add(tip.copy(sphere.center).setY(sphere.center.y + sphere.radius));
    } else {
      // Anything else (rods, sheets, bubbles): the corners of its own box, which follow its
      // orientation, so a lying rod is not counted as tall.
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox!;
      for (let c = 0; c < 8; c++) add(tip.set(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld));
    }
  });
  extentCache.set(slot, [minY, maxY]);
  return [minY + offset, maxY + offset];
}

// Desktop: each group of objects starts beside the passage it illustrates, or just below the
// group before it if that runs long. The text is never moved; the wires between groups
// stretch to fill the gaps. When the objects outlast the text, the text column sticks once its
// end reaches the bottom of the screen, so the last objects scroll past the contact details.
const track = document.querySelector<HTMLElement>(".track")!;
const text = document.querySelector<HTMLElement>(".text")!;
const groups = [...track.querySelectorAll<HTMLElement>(".grp")];
const leads = [...track.querySelectorAll<HTMLElement>(".lead")];
const wide = window.matchMedia("(min-width: 1201px)");
const GAP = 104;
function layout(): void {
  groups.forEach((g) => { g.style.top = ""; });
  leads.forEach((l) => { l.style.top = ""; l.style.height = ""; });
  track.style.height = "";
  text.style.top = "";
  if (!wide.matches) return;
  const origin = () => track.getBoundingClientRect().top;
  let cursor = 0;
  groups.forEach((g, i) => {
    const anchor = document.getElementById(g.dataset.anchor!)!;
    const top = Math.max(anchor.getBoundingClientRect().top - origin() + Number(g.dataset.shift ?? 0), i === 0 ? 0 : cursor + GAP);
    g.style.top = `${top}px`;
    if (i > 0) {
      leads[i - 1].style.top = `${cursor + 10}px`;
      leads[i - 1].style.height = `${top - cursor - 20}px`;
    }
    cursor = top + g.offsetHeight;
  });
  track.style.height = `${cursor}px`;
  text.style.top = `${Math.min(0, window.innerHeight - text.offsetHeight)}px`;
}
// Desktop: light the passage that the object nearest mid-screen illustrates.
function guide(): void {
  const on = wide.matches;
  document.body.classList.toggle("pinned", on && text.getBoundingClientRect().top < -1);
  const mid = window.innerHeight / 2;
  let best: HTMLElement | undefined, dist = Infinity;
  if (on) for (const g of groups) {
    const r = g.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < dist) { dist = d; best = g; }
  }
  // At the very bottom the page rests on the coin: light the contact line.
  if (on && window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 4) best = groups[groups.length - 1];
  const at = best ? groups.indexOf(best) : -1;
  leads.forEach((l, i) => l.classList.toggle("full", i < at));
  // Phones: a wire turns gold once its object has come up the screen.
  groups.forEach((g) => g.classList.toggle("fed", !on && g.getBoundingClientRect().top < mid * 1.3));
  const id = best?.dataset.topic;
  text.querySelectorAll(".topic").forEach((el) => el.classList.toggle("current", el.id === id));
  current = best && id ? { passage: document.getElementById(id)!, group: best } : undefined;
}
let current: { passage: HTMLElement; group: HTMLElement } | undefined;

// The leader: from the lit passage's gold rule across to its object's caption, redrawn each
// frame because the caption follows its moving object.
const leader = document.getElementById("leader")!;
const leaderLine = leader.querySelector("polyline")!;
const leaderDot = leader.querySelector("circle")!;
function drawLeader(): void {
  const show = !!current && wide.matches;
  if (show) {
    // End at the object's near side: its left-hand caption if it has one, otherwise the left
    // edge of its slot, level with the passage where possible. Never across the object.
    const p = current!.passage.getBoundingClientRect();
    const x1 = text.getBoundingClientRect().right + 16, y1 = p.top + 11;
    const tagL = current!.group.querySelector<HTMLElement>(".tag-l:not(.flip)");
    const fig = current!.group.querySelector<HTMLElement>("figure")!.getBoundingClientRect();
    let x2: number, y2: number;
    if (tagL) {
      const tg = tagL.getBoundingClientRect();
      x2 = tg.left - 6; y2 = tg.top + tg.height / 2;
    } else {
      x2 = fig.left + 2; y2 = Math.min(Math.max(y1, fig.top + fig.height * 0.3), fig.top + fig.height * 0.7);
    }
    const visible = y1 > 0 && y1 < window.innerHeight && y2 > 0 && y2 < window.innerHeight && x2 > x1;
    leaderLine.classList.toggle("on", visible);
    leaderDot.classList.toggle("on", visible);
    // An elbow, like the wires: out from the passage, down (or up) the gutter, into the object.
    const xm = Math.round((x1 + Math.min(x2, fig.left)) / 2);
    leaderLine.setAttribute("points", `${x1},${y1} ${xm},${y1} ${xm},${y2} ${x2},${y2}`);
    leaderDot.setAttribute("cx", String(x1)); leaderDot.setAttribute("cy", String(y1));
  } else {
    leaderLine.classList.remove("on");
    leaderDot.classList.remove("on");
  }
}
window.addEventListener("scroll", guide, { passive: true });
guide();

// The hero answers the mouse: fully when the pointer is near it, gently for a reader's cursor
// anywhere else on the page. Mouse only; touch has no hover.
const blobSlot = slots.find((s) => s.el.dataset.obj === "blob");
if (blobSlot?.station.pointer) {
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = blobSlot.el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    blobSlot.station.pointer!(x, y, true, Math.hypot(x, y) < 2.2 ? 1 : 0.45);
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => blobSlot.station.pointer!(0, 0, false, 0));
}

// The coin turns to face the visitor while they point at it or focus its link.
const coinLink = document.querySelector<HTMLAnchorElement>(".coin-link");
const coinSlot = slots.find((s) => s.el.dataset.obj === "coin");
if (coinLink && coinSlot?.station.hover) {
  const set = (on: boolean) => () => coinSlot.station.hover!(on);
  coinLink.addEventListener("pointerenter", set(true));
  coinLink.addEventListener("pointerleave", set(false));
  coinLink.addEventListener("focus", set(true));
  coinLink.addEventListener("blur", set(false));
  const caption = coinSlot.fig.querySelector<HTMLElement>(".tag");
  caption?.addEventListener("click", () => coinLink.click());
  caption?.addEventListener("pointerenter", set(true));
  caption?.addEventListener("pointerleave", set(false));
}

// Phones: move each group into its slot in the text, so the story runs alongside the words;
// back into the track on wider screens.
const slotsInText = [...document.querySelectorAll<HTMLElement>(".mslot")];
function place(): void {
  if (wide.matches) {
    groups.forEach((g, i) => { if (g.parentElement !== track) track.insertBefore(g, leads[i] ?? null); });
    return;
  }
  for (const slot of slotsInText) {
    for (const i of slot.dataset.for!.split(" ").map(Number)) slot.appendChild(groups[i]);
  }
}
place();
wide.addEventListener("change", place);

layout();
document.fonts?.ready.then(layout);
new ResizeObserver(() => requestAnimationFrame(layout)).observe(text);
window.addEventListener("resize", layout);
wide.addEventListener("change", layout);

// Pixel look: draw the scene small, then quantize it to near-black and three golds with an
// ordered dither, one screen block per texel. Bigger objects get bigger blocks, so every
// object is about the same number of pixels across.
const cell = (w: number) => Math.max(3, Math.min(5, Math.round(w / 90)));
const dither = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { map: { value: null }, size: { value: new THREE.Vector2() }, cut: { value: -1 } },
  vertexShader: /* glsl */ `
    out vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec2 size;
    uniform float cut;
    in vec2 vUv;
    out vec4 outColor;
    const float bayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    const vec3 golds[4] = vec3[4](vec3(.16, .11, .05), vec3(.45, .32, .1), vec3(.85, .65, .26), vec3(1., .94, .75));
    void main() {
      vec2 px = floor(vUv * size);
      vec4 c = texture(map, (px + .5) / size);
      if (c.a < .5) discard;
      float th = (bayer[int(mod(px.y, 4.)) * 4 + int(mod(px.x, 4.))] + .5) / 16.;
      // Above the cut the pixels have given way to chrome; the dither pattern frays the edge.
      if (1. - (px.y + .5) / size.y < cut + (th - .5) * .16) discard;
      vec3 col = c.rgb / (1. + c.rgb);
      float lum = pow(dot(col, vec3(.299, .587, .114)), 1. / 2.2);
      float v = clamp(lum * 1.25, 0., 1.) * 3.;
      int i = int(min(floor(v) + step(th, fract(v)), 3.));
      outColor = vec4(golds[i], 1.);
    }
  `,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dither);
const quadScene = new THREE.Scene().add(quad);
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// The look toggle, remembered per visitor and overridable with ?look=pixel.
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-look]")];
function readLook(): Look {
  const q = new URLSearchParams(location.search).get("look");
  if (q === "chrome" || q === "pixel") return q;
  try { return localStorage.getItem("look") === "pixel" ? "pixel" : "chrome"; } catch { return "chrome"; }
}
let look = readLook();
function setLook(next: Look): void {
  look = next;
  buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.look === next)));
  document.documentElement.dataset.look = next;
  applyEnv();
  try { localStorage.setItem("look", next); } catch { /* storage blocked: fine */ }
}
buttons.forEach((b) => b.addEventListener("click", () => setLook(b.dataset.look as Look)));
setLook(look);

const still = window.matchMedia("(prefers-reduced-motion: reduce)");
const ring = document.querySelector<SVGElement>(".ring");
let t = 0;
let last = performance.now();

let frameNo = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  frameNo++;
  const dt = Math.min(now - last, 100) / 1000;
  const real = Math.min(now - last, 1000) / 1000; // wall time, so a slow frame cannot stall a dissolve
  if (!still.matches) t += Math.min(dt, 0.05);
  last = now;

  const w = document.documentElement.clientWidth;
  const h = window.innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) {
    renderer.setSize(w, h, false);
    canvas.style.height = `${h}px`;
  }
  // Pin the canvas to the scroll position this frame is drawn for. Scrolling runs ahead of
  // drawing; this way the picture moves with the page until the next frame catches up.
  canvas.style.transform = `translate3d(0, ${window.scrollY}px, 0)`;

  renderer.setScissorTest(false);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.setScissorTest(true);

  drawLeader();
  // The career ring drifts, and turns with the scroll: the years go by as the story does.
  if (ring && !still.matches) ring.style.transform = `rotate(${(-(t * 4 + window.scrollY * 0.1)).toFixed(2)}deg)`;
  const end = document.documentElement.scrollHeight - h - window.scrollY;
  for (const slot of slots) {
    const r = slot.el.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
    const { scene, camera, update } = slot.station;
    // Arrival: 0 while the object is still below the fold, 1 once most of it is on screen
    // (or as far up as it can get at the end of the page).
    const reach = (top: number) => (h - top) / (r.height * 0.8);
    const atEnd = reach(r.top + window.scrollY - (document.documentElement.scrollHeight - h));
    const target = still.matches ? 1 : Math.min(1, Math.max(0, reach(r.top) / Math.min(1, Math.max(0.2, atEnd))));
    slot.arrive = still.matches ? 1 : slot.arrive + (target - slot.arrive) * (1 - Math.exp(-dt * 3.5));
    // With reduced motion nothing moves, so pose each object once instead of every frame.
    if (!still.matches || !slot.posed) { update(t, slot.arrive); slot.posed = true; }
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    const y = h - r.bottom;
    placeTags(slot, r);

    // The pipeline lights the object it has reached; the others sit back a little. Not in the
    // pixel look, where less light dithers to brown speckle (and the hero is lit harder for it).
    const lit = !current || look === "pixel" ? 1 : current.group.contains(slot.el) ? 1.1 : 0.88;
    slot.glow = still.matches ? lit : slot.glow + (lit - slot.glow) * (1 - Math.exp(-dt * 4));
    scene.environmentIntensity = slot.glow * (look === "pixel" && slot === blobSlot ? 2.2 : 1);

    // Chrome look: every object arrives as raw pixels and, once its top is well into view,
    // dissolves into chrome from the top down over about a second. The hero does it as the page
    // loads. Once refined it stays refined, however the reader scrolls.
    const want = slot.res === 1 || r.top < h * 0.8 || end < 4 ? 1 : 0;
    slot.res = look === "pixel" ? 0 : still.matches ? 1 : slot.res + (want - slot.res) * (1 - Math.exp(-real * 2.4));
    if (slot.res > 0.995) slot.res = 1;
    const cut = slot.res * 1.16 - 0.08;
    const chromeRows = Math.round(r.height * Math.min(1, Math.max(0, cut + 0.08)));
    const chrome = (): void => {
      renderer.setViewport(r.left, y, r.width, r.height);
      renderer.setScissor(r.left, y + r.height - chromeRows, r.width, chromeRows);
      renderer.render(scene, camera);
    };
    if (slot.res === 1) { chrome(); continue; }


    const px = slot.cell ?? cell(r.width);
    const tw = Math.max(1, Math.round(r.width / px));
    const th = Math.max(1, Math.round(r.height / px));
    if (!slot.target) {
      slot.target = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    } else if (slot.target.width !== tw || slot.target.height !== th) {
      slot.target.setSize(tw, th);
    }
    renderer.setRenderTarget(slot.target);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, tw, th);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    if (chromeRows > 0) chrome();
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    dither.uniforms.map.value = slot.target.texture;
    (dither.uniforms.size.value as THREE.Vector2).set(tw, th);
    dither.uniforms.cut.value = cut;
    // Drawn over the chrome already there, so this pass must not clear it.
    renderer.autoClear = false;
    renderer.render(quadScene, quadCam);
    renderer.autoClear = true;
  }
}
requestAnimationFrame(frame);
