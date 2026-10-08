import {useLayoutEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {ReplayCue} from './card-replay';
import {duelSprite} from './duel-art';
type Point={x:number;y:number};
type Effect={from:Point;to:Point;angle:number;text:string;negative:boolean;self:boolean};
export function DuelEffects({board,cue,tick}:{board:RefObject<HTMLDivElement|null>;cue?:ReplayCue;tick:number}) {
  const previous=useRef<Record<string,Point>>({}),[effects,setEffects]=useState<Effect[]>([]);
  useLayoutEffect(()=>{
    const root=board.current;if(!root)return;
    const rect=root.getBoundingClientRect(),now:Record<string,Point>={};
    root.querySelectorAll<HTMLElement>('[data-card-uid],[data-effect-zone]').forEach(e=>{
      const box=e.getBoundingClientRect();now[e.dataset.cardUid??'zone:'+e.dataset.effectZone]={x:box.left-rect.left+box.width/2,y:box.top-rect.top+box.height/2};
    });
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches) for(const t of cue?.targets??[]) {
      const old=previous.current[t.uid],to=now[t.uid];
      if(t.moved&&old&&to) root.querySelector<HTMLElement>(`[data-card-uid="${CSS.escape(t.uid)}"]`)?.animate([
        {transform:`translate(${old.x-to.x}px,${old.y-to.y}px)`,filter:'brightness(1.4)'},{transform:'translate(0,0)',filter:'brightness(1)'}
      ],{duration:650,easing:'ease-in-out'});
    }
    const from=cue && (now[cue.source??'zone:'+cue.zone]??previous.current[cue.source??'zone:'+cue.zone]);
    setEffects(from&&cue ? cue.targets.flatMap(t=>{
      const to=now[t.uid]??previous.current[t.uid];if(!to)return [];
      const text=t.removed?'移除':t.muted?'沉默':t.moved?'移动':t.delta>0?'+'+t.delta:String(t.delta);
      return [{from,to,angle:Math.atan2(to.y-from.y,to.x-from.x)*180/Math.PI,text,negative:t.delta<0||!!t.removed||!!t.muted,self:Math.hypot(from.x-to.x,from.y-to.y)<5}];
    }):[]);
    previous.current=now;
  },[tick]);
  return <div className="duel-effects" aria-hidden="true">{effects.map((e,i)=><div key={tick+':'+i}>
    {!e.self && <div className="duel-projectile" style={{left:e.from.x,top:e.from.y,'--dx':(e.to.x-e.from.x)+'px','--dy':(e.to.y-e.from.y)+'px'} as React.CSSProperties}><span className="duel-native-bullet" style={{backgroundImage:`url(${duelSprite(e.negative?'bullet-red':'bullet-blue')})`,transform:`rotate(${e.angle}deg)`}}/></div>}
    <span className="duel-native-hit" style={{left:e.to.x,top:e.to.y,backgroundImage:`url(${duelSprite('skill-hit')})`}}/>
    <b className={'duel-impact '+(e.negative?'negative':'positive')} style={{left:e.to.x,top:e.to.y}}>{e.text}</b>
  </div>)}</div>;
}
