import {describe,it,expect} from 'vitest';
import {newGame,resolve,plans,RNG,card,refresh} from './card-engine';
import type {State,Plan} from './card-engine';
import type {ReplayCue} from './card-replay';
const pass:Plan={pick:-1,moves:[]};
function fixture():State {
  const s=newGame(17,null,'independent');s.round=6;s.energy=[6,6];s.priority=0;s.hands=[[],[]];s.offers=[[],[]];s.seen=[[],[]];
  for(const z of s.zones){z.id=0;z.open=true;z.cards=[[],[]];z.first=[false,false];}
  return s;
}
function play(id:number,enemy=0) {
  const s=fixture();s.zones[0].cards[1]=[card(enemy,'enemy')];s.hands[0]=[card(id,'play')];refresh(s);
  const cues:ReplayCue[]=[],frames:State[]=[];
  const result=resolve(s,[{pick:-1,moves:[{uid:'play',zone:0}]},pass],new RNG(15),(state,_,cue)=>{frames.push(state);if(cue)cues.push(cue);});
  return {cues,frames,result};
}
describe('display-only native skill playback',()=>{
  it('does not change outcomes or consume extra random numbers in 100 full games',()=>{
    for(let seed=1;seed<=100;seed++){
      let s=newGame(seed);const choose=new RNG(seed+731);
      while(s.round<=6){const ps:[Plan,Plan]=[choose.choose(plans(s,0))!,choose.choose(plans(s,1))!];const a=new RNG(seed+s.round),b=new RNG(seed+s.round);
        const bare=resolve(s,ps,a),shown=resolve(s,ps,b,()=>{});expect(shown).toEqual(bare);expect(b.seed).toBe(a.seed);s=bare;
      }
    }
  });
  it('separates reveal from targeted damage and keeps snapshots independent',()=>{
    const {cues,frames,result}=play(9,15);expect(cues.map(c=>c.kind)).toEqual(['reveal','skill']);
    expect(cues[1].targets).toEqual([expect.objectContaining({uid:'enemy',side:1,delta:-3})]);
    expect(frames[1].zones[0].cards[1][0].power).toBeGreaterThan(result.zones[0].cards[1][0].power);
    frames[1].zones[0].cards[1][0].base=500;expect(result.zones[0].cards[1][0].base).not.toBe(500);
  });
  it('records removal, movement, silence and own/opponent draw counts without naming hidden draws',()=>{
    expect(play(21).cues.some(c=>c.targets.some(t=>t.removed&&t.uid==='enemy'))).toBe(true);
    expect(play(14).cues.some(c=>c.targets.some(t=>t.moved&&t.uid==='enemy'))).toBe(true);
    expect(play(34,8).cues.some(c=>c.targets.some(t=>t.muted&&t.uid==='enemy'))).toBe(true);
    expect(play(1).cues.some(c=>c.draw?.[0]===1)).toBe(true);
    expect(JSON.stringify(play(1).cues)).not.toContain('heroId');
  });
  it('shows field and end-turn triggers in their actual settlement order',()=>{
    const s=fixture();s.zones[0].id=1;s.zones[0].cards[0]=[card(5,'grow')];refresh(s);
    const cues:ReplayCue[]=[];resolve(s,[pass,pass],new RNG(1),(_,__,c)=>{if(c)cues.push(c);});
    expect(cues.map(c=>c.kind)).toEqual(['field','skill']);expect(cues.every(c=>c.targets[0]?.delta===1)).toBe(true);
  });
});
