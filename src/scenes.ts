import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type Station = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  // t: seconds. s: arrival, 0 as the object scrolls into view, 1 once it has arrived.
  update: (t: number, s: number) => void;
  // Optional: react when the visitor points at the object.
  hover?: (on: boolean) => void;
  // Optional: the pointer relative to the object's slot, -1..1 each way (y up), and whether it
  // is near enough to count.
  pointer?: (x: number, y: number, active: boolean, strength: number) => void;
  // Where each caption's tail should touch, in figcaption order: a fixed point in the scene,
  // or a point on an object that moves with it.
  tags: (THREE.Vector3 | { obj: THREE.Object3D; at: THREE.Vector3 })[];
};

export type Kind = "blob" | "crystal" | "signal" | "stream" | "enclave" | "coin";

const GOLD = new THREE.Color().setRGB(1.0, 0.766, 0.336, THREE.LinearSRGBColorSpace);

// Polished gold: the metal's linear reflectance, nearly mirror smooth.
export function goldMaterial(roughness = 0.08): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: GOLD, metalness: 1, roughness, clearcoat: 0.4, clearcoatRoughness: 0.05 });
}

function station(env: THREE.Texture, z: number, fov = 32): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.environment = env;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 50);
  camera.position.set(0, 0, z);
  return { scene, camera };
}

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const ease = (a: number, b: number, s: number) => { const k = Math.min(1, Math.max(0, (s - a) / (b - a))); return k * k * (3 - 2 * k); };

// A smooth sphere with welded seams, so per-frame normals stay clean on a mirror finish.
function weldedSphere(detail: number): THREE.BufferGeometry {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail));
  g.computeVertexNormals();
  return g;
}

// A rod between two points.
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 16), mat);
  m.scale.y = dir.length();
  m.quaternion.setFromUnitVectors(v(0, 1), dir.normalize());
  m.position.copy(a).add(b).multiplyScalar(0.5);
  return m;
}

// The engraving for the coin and the seal: a height map, white raised on grey.
let engraving: THREE.CanvasTexture | undefined;
let redraw: (() => void) | undefined;
let boldEngraving = false;

// The pixel look dithers fine lettering into noise; it gets a bolder die: no rim text, a
// heavy rim and a big monogram.
export function setBoldEngraving(bold: boolean): void {
  if (bold === boldEngraving) return;
  boldEngraving = bold;
  redraw?.();
}
function drawBold(g: CanvasRenderingContext2D): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#6a6a6a";
  g.fillRect(0, 0, 2048, 2048);
  g.setTransform(2, 0, 0, 2, 1024, 1024);
  g.strokeStyle = g.fillStyle = "#fff";
  g.lineWidth = 60;
  g.beginPath(); g.arc(0, 0, 470, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 22;
  g.beginPath(); g.arc(0, 0, 360, 0, Math.PI * 2); g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 380px 'Geist Mono', ui-monospace, monospace";
  g.fillText("TR", 0, 24);
}
function engravingTexture(): THREE.CanvasTexture {
  if (engraving) return engraving;
  const c = document.createElement("canvas");
  c.width = c.height = 2048;
  const tex = new THREE.CanvasTexture(c);
  // The cylinder's cap UVs run sideways; turn the art upright.
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 2;
  tex.anisotropy = 8;
  const draw = () => {
    const g = c.getContext("2d")!;
    if (boldEngraving) { drawBold(g); tex.needsUpdate = true; return; }
    g.fillStyle = "#6a6a6a";
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillRect(0, 0, 2048, 2048);
    g.setTransform(2, 0, 0, 2, 1024, 1024);
    g.strokeStyle = g.fillStyle = "#fff";
    g.lineWidth = 26;
    g.beginPath(); g.arc(0, 0, 486, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 6;
    g.beginPath(); g.arc(0, 0, 330, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * 452, Math.sin(a) * 452, 7, 0, Math.PI * 2); g.fill();
    }
    // Rim lettering the way a coin is struck: the top arc reads clockwise over the crown,
    // the bottom arc reads left to right along the foot.
    g.font = "500 58px 'Geist Mono', ui-monospace, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const arc = (text: string, bottom: boolean) => {
      const step = 0.135;
      const span = step * (text.length - 1);
      for (let i = 0; i < text.length; i++) {
        g.save();
        if (bottom) {
          g.rotate(span / 2 - i * step);
          g.translate(0, 392);
        } else {
          g.rotate(-span / 2 + i * step);
          g.translate(0, -392);
        }
        g.fillText(text[i], 0, 0);
        g.restore();
      }
    };
    arc("TYLER REIFF", false);
    arc("FROM LAB TO MISSION", true);
    for (const x of [-392, 392]) { g.beginPath(); g.arc(x, 0, 14, 0, Math.PI * 2); g.fill(); }
    // A five-pointed star over the monogram.
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 34 : 86;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r - 150);
    }
    g.closePath(); g.fill();
    g.font = "500 230px 'Geist Mono', ui-monospace, monospace";
    g.fillText("TR", 0, 50);
    g.font = "500 44px 'Geist Mono', ui-monospace, monospace";
    g.fillText("EST · 2015", 0, 210);
    g.setTransform(1, 0, 0, 1, 0, 0);
    tex.needsUpdate = true;
  };
  draw();
  redraw = draw;
  document.fonts?.ready.then(draw);
  engraving = tex;
  return tex;
}

function engravedGold(roughness = 0.12): THREE.MeshPhysicalMaterial {
  const m = goldMaterial(roughness);
  m.bumpMap = engravingTexture();
  m.bumpScale = 6;
  return m;
}

// The hero: a molten form. Low waves swell it, higher ones pucker the surface into dimples
// and ridges that travel, so the reflections keep breaking and re-forming. Point at it and the
// gold answers like a fingertip pressed into liquid metal: a soft dent where the cursor aims,
// with rings rippling outward from it.
function blob(env: THREE.Texture): Station {
  const { scene, camera } = station(env, 5.65);
  const geo = weldedSphere(30);
  const base = Float32Array.from(geo.attributes.position.array);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const mesh = new THREE.Mesh(geo, goldMaterial(0.1));
  mesh.scale.setScalar(0.9); // keeps the swelling silhouette inside the ring
  scene.add(mesh);
  const aim = v(0.4, -0.6, 0.7).normalize(); // where the cursor is, in world space
  const want = aim.clone();
  const local = new THREE.Vector3();
  const inv = new THREE.Quaternion();
  let reach = 0, reachWant = 0, ripple = 1, moved = 0, now = 0;
  return {
    scene, camera,
    tags: [v(1.3, -1.3)],
    pointer: (x, y, active, strength) => {
      // Aim at the side of the blob facing the pointer, tipped toward the viewer so the dent
      // and its rings are seen on the visible face.
      const len = Math.hypot(x, y) || 1;
      want.set(x / len, y / len, 1.1).normalize();
      reachWant = active ? strength : 0;
      moved = now;
    },
    update: (t) => {
      now = t;
      ripple = 0.3 + 0.7 * Math.exp(-(t - moved) / 1.2);
      aim.lerp(want, 0.06).normalize();
      reach += (reachWant - reach) * 0.05;
      local.copy(aim).applyQuaternion(inv.copy(mesh.quaternion).invert());
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        const swell =
          Math.sin(1.6 * x + t * 0.5) * Math.sin(1.3 * y + t * 0.4) * 0.2 +
          Math.sin(1.1 * z - t * 0.35 + y) * 0.1;
        const ridge =
          Math.sin(4.2 * x + 2.1 * y - t * 0.9) * Math.sin(3.6 * z + t * 0.7) * 0.07 +
          Math.sin(7.0 * y + 3.0 * z + t * 1.1) * 0.025;
        const pull = Math.max(0, Math.sin(t * 0.3 + x * 2)) * y * 0.1;
        // The press: a is the angle from the aim, so the rings are evenly spaced. A wide,
        // shallow dent, then rings that run outward and settle after each move.
        const a = Math.acos(Math.min(1, Math.max(-1, x * local.x + y * local.y + z * local.z)));
        const dent = -0.09 * Math.exp(-a * a * 9);
        const rings = 0.045 * Math.sin(a * 26 - t * 6) * Math.exp(-a * 2.2) * ease(0.12, 0.3, a) * ripple;
        const pod = reach * (dent + rings);
        const s = 1 + swell + ridge + pull + pod;
        pos.setXYZ(i, x * s, y * s, z * s);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      mesh.rotation.set(Math.sin(t * 0.17) * 0.4, t * 0.12, Math.sin(t * 0.11) * 0.2);
    },
  };
}

// A body-centred cubic cell (caesium chloride): eight small ions on the corners of a cube,
// one large ion at its heart, bonded to every corner. It assembles as it scrolls in: the ions
// drift in from scattered places, then the bonds grow out from the centre.
function crystal(env: THREE.Texture): Station {
  const { scene, camera } = station(env, 7.1);
  const group = new THREE.Group();
  const bonds = new THREE.Group();
  const gold = goldMaterial(0.05);
  const h = 0.95;
  const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => v(x * h, y * h, z * h))));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 64, 40), gold);
  group.add(core, bonds);
  const ion = new THREE.SphereGeometry(0.2, 40, 28);
  const atoms = corners.map((home, i) => {
    const m = new THREE.Mesh(ion, gold);
    const away = home.clone().multiplyScalar(2.2).add(v(Math.sin(i * 7.1) * 0.8, Math.cos(i * 3.3) * 0.8, Math.sin(i * 1.9) * 0.6));
    group.add(m);
    bonds.add(rod(v(0, 0, 0), home, 0.03, gold));
    for (const b of corners) {
      const d = b.clone().sub(home);
      if (Math.abs(d.length() - 2 * h) < 0.01 && d.x + d.y + d.z > 0) bonds.add(rod(home, b, 0.04, gold));
    }
    return { m, home, away };
  });
  scene.add(group);
  return {
    scene, camera,
    tags: [v(-1.4, 1.4)],
    update: (t, s) => {
      atoms.forEach(({ m, home, away }, i) => m.position.lerpVectors(away, home, ease(i * 0.05, 0.55 + i * 0.05, s)));
      bonds.scale.setScalar(Math.max(0.001, ease(0.6, 1, s)));
      core.scale.setScalar(0.6 + 0.4 * ease(0, 0.5, s));
      group.rotation.set(0.45 + Math.sin(t * 0.3) * 0.15, t * 0.22 + 0.5 + (1 - s) * 1.5, 0.1);
    },
  };
}

// Conversations: a gold chat thread. Messages of different lengths, alternating sides,
// scroll up out of the dark and away, a few every second.
function stream(env: THREE.Texture): Station {
  const { scene, camera } = station(env, 6.1, 30);
  const thread = new THREE.Group();
  const gold = goldMaterial(0.2);
  const widths = [0.7, 1.15, 0.9, 1.4, 0.6, 1.05];
  const N = widths.length;
  const GAP = 0.46;
  const H = N * GAP;
  // A speech bubble: a pill with a small tail at its lower corner, on the speaker's side.
  const bubbleShape = (w: number, side: number) => {
    const h = 0.3, r = 0.15, x0 = -w / 2, y0 = -h / 2;
    const sh = new THREE.Shape();
    sh.moveTo(x0 + r, y0);
    if (side < 0) { sh.lineTo(x0 + 0.02, y0 - 0.1); sh.lineTo(x0 + 0.16, y0); }
    sh.lineTo(x0 + w - r, y0);
    if (side > 0) { sh.lineTo(x0 + w - 0.16, y0); sh.lineTo(x0 + w - 0.02, y0 - 0.1); sh.lineTo(x0 + w - r, y0); }
    sh.absarc(x0 + w - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
    sh.lineTo(x0 + r, y0 + h);
    sh.absarc(x0 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 5, curveSegments: 24 });
    g.center();
    // A shallow dome on the face, so light rolls across it instead of sitting flat.
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) <= 0) continue;
      const nx = p.getX(i) / (w / 2), ny = p.getY(i) / 0.2;
      p.setZ(i, p.getZ(i) + 0.035 * Math.max(0, 1 - nx * nx) * Math.max(0, 1 - ny * ny));
    }
    g.computeVertexNormals();
    return g;
  };
  // Each bubble carries two raised lines of "text" in darker metal.
  const ink = goldMaterial(0.35);
  ink.color.multiplyScalar(0.35);
  const bubbles = widths.map((w, i) => {
    const side = i % 2 ? 1 : -1;
    const m = new THREE.Mesh(bubbleShape(w, side), gold);
    m.position.x = side * (0.75 - w / 2);
    for (const [ly, lw] of [[0.045, 0.62], [-0.05, 0.38]]) {
      const line = new THREE.Mesh(new RoundedBoxGeometry((w - 0.2) * lw, 0.035, 0.02, 2, 0.008), ink);
      line.position.set(-((w - 0.2) * (1 - lw)) / 2, ly, 0.06);
      m.add(line);
    }
    thread.add(m);
    return m;
  });
  thread.rotation.set(0.12, -0.55, 0);
  scene.add(thread);
  // The "conversations" tag hangs from the newest fully visible message at the top.
  const pin = new THREE.Object3D();
  const pinLow = new THREE.Object3D();
  thread.add(pin, pinLow);
  return {
    scene, camera,
    tags: [{ obj: pin, at: v(0, 0) }, { obj: pinLow, at: v(0, 0) }],
    update: (t) => {
      bubbles.forEach((m, i) => {
        const k = ((i * GAP + t * 0.32) % H) / H; // 0 entering at the bottom, 1 leaving at the top
        m.position.y = -H / 2 + k * H;
        // Messages grow in at the bottom and shrink away at the top, drifting to their side.
        const fade = ease(0, 0.12, k) * (1 - ease(0.88, 1, k));
        m.scale.setScalar(Math.max(0.35, fade));
        m.visible = fade > 0.35;
        m.rotation.y = (1 - fade) * 0.55;
        m.position.x = (i % 2 ? 1 : -1) * (0.75 - widths[i] / 2 + (1 - fade) * 0.3);
      });
      // The tags hang from the top and bottom fully grown messages.
      let hi = -Infinity, lo = Infinity;
      bubbles.forEach((m, i) => {
        if (m.scale.x < 0.97) return;
        if (m.position.y > hi) { hi = m.position.y; pin.position.set(m.position.x - widths[i] / 2 - 0.04, m.position.y + 0.24, 0.05); }
        if (m.position.y < lo) { lo = m.position.y; pinLow.position.set(m.position.x + widths[i] / 2 - 0.1, m.position.y - 0.2, 0.05); }
      });
      thread.rotation.y = -0.55 + Math.sin(t * 0.25) * 0.12;
    },
  };
}

// Signals into models: one gold signal comes down as a clean sine, reaches a node and splits
// evenly into five strands, an ensemble. One strand, the model that answers, is lit, and a
// bright pulse keeps running down it; the others are dark metal.
function signal(env: THREE.Texture): Station {
  const { scene, camera } = station(env, 6.2);
  const group = new THREE.Group();
  const gold = goldMaterial(0.05);
  const dim = goldMaterial(0.12);
  dim.color.multiplyScalar(0.16);
  const lit = goldMaterial(0.04);
  lit.emissive.copy(GOLD);
  // The trace runs in from the left as a waveform, then turns down into the hub.
  const top: THREE.Vector3[] = [];
  for (let i = 0; i <= 120; i++) {
    const k = i / 120;
    const x = -1.6 + k * 1.35;
    top.push(v(x, 1.25 + Math.sin(k * Math.PI * 4) * 0.26 * Math.min(1, (1 - k) * 4), 0));
  }
  for (let i = 1; i <= 30; i++) {
    const k = i / 30;
    top.push(v(-0.25 + Math.sin(k * Math.PI / 2) * 0.25, 1.25 - (1 - Math.cos(k * Math.PI / 2)) * 0.25 - k * 0.6, 0));
  }
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(top), 320, 0.06, 18, false), gold));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 18, 12), gold);
  cap.position.copy(top[0]);
  group.add(cap);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.13, 40, 28), gold);
  hub.position.set(0, 0.4, 0);
  group.add(hub);
  const ends = [-1.5, -0.75, 0, 0.75, 1.5];
  let litCurve: THREE.Curve<THREE.Vector3> = new THREE.LineCurve3(v(0, 0), v(0, 0));
  ends.forEach((x, i) => {
    const on = i === 3;
    const curve = new THREE.CubicBezierCurve3(v(0, 0.4, 0), v(x * 0.15, -0.1, 0), v(x, -0.4, 0), v(x, -1.35, 0));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, on ? 0.055 : 0.036, 14, false), on ? lit : dim));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(on ? 0.16 : 0.09, 32, 20), on ? lit : dim);
    bead.position.copy(curve.getPoint(1));
    group.add(bead);
    if (on) litCurve = curve;
  });
  const pulseMat = goldMaterial(0.02);
  pulseMat.emissive.setRGB(1, 0.9, 0.6);
  pulseMat.emissiveIntensity = 1.4;
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), pulseMat);
  group.add(pulse);
  scene.add(group);
  return {
    scene, camera,
    tags: [{ obj: group, at: v(-1.62, 1.6) }, { obj: group, at: v(0.9, -1.48) }],
    update: (t) => {
      const k = (t * 0.55) % 1;
      pulse.position.copy(litCurve.getPoint(k));
      pulse.scale.setScalar(Math.sin(k * Math.PI) * 0.9 + 0.1);
      lit.emissiveIntensity = 0.35 + (Math.sin(t * 2.4) * 0.5 + 0.5) * 0.35;
      group.rotation.set(0.05, Math.sin(t * 0.3) * 0.15, 0);
    },
  };
}

// The enclave: a contract — curled sheets under an engraved seal — held inside two nested
// geodesic shells that turn against each other, layers of protection around it.
function shell(radius: number, detail: number, r: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const edges = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius, detail));
  const p = edges.attributes.position;
  for (let i = 0; i < p.count; i += 2) {
    g.add(rod(v(p.getX(i), p.getY(i), p.getZ(i)), v(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)), r, mat));
  }
  const node = new THREE.SphereGeometry(r * 2.2, 16, 12);
  const seen = new Set<string>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = new THREE.Mesh(node, mat);
    n.position.set(p.getX(i), p.getY(i), p.getZ(i));
    g.add(n);
  }
  return g;
}

function enclave(env: THREE.Texture): Station {
  const { scene, camera } = station(env, 6.4);
  const gold = goldMaterial(0.06);
  const outer = shell(1.62, 0, 0.022, gold);
  const inner = shell(1.15, 0, 0.016, gold);
  const docs = new THREE.Group();
  const sheet = new RoundedBoxGeometry(1.2, 1.55, 0.04, 2, 0.015);
  const sp = sheet.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i);
    sp.setZ(i, sp.getZ(i) + 0.22 * x * x + 0.05 * Math.sin(y * 2.4));
  }
  sheet.computeVertexNormals();
  const paper = goldMaterial(0.1);
  const sealGold = goldMaterial(0.4);
  const sheets = [0, 1, 2, 3].map((i) => {
    const m = new THREE.Mesh(sheet, paper);
    m.position.z = i * 0.08;
    docs.add(m);
    return m;
  });
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 64), [sealGold, engravedGold(0.35), engravedGold(0.35)]);
  seal.rotation.x = Math.PI / 2;
  seal.position.set(0.25, -0.42, 0.42);
  docs.add(seal);
  docs.scale.setScalar(0.95);
  scene.add(outer, inner, docs);
  return {
    scene, camera,
    tags: [v(-1.1, 1.25), v(1.45, -0.75)],
    update: (t, s) => {
      // As it arrives the shells close in around the contract, then the seal comes down.
      outer.scale.setScalar(1 + (1 - ease(0, 0.7, s)) * 0.12);
      inner.scale.setScalar(0.4 + 0.6 * ease(0.1, 0.75, s));
      const stamp = ease(0.45, 0.8, s);
      seal.position.set(0.25, -0.42 + (1 - stamp) * 0.72, 0.42 + (1 - stamp) * 0.48);
      outer.rotation.set(0.3, t * 0.14 + (1 - s) * 1.2, 0.1);
      inner.rotation.set(-0.2, -t * 0.22 - (1 - s) * 1.6, 0.25);
      const fan = (Math.sin(t * 0.6) * 0.5 + 0.5) * 0.18 + 0.04;
      sheets.forEach((m, i) => {
        m.rotation.z = (i - 1.5) * fan;
        m.position.x = (i - 1.5) * fan * 0.6;
      });
      docs.rotation.set(-0.25 + Math.sin(t * 0.3) * 0.1, -0.45 + Math.sin(t * 0.25) * 0.3, 0.06);
    },
  };
}

// The finale: a gold challenge coin, engraved on both faces, with raised rims and a milled
// edge, tilted back so its thickness catches the light as it turns.
function coin(env: THREE.Texture): Station {
  const { scene, camera } = station(env, 5.2);
  const edge = goldMaterial(0.18);
  const face = engravedGold(0.1);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.16, 160, 1), [edge, face, face]);
  disc.rotation.x = Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(disc);
  const rimGold = goldMaterial(0.05);
  for (const z of [-0.085, 0.085]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.045, 20, 160), rimGold);
    rim.position.z = z;
    holder.add(rim);
  }
  // The milled edge: fine ridges all the way round.
  const ridge = new THREE.BoxGeometry(0.018, 0.012, 0.15);
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const r = new THREE.Mesh(ridge, edge);
    r.position.set(Math.cos(a) * 1.302, Math.sin(a) * 1.302, 0);
    r.rotation.z = a;
    holder.add(r);
  }
  scene.add(holder);
  let want = 0, eased = 0;
  return {
    scene, camera,
    tags: [v(0.8, -1.12)],
    hover: (on) => { want = on ? 1 : 0; },
    update: (t, s) => {
      eased += (want - eased) * 0.08;
      const idle = 1 - eased;
      // Minted on arrival: it spins up from edge-on and settles face out.
      const mint = ease(0, 1, s);
      const spin = (1 - mint) * (Math.PI * 2.5);
      holder.rotation.set((-0.42 + Math.sin(t * 0.4) * 0.08) * idle, Math.sin(t * 0.35) * 0.7 * idle * mint + spin, (0.08 + Math.sin(t * 0.3) * 0.05) * idle);
      holder.scale.setScalar((0.7 + 0.3 * mint) * (1 + eased * 0.06));
    },
  };
}

export const builders: Record<Kind, (env: THREE.Texture) => Station> = { blob, crystal, signal, stream, enclave, coin };
