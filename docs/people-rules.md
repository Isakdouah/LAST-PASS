# People rules (how the living and the dead behave)

Written 20 Nov 2026 for plan v2. (data) = from a source below; (guess) = ours, to tune by playtest.

## Where people are
- Head count per 80 m cell (data, 26 Nov 2026): real 2010 Census block counts (POP10), 979,374 people in the map box from 12,671 blocks; built by `tools/build_population.py`. Inside each block, people lean toward cells with buildings and never sit on water (guess). Replaces the old 800,000 guess spread evenly over house roofs. Source checked: file totals match Hennepin 1,152,425 and Ramsey 508,640 (2010).
- Share asleep by hour: BLS American Time Use Survey Table A-3 (2021), all days; shifted one hour later for a Friday (guess). About 7% asleep at 8 PM, 70% at 11 PM, 95% at 2-3 AM (data).
- Outside on a cold October evening: 1.5-8.5% (guess). Everyone else is indoors and not drawn until their street goes into chaos.
- Weather: NWS Twin Cities October 2009 table (via search summary): high ~7 C, low ~3 C, 0.04 in precipitation. Drizzle hours are a guess.

## Waking up and deciding
- People learn the dead are here from screams and shots nearby, neighbours, phones, and local TV from about 9 PM (guess). The asleep react slower.
- Disaster research (Quarantelli 1993, Univ. of Delaware DRC; Scientific American 2018): panic and looting are rare, helping is the norm (data). So people fight each other only for reasons: a jammed road, someone who may be bitten, frightened people with guns. A calm voice (W) cuts it.
- Leaving: aware people in danger take the road out; they copy neighbours; the armed stay more. Cars: about 82% of households (guess; check ACS). Roads carry 30/120/400 people a minute (guess); the rest jam.

## Guns
- Base hit chance per shot (calm, close, good light): untrained 10%, regular owner 20%, hunter 35%, police 30%, soldier 40%, special forces 60%. Police from RAND 2008 (NYPD 1998-2006: 18% in gunfights, 30% when not fired on, 37% within 7 yards, 23% beyond) (data); the rest guesses.
- Then lowered by night, fear (veterans keep their nerve better), distance, and fast targets.
- Only head hits kill. Before people learn: 12% of hits land on the head (guess: chest training). After: 70% (guess).
- Body hits knock the dead down (handgun 1.5 s, shotgun 3 s, rifle 2.5 s) and sometimes cripple them into crawlers (8/25/30%) (guess).
- Misses fly on; a person they pass close to is hit 8% of the time, one of the dead 35% (guess).

## Hands and tools (guess)
| Thing | Share | Kill per swing | Knock down |
| --- | --- | --- | --- |
| Bare hands | 45% | 1% | 8% |
| Kitchen knife | 15% | 10% | 4% |
| Baseball bat | 10% | 14% | 40% |
| Hockey stick | 10% | 6% | 35% |
| Crowbar | 8% | 18% | 35% |
| Frying pan | 5% | 5% | 30% |
| Hammer | 4% | 15% | 20% |
| Machete | 3% | 30% | 30% |
Knowing to go for the head multiplies the kill chance by 2.5.

## Learning
- Each head kill a person sees teaches them; it spreads block to block.
- H broadcasts "aim for the head". With proof (you saw one get back up after a body shot) it reaches most people over the next hour or two; without proof few believe it, and it costs trust.

## Bites
- The bitten turn after 20-90 s (guess) and may hide it. In the last 25 s they show signs (grey-green), and a scared armed person nearby may shoot them.

## Sources
- U.S. Census Bureau, 2010 Census, TIGER/Line blocks with population and housing (TIGER2010BLKPOPHU, Minnesota): https://www2.census.gov/geo/tiger/TIGER2010BLKPOPHU/ (public domain)
- RAND (2008), Evaluation of the NYPD Firearm Training and Firearm-Discharge Review Process: https://www.rand.org/pubs/research_briefs/RB9359.html
- PolitiFact (25 May 2018), police hit rates 22-52%: https://www.politifact.com/factchecks/2018/may/25/shannon-watts/do-more-7-10-police-bullets-miss-their-mark-gun-co
- BLS ATUS Table A-3 (2021): https://www.bls.gov/tus/tables/a3-2021.htm
- Quarantelli (1993), Univ. of Delaware Disaster Research Center: https://udspace.udel.edu/server/api/core/bitstreams/cc71b2b0-b2be-4984-98ea-27767f2f427e/content
- Scientific American (Sept 2018), disaster myths: https://www.scientificamerican.com/blog/observations/there-goes-hurricane-florence-here-come-the-disaster-myths/
- NWS Twin Cities, October 2009 MSP climate table: https://www.weather.gov/media/mpx/Climate/MSP/oct2009.pdf
