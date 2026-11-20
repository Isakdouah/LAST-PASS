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
