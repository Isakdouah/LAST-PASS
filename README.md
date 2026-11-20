# Last Pass

The last astronaut in orbit watches a zombie outbreak spread across Minneapolis on one night
in October 2009, and can only help by looking, listening, speaking and connecting people.

## Play

Open `dist/index.html` (or the copy "Last Pass - rough draft 1.html") in Chrome or Edge.
It works offline: everything is inside the one file.

- **Enter**: play the night. **S**: sandbox (click to start outbreaks).
- **Mouse wheel**: zoom from orbit down to one street. **Drag**: move the map.
- **Up/Down**: tune the radio fast. **Left/Right**: fine tune. Hams listen on 146.52, police near 155.
- **W**: warn who you are tuned to. **P** then **P**: patch two channels together.
- **T**: thermal camera (the living are warm, the dead are cold). **C**: compare with last pass.
- **Space**: pause. **M**: mute. **Esc**: menu.

You can only see and talk to Minneapolis while the station is over it (about 3.5 minutes,
six times in the night). Between passes, time runs fast on the far side of the Earth.

## Build

`npm install`, then `npm test` and `npm run build` (makes `dist/index.html`).
Map data: `tools/build_map.py`, `tools/build_detail.py`, `tools/build_globe.py` (see their headers).
Map data (c) OpenStreetMap contributors (ODbL).
