import {describe, it, expect} from 'vitest';
import {CARDS,FIELDS,card,newGame,clone,refresh,powers,winner,sweep,zoneWins,evaluate,resolve,plans,rolloutPlans,legal,observe,search,fromServer,wirePlan,RNG,interval,officialResult} from './card-engine';
import type {State,Plan} from './card-engine';
function fixture(round=6):State {
 const s=newGame(17,null,'independent');s.round=round;s.energy=[round,round];s.priority=0;s.hands=[[],[]];s.offers=[[],[]];s.seen=[[],[]];
 for(const z of s.zones){z.id=0;z.open=true;z.cards=[[],[]];z.first=[false,false];}
 return s;
}
const pass:Plan={pick:-1,moves:[]};
function play(s:State,id:number,zone=0,side=0){s.hands[side]=[card(id,'new')];const p={pick:-1,moves:[{uid:'new',zone}]};return resolve(s,side?[pass,p]:[p,pass],new RNG(15));}
function put(s:State,zone:number,side:number,id:number,base?:number){const c=card(id,'board:'+zone+':'+side+':'+s.zones[zone].cards[side].length);if(base!==undefined)c.base=base;s.zones[zone].cards[side].push(c);refresh(s);return c;}

describe('Snap rules and honest information boundary',()=>{
 it('covers the current 36 cards and nine battlefields',()=>{expect(CARDS.length).toBe(36);expect(FIELDS.length).toBe(9);});
 it('resets energy, opens lanes by round, assigns persistent kept-card UIDs',()=>{
  let s=newGame(17);for(let i=1;i<6;i++){s=resolve(s,[{pick:s.offers[0].length?0:-1,moves:[]},{pick:s.offers[1].length?0:-1,moves:[]}],new RNG(i));expect(s.energy).toEqual([i+1,i+1]);expect(s.zones.filter(z=>z.open).length).toBe(Math.min(3,i+1));
   for(const h of s.hands){expect(new Set(h.map(c=>c.uid)).size).toBe(h.length);expect(h.length).toBeLessThanOrEqual(5);}}
 });
 it('enumerates order-sensitive plans, forbids duplicate, over-budget and locked moves',()=>{
  const s=fixture(2);s.hands[0]=[card(0,'a'),card(2,'b')];s.zones[2].open=false;
  const ps=plans(s,0);expect(ps.every(p=>legal(s,0,p))).toBe(true);
  expect(ps.some(p=>p.moves.map(m=>m.uid).join()==='a,b')).toBe(true);expect(ps.some(p=>p.moves.map(m=>m.uid).join()==='b,a')).toBe(true);
  expect(legal(s,0,{pick:-1,moves:[{uid:'a',zone:0},{uid:'a',zone:0}]})).toBe(false);
  expect(legal(s,0,{pick:-1,moves:[{uid:'b',zone:2}]})).toBe(false);
  s.energy[0]=0;expect(plans(s,0)).toEqual([{pick:-1,moves:[]}]);
 });
 it('respects side-specific lock, capacity, placement quota and cost cap',()=>{
  const s=fixture();s.hands[0]=[card(21,'a'),card(0,'b')];s.zones[0].cap[0]=3;s.zones[1].ban[0]=0;
  expect(legal(s,0,{pick:-1,moves:[{uid:'a',zone:0}]})).toBe(false);expect(legal(s,0,{pick:-1,moves:[{uid:'b',zone:1}]})).toBe(false);
  s.zones[2].limit=0;expect(legal(s,0,{pick:-1,moves:[{uid:'b',zone:2}]})).toBe(false);
 });
 it('uses two zones, not total power; one lane each is unresolved draw assumption',()=>{
  const s=fixture();put(s,0,0,21,100);put(s,1,1,2,3);put(s,2,1,2,3);expect(winner(s)).toBe(1);
  s.zones[2].cards[1]=[];refresh(s);expect(winner(s)).toBe(-1);
 });
 it('requires all three strict leads for the target, even after an official two-lane victory',()=>{
  const s=fixture();put(s,0,0,2,8);put(s,1,0,2,8);expect(winner(s)).toBe(0);expect(zoneWins(s,0)).toBe(2);expect(sweep(s,0)).toBe(false);
  put(s,2,0,2,1);expect(sweep(s,0)).toBe(true);put(s,2,1,2,1);expect(sweep(s,0)).toBe(false);
 });
 it('PvP values a two-lane victory while default PvE still scores it below a sweep',()=>{
  const s=fixture();[10,10,0].forEach((n,i)=>put(s,i,0,2,n));[1,1,100].forEach((n,i)=>put(s,i,1,2,n));
  for(const z of s.zones)z.limit=0;
  const o=observe(s,0),opts={iterations:80,timeMs:30000,seed:217,width:4};
  const pve=search(o,opts),pvp=search(o,{...opts,goal:'win'});
  expect(pve.candidates[0].sweep).toBe(0);expect(pve.candidates[0].score).toBeLessThan(.1);
  expect(pvp.candidates[0].officialWin).toBe(1);expect(pvp.candidates[0].score).toBeGreaterThan(1);
  expect(legal(s,0,pvp.plan)).toBe(true);
 });
 it('target evaluation prefers reinforcing the weakest lane over securing only two',()=>{
  const a=fixture(),b=fixture();[20,20,0].forEach((power,i)=>put(a,i,0,2,power));[10,10,10].forEach((power,i)=>put(b,i,0,2,power));
  expect(evaluate(b,0)).toBeGreaterThan(evaluate(a,0));
 });
 it('Diana doubles dynamically without exponential repeated refresh; Riven and Trump interact',()=>{
  const s=fixture();put(s,0,0,18);put(s,0,0,8);put(s,0,1,4);refresh(s);const first=powers(s);refresh(s);expect(powers(s)).toEqual(first);expect(first[0][0]).toBe(6);
  put(s,0,1,13);expect(powers(s)[0][0]).toBe(6);
 });
 it('first-card reveal is itself only, follows ordered placement',()=>{
  const s=fixture(2);s.hands[0]=[card(0,'a'),card(2,'b')];const ab=resolve(s,[{pick:-1,moves:[{uid:'a',zone:0},{uid:'b',zone:0}]},pass],new RNG(1));
  const ba=resolve(s,[{pick:-1,moves:[{uid:'b',zone:0},{uid:'a',zone:0}]},pass],new RNG(1));
  expect(ba.zones[0].cards[0].find(c=>c.id===2)?.base).toBe(5);expect(ab.zones[0].cards[0].find(c=>c.id===2)?.base).toBe(2);
 });
 it('Jason blocks Red Devil; removing Jason releases reveal suppression',()=>{
  const s=fixture();put(s,0,1,10);put(s,0,1,0);expect(play(s,21).zones[0].cards[1]).toHaveLength(2);
  s.zones[0].cards[1]=s.zones[0].cards[1].filter(c=>c.id!==10);refresh(s);expect(play(s,21).zones[0].cards[1]).toHaveLength(0);
 });
 it('suppression depends on initiative; newly face-down cards are not destroy targets in this model',()=>{
  const s=fixture();put(s,0,1,0);s.hands=[ [card(21,'a')], [card(10,'b')] ];
  const p:[Plan,Plan]=[{pick:-1,moves:[{uid:'a',zone:0}]},{pick:-1,moves:[{uid:'b',zone:0}]}];
  expect(resolve(s,p,new RNG(1)).zones[0].cards[1]).toHaveLength(1);s.priority=1;expect(resolve(s,p,new RNG(1)).zones[0].cards[1]).toHaveLength(2);
 });
 it('tracks next-round energy only and one-round Peter Pan lock',()=>{
  const s=fixture(3);const n=play(s,30);expect(n.energy[0]).toBe(6);expect(n.bonus[0]).toBe(0);
  const locked=play(s,7);expect(locked.zones[0].ban[1]).toBe(0);expect(resolve(locked,[{pick:0,moves:[]},{pick:0,moves:[]}],new RNG(1)).zones[0].ban[1]).toBe(-1);
 });
 it('end-round growth, mechanic synergy, ongoing silence and cost cap',()=>{
  const s=fixture(4);put(s,0,0,27);put(s,0,0,5);const n=resolve(s,[pass,pass],new RNG(1));expect(n.zones[0].cards[0].find(c=>c.id===5)?.base).toBe(4);
  const t=fixture();put(t,0,1,18);put(t,0,1,8);const muted=play(t,34);expect(muted.zones[0].cards[1].every(c=>c.muted)).toBe(true);expect(powers(muted)[0][1]).toBe(3);
  put(t,1,1,35);t.hands[0]=[card(15,'a')];expect(legal(t,0,{pick:-1,moves:[{uid:'a',zone:1}]})).toBe(false);
 });
 it('copy and retrigger terminate without recursion or invented new cards',()=>{
  const s=fixture();put(s,0,0,16);put(s,0,0,19);put(s,0,0,28);expect(()=>play(s,16)).not.toThrow();expect(()=>play(s,19)).not.toThrow();
 });
 it('Joker halves displayed power even under Diana multiplier',()=>{
  const s=fixture();put(s,0,1,18);put(s,0,1,15,10);const n=play(s,17);expect(n.zones[0].cards[1].find(c=>c.id===15)?.power).toBe(10);
 });
 it('every card can be resolved safely and every field can advance',()=>{
  for(let id=0;id<CARDS.length;id++){const s=fixture();put(s,0,1,0);put(s,0,0,8);put(s,1,0,0);expect(()=>play(s,id)).not.toThrow();}
  for(const f of FIELDS){const s=fixture(4);s.zones[0].id=f.battlefieldId;put(s,0,0,5);expect(()=>resolve(s,[pass,pass],new RNG(1))).not.toThrow();}
 });
 it('search cannot see opponent hands or offers; locked battlefield previews are public',()=>{
  const s=fixture();s.hands[0]=[card(21,'a')];s.hands[1]=[card(10,'hidden')];s.offers[1]=[1,2,3];put(s,0,1,0,15);put(s,1,0,0,30);
  const a=observe(s,0);s.hands[1]=[card(0,'other')];s.offers[1]=[30,31,32];const b=observe(s,0);expect(a).toEqual(b);
  s.zones[2].open=false;s.zones[2].id=8;expect(observe(s,0).zones[2].id).toBe(8);
  const opt={iterations:120,timeMs:30000,width:4,seed:73};expect(search(a,opt).plan).toEqual(search(b,opt).plan);
 });
 it('finds a terminal clear to win the third lane, and its reported probability is a sweep',()=>{
  const s=fixture();put(s,0,0,2,40);put(s,1,0,2,40);put(s,2,0,2,1);put(s,2,1,2,20);s.hands[0]=[card(21,'red')];
  const a=search(observe(s,0),{iterations:300,timeMs:30000,width:8,seed:101});expect(a.plan.moves[0]?.zone).toBe(2);expect(a.plan.moves[0]?.uid).toBe('red');
  expect(a.candidates[0].sweep).toBeGreaterThan(0);expect(a.candidates[0].sweep).toBeLessThanOrEqual(a.candidates[0].officialWin);
 });
 it('adapts lossless UIDs and side B, encodes held selected card, rejects unknown cards',()=>{
  const raw={mySide:2,round:{round:1,energy:1,choices:['红魔','弓箭手','海森堡'],priority:2},hand:[{heroId:'小布',uid:'9007199254740993'}],zones:[1,2,3].map(i=>({zoneIndex:i,battlefieldId:i,unlocked:i===1,cardLimit:4,sideA:{power:0,cards:[]},sideB:{power:0,cards:[]}}))};
  const o=fromServer(raw);expect(o.side).toBe(1);expect(o.hand[0].uid).toBe('9007199254740993');
  expect(wirePlan(o,{pick:0,moves:[{uid:o.hand[0].uid,zone:0}]})).toEqual([{cardUid:'9007199254740993',zoneIndex:1},{cardUid:'1',zoneIndex:0}]);
  expect(()=>fromServer({...raw,hand:[{heroId:'未识别',uid:9}]})).toThrow('未覆盖');
 });
 it('sampling intervals do not proclaim 90% from a few wins',()=>{expect(interval(10,10)[0]).toBeLessThan(.9);expect(interval(0,0)).toEqual([0,1]);});
 it('rollout still reinforces a narrow lead before the simultaneous final reveal',()=>{
  const s=fixture();put(s,0,0,0,5);put(s,1,0,0,5);put(s,0,1,0,4);put(s,1,1,0,4);s.hands[0]=[card(15,'defend')];
  const a=search(observe(s,0),{iterations:180,timeMs:30000,width:6,seed:351});expect(a.plan.moves.length).toBeGreaterThan(0);
 });
 it('official Seth receipts use ceil half base, excluding dynamic field bonuses',()=>{
  const s=fixture();s.zones[0].id=8;expect(play(s,31).zones[0].cards[0][0].power).toBe(13);
  s.zones[0].id=3;expect(play(s,31).zones[0].cards[0][0].power).toBe(11);
  s.zones[0].id=6;expect(play(s,31).zones[0].cards[0][0].power).toBe(17);
 });
 it('official Joker selects this lane, uses ceil, and leaves another lane untouched',()=>{
  const s=fixture();put(s,0,1,15,7);put(s,1,1,15,30);
  const n=play(s,17);expect(n.zones[0].cards[1][0].power).toBe(4);expect(n.zones[1].cards[1][0].power).toBe(30);
 });
 it('official adjacent support buffs one card in each neighboring battlefield',()=>{
  const s=fixture();put(s,0,0,15,5);put(s,2,0,15,5);
  const n=play(s,26,1);expect(powers(n)[0][0]).toBe(7);expect(powers(n)[2][0]).toBe(7);
 });
 it('camp end effect may select a card outside camp',()=>{
  const s=fixture();s.zones[0].id=7;put(s,0,0,15,5);put(s,1,1,15,5);
  const rng=new RNG(1);rng.choose=xs=>xs[xs.length-1];
  const n=resolve(s,[pass,pass],rng);expect(powers(n)[0][0]).toBe(5);expect(powers(n)[1][1]).toBe(7);
 });
 it('battlefield end buffs precede the card reduction and reductions cannot drive base below zero',()=>{
  const s=fixture();s.zones[0].id=1;put(s,0,0,33);put(s,0,1,5,1);
  const n=resolve(s,[pass,pass],new RNG(1));expect(n.zones[0].cards[1][0].base).toBe(1);
  const t=fixture();put(t,0,1,15,1);expect(play(t,9).zones[0].cards[1][0].base).toBe(0);
 });
 it('percentage effects persist for later camp buffs instead of a one-off adjustment',()=>{
  const s=fixture(5);let n=play(s,31);n.offers=[[],[]];n.zones[1].id=7;
  const rng=new RNG(3);rng.choose=xs=>xs[0];n=resolve(n,[pass,pass],rng);
  expect(n.zones[0].cards[0][0].power).toBe(12);
  const t=fixture(5);put(t,0,1,15,8);let m=play(t,17);m.offers=[[],[]];m.zones[1].id=7;
  rng.choose=xs=>xs.find((c:any)=>c.id===15)||xs[0];m=resolve(m,[pass,pass],rng);
  expect(m.zones[0].cards[1][0].power).toBe(5);
 });
 it('drafts and draws exclude this player’s already acquired cards, without leaking the other hand',()=>{
  const s=newGame(44);
  for(let side=0;side<2;side++){
   expect(new Set(s.hands[side].map(c=>c.id)).size).toBe(3);
   expect(s.offers[side].some(id=>s.hands[side].some(c=>c.id===id))).toBe(false);
  }
  const a=observe(s,0);s.seen![1]=[...s.seen![1],21];s.hands[1]=[card(21,'secret')];expect(observe(s,0).seen).toEqual(a.seen);
 });
 it('does not apply the opponent retention prior to fresh local draws',()=>{
  const counts=Array(CARDS.length).fill(0);
  for(let seed=1;seed<=2000;seed++)for(const c of newGame(Math.imul(seed,2654435761),null).hands.flat())counts[c.id]++;
  const expensive=counts.reduce((n,c,id)=>n+(CARDS[id].cost>=5?c:0),0)/12000;
  const uniform=CARDS.filter(c=>c.cost>=5).length/CARDS.length;
  expect(Math.abs(expensive-uniform)).toBeLessThan(.03);
 });
 it('reconciles authoritative positive power when the initial aura prediction is clamped to zero',()=>{
  const raw={mySide:1,round:{round:5,energy:5,priority:1},hand:[],zones:[1,2,3].map(i=>({zoneIndex:i,battlefieldId:8,unlocked:true,
   sideA:{cards:i===1?[{uid:'100',heroId:'弓箭手',currentPower:3}]:[],power:i===1?3:0},
   sideB:{cards:i===1?[{uid:'101',heroId:'瑞文',currentPower:3},{uid:'102',heroId:'修女瑟琳娜',currentPower:2}]:[],power:i===1?5:0}}))};
  const o=fromServer(raw);expect(o.warnings).toEqual([]);expect(o.zones[0].cards[0][0].power).toBe(3);
 });
 it('reconstructs public percentage receipts only from the current match',()=>{
  const raw={mySide:1,round:{round:6,energy:6,priority:1},hand:[],zones:[1,2,3].map(i=>({zoneIndex:i,battlefieldId:8,unlocked:true,
   sideA:{cards:i===1?[{uid:'100',heroId:'典狱长赛斯',currentPower:13}]:[],power:i===1?13:0},sideB:{cards:[],power:0}}))};
  const turns=Array.from({length:5},(_,i)=>({before:{round:{round:i+1},zones:[]},reply:{nextRound:{round:i+2},events:i===4?
   [{type:2,owner:1,cardUid:100,heroId:'典狱长赛斯',zoneIndex:1},{type:4,owner:1,cardUid:100,heroId:'典狱长赛斯',zoneIndex:1,powerChanges:[{cardUid:100,deltaPower:3}]}]:[]}}));
  expect(fromServer({state:raw,turns}).zones[0].cards[0][0].baseFactor).toBe(1.5);
  expect(fromServer({state:{...raw,round:{round:1,energy:1,priority:1}},turns}).zones[0].cards[0][0].baseFactor).toBeUndefined();
 });
 it('Butcher’s observed comparison excludes dynamic lane count bonuses',()=>{
  const s=fixture();put(s,0,0,0,2);put(s,0,0,12,3);put(s,0,1,6,2);put(s,0,1,24,4);
  const n=resolve(s,[pass,pass],new RNG(1));expect(n.zones[0].cards[1].find(c=>c.id===24)?.base).toBe(4);
 });
 it('official stars accept an awarded tie without guessing local tie winners',()=>{
  const r={winner:1,zoneResults:[{zoneIndex:1,sideAPower:13,sideBPower:13,winner:1},
    {zoneIndex:2,sideAPower:18,sideBPower:10,winner:1},{zoneIndex:3,sideAPower:19,sideBPower:17,winner:1}]};
  expect(officialResult(r,1)).toEqual({stars:3,strictStars:2,win:true,draw:false});
  expect(officialResult({...r,winner:2},1)).toBeNull();
  const s=fixture();for(let i=0;i<3;i++){put(s,i,0,15,5);put(s,i,1,15,5);}expect(sweep(s,0)).toBe(false);
 });
 it('bounded continuation sampling retains each draft/pass and generates legal ordered combinations',()=>{
  const s=fixture();s.hands[0]=[0,1,2,3].map((id,i)=>card(id,'h'+i));s.offers[0]=[4,5,6];
  const ps=rolloutPlans(s,0,new RNG(9173),100);
  expect(ps.every(p=>legal(s,0,p))).toBe(true);
  for(let pick=0;pick<3;pick++)expect(ps.some(p=>p.pick===pick&&!p.moves.length)).toBe(true);
  expect(ps.some(p=>p.moves.length>=3)).toBe(true);expect(ps.length).toBeLessThan(200);
 });
});
