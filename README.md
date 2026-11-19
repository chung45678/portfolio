# aidenzeng.ca v2: laptop specimen

A static site with no build step: upload this whole folder. It has the same layout and text as the live site, but the jelly specimen is replaced by the laptop from the Object Strobe film.

## The specimen
- **Hover** over the laptop to take it apart in the film's order (shells, then core, then small parts). It goes back together in reverse when the pointer leaves.
  - On touch screens, a **tap** does the same.
- **Drag** to turn it to any angle, including from below.
- **Scroll** or pinch to zoom.
  - In the stacked phone and tablet layout, a mouse wheel scrolls the page; zoom there with a pinch or ctrl+wheel.
- **Right-drag** or two-finger drag pans. **Double-click** resets the view.
- **Hovering a part** names it, with its temperature on the film's scale (`T = 25 + 83·v^1.6`).
- **Panel controls:**
  - Pass: Solid, Glass (x-ray) or Thermal (the film's ramp).
  - Explode and Load sliders.
  - Explode, Strobe and Reset buttons.
  - Auto-rotate, Show mesh and Labels toggles, plus Pause and Lights out.

**Deep links**, handy for sharing a specific view:

```
index.html#e=1&pass=thermal&load=1.1&labels=1&az=40&el=-30&dark=1
```

## Files
| Path | What it is |
|---|---|
| `models/laptop.glb` | 38 parts, 380k triangles, Draco-compressed, 1.2 MB. Exported from the film's scene by `scripts/export_web.py`. |
| `models/parts.json` | Each part's name, group, explode vector, stagger, base temperature, and the colour ramp. |
| `media/` | The Object Strobe film (720p loop for the card, 1080p with sound for the lightbox) and the poster. |
| `fonts/` | Fira Mono under the SIL OFL. Serif and sans use the same system font stacks as the live site. |

## Before deploying
- **Hotlinked assets.** The logos and the Sideline video and poster load from `https://www.aidenzeng.ca/assets/...`. If this replaces that site and those files stay at the same paths, nothing changes. Otherwise, copy `assets/` next to `index.html` and change the URLs to `./assets/...`.
- **CDN.** three.js 0.169.0 and its Draco decoder load from jsdelivr.

## Rebuild the model
The model comes from the Object Strobe film project, not from this repo. There, run:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b cache/scene.blend -P scripts/export_web.py -- --tris 380000
```
