# Look rules (measured, not described)

Written 20 Nov 2026. Colours were sampled from ISAK's reference stills (Ebbtide trailer frames in the
project folder) by reducing each frame to 8 colours. Share = how much of the frame that colour covers.

## Measured from the Ebbtide stills

| Still | Main colours (share of frame) |
| --- | --- |
| Gunship over a dense horde (day, desert) | #9f9075 25% · #433c32 13% · #90826b 12% · #5e5547 12% · #7c6f5c 12% · #2b261f 12% |
| Safe zone from higher up (ops overlay) | #1b4b79 21% · #797b74 18% · #184775 17% · #251b20 11% · #5b9691 10% |
| Operations map, city districts | #63656c 23% · #0d1521 16% · #2f2f2c 15% · #0b1119 10% · #414546 9% |

What the numbers say:
- The ground is **one family of low-saturation browns or greys** covering most of the frame. Detail comes
  from value steps (light, mid, dark), not from many hues.
- Strong colour is **rare and functional**: blue for water/safe zones, teal for overlays, red for danger.
- Darks are **warm-black or blue-black** (#2b261f, #0b1119), never pure black.
- Bodies in the horde read as **darker silhouettes on a lighter ground** with a small cast shadow.

## Our rules (Last Pass, night, 2009)

1. Ground: blue-black asphalt and earth (#16171d family). Light comes from sodium pools (#a86e20 family),
   fire (#e23a1e) and windows. No pure black anywhere except the pixel outline of text.
2. Accent colours have jobs: yellow #ffd640 = what you selected / your interface; green = the dead;
   white = the living; blue = armed and police; red = fire, blood, danger, outbreak rings on the globe.
3. Every person and vehicle gets a small dark shadow, offset the same way (light from the north-west).
4. Hero vehicles are the only saturated vehicles you can pick out from orbit: Walt's red pickup, the
   cream bus 21, the white-and-red ambulance. Parked cars stay muted (grey, navy, dark red, beige).
5. Camera: the telescope looks down at an angle, like a model railway. The same angle carries from the
   globe to the street, no cuts (one continuous zoom).
6. Interface: dark panels, pixel font, one hint strip. The hero ID card is the one bright, paper-like
   object on screen, so it feels like something you hold.

## Size contract

All models share real 2009 sizes in metres (`src/engine/vehicles.ts`, checked by `vehicles.test.ts`):
person 1.75 m tall, sedan 4.5 x 1.75 x 1.45 m, compact pickup 4.9 x 1.75 x 1.7 m, 40-foot city bus
12.2 x 2.6 x 3.1 m, box ambulance 6.4 x 2.4 x 2.8 m. Drawing scale: people x2, vehicles x1.5, so people
stay readable but a bus still dwarfs a person.

## Nothing inside anything (automatic checks)

- Hero escape routes never pass through a building (`heroes.test.ts`, every 5 m).
- Parked cars never stand inside a building (`vehicles.test.ts`, all four corners).
- Ships stay on open water, outbreaks sit on land (`world.test.ts`, against the land mask).

## Up close (draft 10, 23 Nov 2026)

These are the rules the close-up city follows now. Each one has a check behind it.

1. **Outlines.** Every object gets a one-pixel dark outline where it stands in front of something further
   away, and a faint light rim on its top edge (`pixel.ts`, from the depth buffer). This is what makes boxes
   read as pixel art instead of plain 3D.
2. **Light comes in steps.** Lamps light the ground, walls, trees, people and cars in 5 hard steps;
   headlights and gun flashes in 4 (`lightfield.ts`). Night haze beyond where you look also comes in 6 steps.
3. **People up close are 16 parts:** jacket, hips, head, hair or hat, upper arms, forearms, hands, thighs,
   shins, shoes. Knees and elbows bend. Steps are counted from the distance walked, so feet do not slide
   (`rig.ts`, tested). Police wear navy caps, hunters orange. About 1 in 5 wears a beanie. The dead have
   grey-green skin, bloodied hands, torn sleeves and lolling heads.
4. **Cars:** five 2009 body styles (sedan, hatchback, wagon, SUV, minivan), all on the same footprint so
   parking and collisions hold (`vehicles.test.ts`). Cars on the move show lit headlights and red taillights.
5. **Ground:** within about 120 m of where you look the ground is drawn at about 3 pixels per metre
   (lane dashes, crosswalk stripes, kerbs are sharp); further out 1 pixel per metre.
6. **Street dressing by rule** (`dressing.ts`, tested): stop signs where a side street meets one as big or
   bigger, hydrants at some corners, wooden power poles with sagging wires along residential streets,
   garbage carts on the boulevard. Lamp posts, parked cars and dressing never stand in a junction or on a
   street surface. Simplification: Minneapolis runs most power lines down alleys; our map has no alleys.
7. **Solid things:** buildings (to 1.25 m), parked cars (to the exact body) stop people and bullets.

## Known gaps (next)

- Trees are blocky clusters; Ebbtide's read as softer silhouettes.
- No fences, porches are walk-through, no apartment balconies or fire escapes yet.
- Wires are thinner than a pixel from high up, so they come and go at the 400 m view.
