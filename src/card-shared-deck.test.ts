import {describe,it,expect} from 'vitest';
import {CARDS,MODEL_VERSION,ROUND_DEAL_PROFILE,newGame,card,clone,observe,sampleWorld,resolve,legal,search,RNG,fromServer} from './card-engine';
import type {State,Plan} from './card-engine';

const owned=(s:State,side:number)=>new Set([...(s.seen?.[side]||[]),...s.hands[side].map(c=>c.id),...s.zones.flatMap(z=>z.cards[side].map(c=>c.id))]);
function assertShared(s:State){
  const a=owned(s,0),b=owned(s,1);
  expect([...a].some(id=>b.has(id))).toBe(false);
  expect(a.size+b.size).toBeLessThanOrEqual(36);
  const taken=new Set([...a,...b]);
  for(let side=0;side<2;side++)expect(s.offers[side].some(id=>taken.has(id))).toBe(false);
  expect(s.offers[0].some(id=>s.offers[1].includes(id))).toBe(false);
}
const action=(s:State,side:number):Plan=>{
  const pick=s.offers[side].length&&s.hands[side].length<5?0:-1;
  const hand=[...s.hands[side],...(pick>=0?[card(s.offers[side][pick],'pick:'+side)]:[])];
  let p:Plan={pick,moves:[]};
  for(const c of hand)for(let zone=0;zone<3;zone++){
    const next={pick,moves:[...p.moves,{uid:c.uid,zone}]};
    if(legal(s,side,next)){p=next;break;}
  }
  return p;
};

describe('one shared 36-card pool and honest AI worlds',()=>{
  it('deals disjoint initial hands and temporary offers, then keeps acquisitions unique throughout six rounds',()=>{
    let returned=0;
    for(let seed=1;seed<=150;seed++){
      let s=newGame(Math.imul(seed,2654435761)),rng=new RNG(seed+193);
      const unselected=new Set<number>();
      while(s.round<=6){
        assertShared(s);
        const plans:[Plan,Plan]=[action(s,0),action(s,1)];
        for(let side=0;side<2;side++)s.offers[side].forEach((id,i)=>{if(i!==plans[side].pick)unselected.add(id);});
        s=resolve(s,plans,rng);assertShared(s);
        returned+=s.offers.flat().filter(id=>unselected.has(id)).length;
      }
    }
    expect(returned).toBeGreaterThan(0);
  });
  it('never draws a card taken or destroyed by either player, including an extra draw effect',()=>{
    const s=newGame(19);s.round=3;s.energy=[3,3];s.offers=[[],[]];s.seen=[[1],[...CARDS.keys()].filter(i=>i!==1&&i!==35)];
    s.hands=[[card(1,'bow')],[]];s.zones.forEach(z=>{z.id=1;z.open=true;z.cards=[[],[]];});
    const scarce=resolve(s,[{pick:-1,moves:[]},{pick:-1,moves:[]}],new RNG(318));
    expect(scarce.offers.flat()).toEqual([35]);assertShared(scarce);
    const n=resolve(s,[{pick:-1,moves:[{uid:'bow',zone:0}]},{pick:-1,moves:[]}],new RNG(317));
    expect(n.hands[0].map(c=>c.id)).toEqual([35]);
    expect(n.offers).toEqual([[],[]]);assertShared(n);
    expect(()=>resolve(n,[{pick:-1,moves:[]},{pick:-1,moves:[]}],new RNG(20))).not.toThrow();
  });
  it('rejects two picks of one physical card instead of resolving a duplicated shared hero',()=>{
    const s=newGame(22),taken=new Set([...owned(s,0),...owned(s,1)]);
    const id=[...CARDS.keys()].find(i=>!taken.has(i))!;s.offers=[[id],[id]];
    expect(()=>resolve(s,[{pick:0,moves:[]},{pick:0,moves:[]}],new RNG(20))).toThrow('同一张共享牌');
    const n=clone(s);n.seen![1].push(id);
    expect(legal(n,0,{pick:0,moves:[]})).toBe(false);
  });
  it('samples hidden hands and offers from the shared remainder, excluding the AI own hand, own candidates and public history',()=>{
    const s=newGame(334),o=observe(s,1);
    const old=[...CARDS.keys()].find(id=>![...owned(s,0),...owned(s,1),...o.choices].includes(id))!;
    o.seen![1].push(old);
    for(let seed=1;seed<=100;seed++){
      const n=sampleWorld(o,new RNG(seed));assertShared(n);
      const forbidden=new Set([...o.hand.map(c=>c.id),...o.choices,...o.seen![1],...o.seen![0]]);
      expect(n.hands[0].some(c=>forbidden.has(c.id))).toBe(false);
      expect(n.offers[0].some(id=>forbidden.has(id))).toBe(false);
    }
  });
  it('changing the actual human hand, private history, offers or draft does not change the AI observation or sampled world',()=>{
    const s=newGame(411),o=observe(s,1),a=sampleWorld(o,new RNG(12));
    s.hands[0]=[card(21,'hidden-loki')];s.seen![0]=[21];s.offers[0]=[18,28,30];
    expect(observe(s,1)).toEqual(o);
    expect(sampleWorld(observe(s,1),new RNG(12))).toEqual(a);
  });
  it('preserves shared depletion in future rollouts while returning a legal current action with a distinct model version',()=>{
    const s=newGame(75),o=observe(s,0),a=search(o,{iterations:40,timeMs:100,width:8,seed:193});
    expect(a.model).toBe(MODEL_VERSION);expect(MODEL_VERSION).toContain('shared');
    expect(legal(s,0,a.plan)).toBe(true);
    let n=sampleWorld(o,new RNG(13));const rng=new RNG(15);
    while(n.round<=6){n=resolve(n,[action(n,0),action(n,1)],rng);assertShared(n);}
  });
  it('server adaptation retains only visible enemy history and known own historical cards',()=>{
    const raw={mySide:1,round:{round:2,energy:2,priority:1,choices:['海森堡','兰博','成龙']},hand:[{heroId:'小布',uid:'102'}],
      zones:[1,2,3].map(i=>({zoneIndex:i,battlefieldId:1,unlocked:i<3,sideA:{cards:[],power:0},sideB:{cards:[],power:0}}))};
    const turn={before:{round:{round:1},hand:[{heroId:'弓箭手',uid:'101'}],zones:[]},reply:{hand:[],nextRound:{round:2},events:[
      {type:2,owner:2,heroId:'瑞文',cardUid:201,zoneIndex:1},{type:8,owner:2,heroId:'灭霸',cardUid:202}]}};
    const o=fromServer({state:raw,turns:[turn]});
    expect(o.deckMode).toBe('shared');expect(o.dealProfile).toBe(ROUND_DEAL_PROFILE);
    expect(o.seen![0]).toContain(CARDS.findIndex(c=>c.heroId==='弓箭手'));
    expect(o.seen![1]).toContain(CARDS.findIndex(c=>c.heroId==='瑞文'));
    expect(o.seen![1]).not.toContain(CARDS.findIndex(c=>c.heroId==='灭霸'));
  });
});
