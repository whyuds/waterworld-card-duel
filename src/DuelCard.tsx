import {CARDS} from './card-engine';
import type {Card} from './card-engine';
import {duelPortrait, duelSprite} from './duel-art';

export function DuelCard({c,small=false}:{c:Card;small?:boolean}) {
  const d=CARDS[c.id];
  return <div className={'snap-card native-card ' + (small?'snap-small':'')} title={d.effectDesc}>
    <div className="native-card-face" style={{backgroundImage:`url(${duelSprite('card_bg_02')})`}}>
      <img className="native-hero-art" src={duelPortrait(d.heroId)} alt={d.heroId}/>
      {!small && <span className="native-cost" style={{backgroundImage:`url(${duelSprite('card_icon_01')})`}}>{d.cost}</span>}
      <span className={'native-power ' + (c.power> d.power?'buff':c.power<d.power?'debuff':'')} style={{backgroundImage:`url(${duelSprite('card_icon_02')})`}}>{c.power}</span>
      {c.muted && <span className="native-muted">沉默</span>}
    </div>
    <strong>{d.heroId}</strong>{!small && <small>{d.effectType || '普通'}</small>}
  </div>;
}
