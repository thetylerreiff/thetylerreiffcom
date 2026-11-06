// The page is plain text first. The gold track, its wires and the look toggle are shown only
// once the 3D has started: without WebGL (locked-down browsers, remote desktops) or if it fails,
// visitors get the text alone, with nothing broken on screen.
const root = document.documentElement;
const probe = document.createElement("canvas");
if (probe.getContext("webgl2") || probe.getContext("webgl")) {
  import("./site")
    .then(() => root.classList.add("gl"))
    .catch((err) => {
      root.classList.add("no-gl");
      console.warn("3D disabled:", err);
    });
} else {
  root.classList.add("no-gl");
}
