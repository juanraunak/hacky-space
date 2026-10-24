# Hacky Space — the plan (v3)

Juan's notes this round: no voice; no rings; no "rescue" text; text boxes
instead; be immersed; walk around a cool, well-lit ship; NPCs like Hacky's
original Newton; space as a real 3D world (not photos); boss-style reveals at
each phenomenon; the black hole's beautiful glow back; show time aging on the
ship. Keep the bending spacetime lattice (he liked it) and the Webb colours.

---

## 1. The ship you walk around (the opening)

- You **start on your feet** inside a small, cool ship: a bridge with a big
  window, glowing console lights, soft blue strip lights, warm lamps, a
  pilot seat. **WASD walk, mouse looks around** (Hacky's player rig and
  touch controls, ported).
- **Einstein and Newton are NPCs** in Hacky's original style: toon-shaded
  simple shapes, simple eyes, recognisable silhouettes (Newton's long coat and
  tied-back hair, Einstein's wild white hair and moustache). They breathe and
  turn their heads toward you. When you walk up to them, they talk in **typed
  comic bubbles above their heads** (Hacky's ThoughtBubble). No voices.
- They argue at the window. Outside: the star inside the **3D lattice of
  space**, which bends toward it. Einstein's bubble: "No rope, Isaac. Look —
  space itself bends."
- Then it goes wrong: the star collapses into a **spinning black hole**, the
  lattice falls into a funnel, matter spirals in, the ship shakes, the lights
  flicker red, and **Newton is pulled out through the window**.
- Black screen. A single text box: *"We have to find Newton."*
- You take the pilot seat (walk to it, press E) and fly. Einstein sits beside
  you.

## 2. Flying: a real 3D universe, no rings, no labels

- **Space is a place, not a picture.** The far sky stays (deep stars, Milky
  Way), but the Webb-coloured nebulae become **3D clouds you fly into and
  through** (soft volumetric sprites placed in space, with parallax), plus
  drifting dust near the ship and the odd distant planet.
- **No rings, no arrows, no labels.** You navigate by what you see: Newton's
  **distress beacon** is a pulsing light far away, and the phenomena on the
  way are visible from a long way off. Einstein's text box nudges you only if
  you're lost for a while ("I see a flashing light, there, to the left").
- Mouse steers the ship; the ship looks cool: clean voxel hull, glowing
  engines, cockpit lights, running lights.

## 3. Boss-style arrivals

When you get close to a phenomenon, the game does what big games do for a
boss: the music swells, black bars slide in, the camera sweeps around it,
and a big title card fades up, e.g.

> **PULSAR**
> *the dead star that keeps time*

Then control returns and you deal with it. Same for **WORMHOLE** and
**BLACK HOLE**.

## 4. The three phenomena (one idea each)

| Place | What you do | What it shows |
| --- | --- | --- |
| **Pulsar** | Dodge the sweeping beams to pass it | A dead star spinning like a lighthouse; its flashes are a clock |
| **Wormhole** | Fly into it: the shortcut to the black hole | Bent space can join two far places |
| **Black hole** | Skim the edge, grab Newton, climb out sideways | Space dips into a funnel; time almost stops at the bottom |

The **lattice of space** appears around each one, bending the real way.

**Black hole look:** bring back the glowing, warm, beautiful disc and bloom
from the version Juan liked, keep the real light bending, and fix the strange
effect when the camera gets close.

## 5. Seeing time: the ship ages

Time is shown on things, not numbers:
- **Your ship ages by your own clock.** As your time passes, the hull slowly
  gathers dust, scratches and rust; the cabin plant on the dashboard grows
  and wilts. Fly fast or sit near the black hole and your clock slows, so
  your ship **ages less**.
- **Teammates' ships age by theirs**, so you see the difference flying side
  by side.
- **Newton**, stuck near the black hole, has barely aged when you find him,
  while your ship looks worn. Back home, Einstein's text box says the one line
  that names the rule.

## 6. Multiplayer

Everyone spawns on the same ship, walks around together, sees each other,
then each takes a seat and flies their own ship on the same journey. Anyone
can grab Newton.

## 7. Text

Only text boxes: comic bubbles over NPCs, and a bottom dialogue box for
Einstein while you fly. No HUD, no dials, no voice.

---

## Build order (each step pushed live and announced)

1. **Remove** voice, rings, rescue text. Text boxes in. *(voice already off)*
2. **The walkable ship** with Hacky-style NPCs, comic bubbles and good
   lighting; the collapse event; black screen; take the seat.
3. **Black hole glow back**, close-up artifact fixed.
4. **Boss-style arrival cards.**
5. **3D nebulae and dust** you fly through.
6. **Ship aging** by your own clock.
7. **The journey**: pulsar → wormhole → black hole → Newton, with a distress
   beacon to follow.
