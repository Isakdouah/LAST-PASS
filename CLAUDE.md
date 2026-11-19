# Last Pass: guide for every coding session

Read this first. It is the short version of everything decided so far. The long versions live on the Miro board (https://miro.com/app/board/uXjVEMyj4JQ=/) and in `docs/`.

## Who this is for

- ISAK is the director. He steers story, look and feel, and plays every build. He is not a programmer: explain things in plain language, short, no jargon without a one-line explanation.
- Claude does the heavy lifting: code, tests, builds, fixes, drafts of writing.
- A friend helps test. Nobody else touches the code.
- Goal right now: a fun build for ISAK and friends (hobby). Steam is a maybe for later. See `docs/demo-promise.md`.

## The game in one line

The last astronaut in orbit watches a zombie outbreak spread across Earth in 2009 and can only help by seeing, listening, speaking and connecting people on the ground.

## Core rules (do not break)

1. **Window rule:** you can only act on what is under the station right now. Earth turns below you; a place comes back on a later pass. Results show up next pass.
2. **The control line:** the player never moves anyone. Every ability must (a) leave the decision to someone on the ground, (b) cost something (time, trust, power), (c) be limited by the orbit. No troops, air strikes or base building (that is Ebbtide's game, not ours). Not a pure audiobook either.
3. **The ground runs on math:** people are numbers per city block in a simulation; only dots near the camera are drawn. A few dots get promoted to named people, a handful of hand-written "stars" carry full stories.
4. **Zombies are fast**, ant-swarm style. They flow like liquid through streets.
5. **Alternate-history 2009:** flip phones, early smartphones, radio, landlines, no AI. Our own events, never World War Z's.

## Level 1 abilities (demo)

SEE (telescope, thermal, compare passes, catch lies) / LISTEN (tune the dial, locate a signal, triage) / SPEAK (warn a town, coach a star live, broadcast) / CONNECT (patch two groups, matchmaker, send proof). Later stations each remove one limit (Miro frame 22). Nothing from later levels goes in the demo.

## Tech

- Web code: TypeScript + Vite, drawn with Canvas/WebGL. Runs in any browser; can be wrapped for Steam later.
- Builds to ONE self-contained HTML file (`npm run build` makes `dist/index.html`) so ISAK can play from a private link.
- Map data: OpenStreetMap (credit "© OpenStreetMap contributors" on screen; ODbL licence). Raw downloads go in `data/raw/` (not committed if large); processed small files in `public/` or `src/data/`.
- Target machine: an ordinary laptop without a graphics card, 60 frames per second. Drop internal resolution if slow.

## Art rules (Patrol-style pixel discipline)

- Low internal resolution (about 270-340 px tall), upscaled with nearest-neighbour. No anti-aliasing, no smooth gradients.
- Small fixed palette with ordered (Bayer) dithering.
- Bleak palette: blue-black space, sodium-orange city light, ash grey, smoke brown; fire red is the main warm colour.
- Quiet interface: one hint strip, small labels. Every number on a console is real (orbit time, next pass, local time below).
- Civilians white dots, infected green dots (from Zombies Aren't Real's readability), but our own look.

## Story and values

- Main story beats are hand-written (Acts 0-6: Launch, Whispers, Denial, Panic, The Dark, Thaw, Reclaim). AI may draft; ISAK edits.
- No system is the hero. Survival comes from cooperation, local knowledge, mutual aid. Every system succeeds and fails somewhere.
- Real conflicts and occupations are in the game. Be historically correct for 2009, use voices from inside each place, not only outsiders.
- Never copy World War Z names, events, characters or text.

## AI use

- AI writes code and placeholders (art, text, voices) freely. Mark placeholders in filenames (`placeholder_`).
- Final art for key characters, voices for the main story and store art: humans, when budget allows (demo budget about $1,000, ask ISAK before spending anything).
- No live AI generation inside the game for now.

## How to work

- Small steps. One feature at a time, playable after each step. Never rewrite everything in one go.
- Every simulation rule gets an automatic test (`npm test`). Run tests before every commit.
- Commit and push at the end of every session (GitHub is the backup). Clear commit messages in plain English.
- After a change that affects what is on screen, build, open it in a headless browser, take a screenshot and look at it before calling it done.
- Weekly: a playable private link for ISAK, three lines on what changed, at most three questions.
- Ask ISAK before: spending money, publishing anything public, deleting his files, changing the core rules above.
