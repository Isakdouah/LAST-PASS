import { it } from 'vitest';
import { treeSpots, lampSpots } from './props';
import { roadNet } from '../game/session';
it('c', () => { roadNet(); for (const [x0,y0] of [[86,110],[104,160],[152,136],[230,120],[112,160]]) { let t=performance.now(); const n=treeSpots(x0,y0).length; const a=performance.now()-t; t=performance.now(); lampSpots(x0,y0); console.log(x0,y0,n,'trees ms',a.toFixed(0),'lamps ms',(performance.now()-t).toFixed(1)); } });
