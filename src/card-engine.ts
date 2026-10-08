/** Six-round, simultaneous, hidden-hand card game. No network or account access.
 * Config descriptions are authoritative; server-only timing/rounding is a model
 * assumption until a real receipt validates it. Search never receives hidden hands.
 */
import config from './card-config.json';
export const CARDS = config.GameCardCfg;
export const FIELDS = config.CardGameBattleFieldCfg;
export const MODEL_VERSION = 'snap-36-search-v8-shared-deal';
export const ROUND_DEAL_PROFILE = 'round-cost-v2';
// Effective visible-pool cost-group weights, fitted to 454 complete official
// games. 368 train / 86 temporal whole-game holdout supported the round model.
// Opponent private acquisitions/reservations are unknown: NOT server probabilities.
// Positive penalized estimates retain rare costs; exhausted groups are renormalized.
export const INITIAL_COST_WEIGHTS = [0.489874285,0.329931630,0.118045522,0.036889309,0.017288055,0.007971199];
export const ROUND_COST_WEIGHTS = [
  [0.481862043,0.312385808,0.117372266,0.047885201,0.025311790,0.015182892],
  [0.091521905,0.507948433,0.313638196,0.056583992,0.018751589,0.011555885],
  [0.015423402,0.117582139,0.495288954,0.303425515,0.053809618,0.014470372],
  [0.004763533,0.023044624,0.114991112,0.521621815,0.285622126,0.049956791],
  [0.014725487,0.015812887,0.040312726,0.129718725,0.506632660,0.292797516],
  [0.010096149,0.019277895,0.052679658,0.149599140,0.269854502,0.498492657],
];
const defs = new Map(CARDS.map((c, i) => [c.heroId, i]));
export type Card = {uid: string; id: number; base: number; power: number; muted: boolean; face: boolean;
  baseFactor?: number; finalFactor?: number};
export type Zone = {id: number; cards: [Card[], Card[]]; limit: number; open: boolean;
  ban: [number, number]; cap: [number, number]; mute: [boolean, boolean]; first: [boolean, boolean]};
export type State = {round: number; energy: [number, number]; priority: number; zones: Zone[];
  hands: [Card[], Card[]]; offers: [number[], number[]]; bonus: [number, number]; nextUid: number;
  publicCounts: [number,number]; opponentCount: number; warnings: string[];
  seen?: [number[],number[]]; revealed?: [number[],number[]]; trialSide?: number;
  dealProfile?: typeof ROUND_DEAL_PROFILE; deckMode?: 'shared' | 'independent'};
export type Move = {uid: string; zone: number};
export type Plan = {pick: number; moves: Move[]};
export type Observation = Omit<State, 'hands' | 'offers'> & {side: number; hand: Card[]; choices: number[]};
export type Advice = {plan: Plan; candidates: {plan: Plan; score: number; sweep: number; officialWin: number; draw: number; n: number; interval: [number, number]}[];
  simulations: number; candidatesCount: number; elapsedMs: number; warnings: string[]; model: string};
export class RNG {
  constructor(public seed: number) {this.seed = seed >>> 0 || 1;}
  next() {let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296;}
  choose<T>(xs: T[]): T | undefined {return xs.length ? xs[Math.floor(this.next() * xs.length)] : undefined;}
}
export function card(id: number, uid: string): Card {
  if (!CARDS[id]) throw Error('未知卡牌，需更新模型');
  return {id, uid, base: CARDS[id].power, power: CARDS[id].power, muted: false, face: true};
}
export function clone(s: State): State {
  return {...s, energy: [...s.energy], bonus: [...s.bonus], publicCounts:[...s.publicCounts], warnings: [...s.warnings],
    seen:s.seen?[[...s.seen[0]],[...s.seen[1]]]:undefined,
    revealed:s.revealed?[[...s.revealed[0]],[...s.revealed[1]]]:undefined,
    hands: [s.hands[0].map(c => ({...c})), s.hands[1].map(c => ({...c}))], offers: [[...s.offers[0]], [...s.offers[1]]],
    zones: s.zones.map(z => ({...z, cards: [z.cards[0].map(c => ({...c})), z.cards[1].map(c => ({...c}))],
      ban: [...z.ban], cap: [...z.cap], mute: [...z.mute], first: [...z.first]}))};
}
function used(s: State, side: number) {
  const owners = s.deckMode === 'independent' ? [side] : [0, 1];
  return new Set(owners.flatMap(owner => [...(s.seen?.[owner] || []), ...s.hands[owner].map(c => c.id), ...all(s, owner).map(c => c.id)]));
}
function unavailable(s:State, side:number, reserveOffers=false) {
  const blocked = used(s, side);
  if (reserveOffers && s.deckMode !== 'independent') s.offers[1 - side].forEach(id => blocked.add(id));
  return blocked;
}
function weightedCard(rng: RNG, excluded: Set<number>, trial=false, retainedRound=0, costs?: readonly number[]) {
  const remainingByCost = Array(7).fill(0);
  if (costs) CARDS.forEach((c, id) => {if (!excluded.has(id)) remainingByCost[c.cost]++;});
  const weights=CARDS.map((c,id)=>excluded.has(id)?0:(trial?(c.cost===6?.015:c.cost===5?.18:c.cost===4?.8:1):1)
    *(retainedRound>0?Math.exp(.3*Math.max(0,c.cost-retainedRound)):1)
    *(costs ? costs[c.cost - 1] / remainingByCost[c.cost] : 1));
  let ticket=rng.next()*weights.reduce((a,b)=>a+b,0);
  for(let id=0;id<weights.length;id++){ticket-=weights[id];if(ticket<0)return id;}
  throw Error('牌库已空');
}
function dealCosts(s: State, initial=false) {
  return s.dealProfile === ROUND_DEAL_PROFILE ? initial ? INITIAL_COST_WEIGHTS : ROUND_COST_WEIGHTS[Math.min(6, Math.max(1, s.round)) - 1] : undefined;
}
function draw(s: State, side: number, rng: RNG, initial=false) {
  if (s.hands[side].length < 5) {
    const blocked = unavailable(s, side, true);
    if (blocked.size >= CARDS.length) return;
    const id=weightedCard(rng,blocked,s.trialSide===side,0,dealCosts(s,initial));
    s.hands[side].push(card(id,'sim:'+s.nextUid++));s.publicCounts[side]++;
    s.seen??=[[],[]];s.seen[side].push(id);
  }
}
function offer(rng: RNG, excluded=new Set<number>(), trial=false, costs?: readonly number[]) {
  const result: number[] = [];
  const occupied=new Set(excluded);
  while (result.length < 3 && occupied.size < CARDS.length) {const id=weightedCard(rng,occupied,trial,0,costs);result.push(id);occupied.add(id);}
  return result;
}
function dealOffers(s:State, rng:RNG) {
  s.offers = [[], []];
  if (s.deckMode === 'independent') {
    for (let side = 0; side < 2; side++) if (s.hands[side].length < 5)
      s.offers[side] = offer(rng, used(s, side), s.trialSide === side, dealCosts(s));
    return;
  }
  // Reserve candidates round-robin so neither player receives all scarce costs
  // simply because the dealer loops over that player first. Unchosen cards are
  // released when both picks are committed; they are never added to `seen`.
  const first = +(rng.next() < .5);
  for (let slot = 0; slot < 3; slot++) for (const side of [first, 1 - first]) {
    if (s.hands[side].length >= 5) continue;
    const blocked = new Set([...unavailable(s, side, true), ...s.offers[side]]);
    if (blocked.size < CARDS.length) s.offers[side].push(weightedCard(rng, blocked, s.trialSide === side, 0, dealCosts(s)));
  }
}
export function newGame(seed = 1, dealProfile: typeof ROUND_DEAL_PROFILE | null = ROUND_DEAL_PROFILE, deckMode: State['deckMode'] = 'shared'): State {
  const rng = new RNG(seed), ids: number[] = [];
  while (ids.length < 3) {const id = 1 + Math.floor(rng.next() * FIELDS.length); if (!ids.includes(id)) ids.push(id);}
  const s: State = {deckMode, ...(dealProfile ? {dealProfile} : {}), round: 1, energy: [1, 1], priority: rng.next() < .5 ? 0 : 1, zones: ids.map((id, i) =>
    ({id, cards: [[], []], limit: 4, open: i === 0, ban: [-1, -1], cap: [0, 0], mute: [false, false], first: [false, false]})),
    hands: [[], []], offers: [[], []], bonus: [0, 0], nextUid: 100, publicCounts:[0,0], opponentCount: 3, warnings: []};
  for (let slot = 0; slot < 3; slot++) for (const side of [s.priority, 1 - s.priority]) draw(s, side, rng, true);
  dealOffers(s, rng);
  return s;
}
export function observe(s: State, side: number): Observation {
  const copy = clone(s);
  // The official client displays battlefield name/effect even while its slot is
  // locked. Keep this public preview; it still cannot receive cards until open.
  const {hands, offers, ...publicState} = copy;
  // The other player's dealt-card identities are private. Only its revealed
  // board enters the public deck exclusion; hand count alone is observable.
  publicState.seen=[copy.seen?.[side]||[],[]] as [number[],number[]];
  publicState.seen[side]=[...(copy.seen?.[side]||[])];
  publicState.seen[1-side]=[...new Set([...(copy.revealed?.[1-side]||[]),...all(copy,1-side).filter(c=>c.face).map(c=>c.id)])];
  return {...publicState, side, hand: hands[side], choices: offers[side], opponentCount: s.publicCounts[1-side]};
}
function active(c: Card) {return c.face && !c.muted && CARDS[c.id].effectType === '持续';}
function all(s: State, side?: number) {
  return s.zones.flatMap(z => side === undefined ? z.cards.flat() : z.cards[side]);
}
function visible(z: Zone, side: number) {return z.cards[side].filter(c => c.face);}
export function refresh(s: State) {
  const ongoingCount = all(s).filter(active).length;
  for (const z of s.zones) for (let side = 0; side < 2; side++) {
    const own = visible(z, side), enemy = visible(z, 1 - side);
    const lily = own.filter(c => active(c) && c.id === 8).length;
    const riven = enemy.filter(c => active(c) && c.id === 4).length;
    const nun = enemy.filter(c => active(c) && c.id === 32).length;
    const trump = own.filter(c => active(c) && c.id === 13).length;
    const diana = own.filter(c => active(c) && c.id === 18).length;
    for (const c of z.cards[side]) {
      if (!c.face) {c.power = 0; continue;}
      const def = CARDS[c.id];
      let value = c.base * (c.baseFactor ?? 1) + lily - riven - 2 * nun;
      if (active(c)) {
        if (c.id === 0) value += own.length;
        if (c.id === 11 && own.length >= 2) value += 3;
        if (c.id === 22) value += 2 * ongoingCount;
        value += 2 * trump;
      }
      if (z.id === 2 && def.effectType === '持续') value += 2;
      if (z.id === 3 && def.effectType === '揭示') value += 2;
      if (z.id === 4 && own.length >= 3) value += 3;
      if (z.id === 8 && def.cost >= 4) value += 4;
      if (z.id === 9 && def.cost <= 3) value += 2;
      c.power = Math.max(0, Math.ceil(value * (c.finalFactor ?? 1) * 2 ** diana - 1e-10));
    }
  }
}
export function powers(s: State): [number, number][] {
  return s.zones.map(z => [z.cards[0].reduce((n, c) => n + c.power, 0), z.cards[1].reduce((n, c) => n + c.power, 0)]);
}
export function winner(s: State): number {
  const p = powers(s), wins = [0, 0];
  for (const [a, b] of p) if (a !== b) wins[a > b ? 0 : 1]++;
  // Screenshot explicitly requires two zones; one zone each is a draw here.
  return wins[0] >= 2 ? 0 : wins[1] >= 2 ? 1 : -1;
}
/** The user's success criterion is strictly 3/3. Ties and ordinary 2/3 wins fail. */
export function zoneWins(s: State, side: number): number {
  return powers(s).filter(p => p[side] > p[1 - side]).length;
}
export function sweep(s: State, side: number): boolean {
  return s.zones.length === 3 && zoneWins(s, side) === 3;
}
/** Official stars are reported by the server, not inferred from a tied power.
 * The local unverified tie rule remains conservative; never fabricate its winner. */
export function officialResult(settlement:any, side:number) {
  const zones=settlement?.zoneResults||[];
  if(![1,2].includes(side)||zones.length!==3||new Set(zones.map((z:any)=>z.zoneIndex)).size!==3
    ||![1,2,3].every(i=>zones.some((z:any)=>z.zoneIndex===i)))return null;
  if(zones.some((z:any)=>!Number.isFinite(z.sideAPower)||!Number.isFinite(z.sideBPower)||![0,1,2].includes(z.winner)
    ||z.sideAPower!==z.sideBPower&&z.winner!==(z.sideAPower>z.sideBPower?1:2)))return null;
  const a=zones.filter((z:any)=>z.winner===1).length,b=zones.filter((z:any)=>z.winner===2).length;
  const result=a>=2?1:b>=2?2:0;
  if(settlement.winner!==result)return null;
  return {stars:side===1?a:b,win:result===side,draw:result===0,
    strictStars:zones.filter((z:any)=>side===1?z.sideAPower>z.sideBPower:z.sideBPower>z.sideAPower).length};
}
export type ReplayTarget = {uid:string; zone:number; side:number; delta:number; moved?:boolean; removed?:boolean; muted?:boolean};
export type ReplayCue = {kind:'reveal'|'skill'|'field'; source?:string; zone?:number; targets:ReplayTarget[]; draw?:[number,number]; bonus?:[number,number]};
export type ReplayStep = (state:State, label:string, cue?:ReplayCue) => void;
export function replayChange(before:State, after:State, source:{kind:ReplayCue['kind']; source?:string; zone?:number}):ReplayCue {
  const positions=(s:State)=>s.zones.flatMap((z,zone)=>z.cards.flatMap((cs,side)=>cs.filter(c=>c.face).map(c=>({...c,zone,side}))));
  const old=positions(before),now=positions(after);
  const targets:ReplayTarget[]=[];
  for(const c of old){const next=now.find(t=>t.uid===c.uid);
    if(!next)targets.push({uid:c.uid,zone:c.zone,side:c.side,delta:0,removed:true});
    else if(next.power!==c.power||next.zone!==c.zone||next.muted!==c.muted) targets.push({uid:c.uid,zone:next.zone,side:next.side,delta:next.power-c.power,moved:next.zone!==c.zone,muted:next.muted&&!c.muted});
  }
  const revealed=now.find(c=>c.uid===source.source&&!old.some(t=>t.uid===c.uid));
  if(revealed && revealed.power!==CARDS[revealed.id].power) targets.push({uid:revealed.uid,zone:revealed.zone,side:revealed.side,delta:revealed.power-CARDS[revealed.id].power});
  return {...source,targets,draw:[after.hands[0].length-before.hands[0].length,after.hands[1].length-before.hands[1].length],bonus:[after.bonus[0]-before.bonus[0],after.bonus[1]-before.bonus[1]]};
}
function emitSkill(step:ReplayStep|undefined,before:State|undefined,after:State,source:ReplayCue['source'],zone?:number) {
  if(!step||!before)return;
  const c=after.zones.flatMap(z=>z.cards.flat()).find(c=>c.uid===source) || before.zones.flatMap(z=>z.cards.flat()).find(c=>c.uid===source);
  const def=c?CARDS[c.id]:undefined,field=zone===undefined?undefined:FIELDS.find(f=>f.battlefieldId===after.zones[zone].id);
  const cue=replayChange(before,after,{kind:source?'skill':'field',source,zone});
  step(clone(after),def?`${def.heroId} · ${def.effectDesc}`:`${field?.battlefieldName} · ${field?.effectDesc}`,cue);
}

function locate(s: State, uid: string) {
  for (const z of s.zones) for (let side = 0; side < 2; side++) {
    const c = z.cards[side].find(c => c.uid === uid); if (c) return {z, side, c};
  }
  return null;
}
function suppress(z: Zone, side: number) {
  return z.mute[side] || visible(z, 1 - side).some(c => active(c) && c.id === 10);
}
function reveal(s: State, uid: string, rng: RNG, effect?: number, stack: number[] = [], step?:ReplayStep) {
  const found = locate(s, uid); if (!found) return;
  const {z, side, c} = found, enemy = 1 - side, id = effect ?? c.id;
  if (suppress(z, side) || stack.includes(id) || stack.length > 8) return;
  const before=step?clone(s):undefined;
  const next = [...stack, id];
  if(id===16||id===19) emitSkill(step,before,s,uid);
  const add = (target: Card | undefined, n: number) => {if (target) target.base = Math.max(0, target.base + n);};
  switch (id) {
    case 1: draw(s, side, rng); break;
    case 2: if (z.cards[side][0]?.uid === uid) add(c, 3); break;
    case 3: add(rng.choose(all(s, side).filter(c => c.face)), 2); break;
    case 6: s.bonus[side]++; break;
    case 7: z.ban[enemy] = 0; break;
    case 9: add(rng.choose(visible(z, enemy)), -3); break;
    case 12: for (const other of s.zones) if (other !== z) add(rng.choose(visible(other, side)), 3); break;
    case 14: {
      const target = rng.choose(visible(z, enemy));
      const dest = rng.choose(s.zones.filter(other => other !== z && other.open && other.cards[enemy].length < other.limit));
      if (target && dest) {z.cards[enemy] = z.cards[enemy].filter(c => c !== target); dest.cards[enemy].push(target);} break;
    }
    case 15: {const p = powers(s)[s.zones.indexOf(z)]; if (p[side] < p[enemy]) add(c, 4); break;}
    case 16: for (const target of visible(z, side)) {
      if (target.uid !== uid && CARDS[target.id].effectType === '揭示') reveal(s, target.uid, rng, undefined, next, step);
    } break;
    case 17: {
      // Official effect receipts select the highest enemy in this lane, not
      // another battlefield (including no effect when this lane is empty).
      const enemies = visible(z, enemy), max = Math.max(...enemies.map(c => c.power));
      const target = rng.choose(enemies.filter(c => c.power === max));
      if (target) target.finalFactor = (target.finalFactor ?? 1) * .5;
      break;
    }
    case 19: {
      const target = rng.choose(all(s, side).filter(t => t.face && CARDS[t.id].effectType === '揭示' && !next.includes(t.id)));
      if (target) reveal(s, uid, rng, target.id, next, step); break;
    }
    case 20: while (visible(z, enemy).length > 2) {
      const target = rng.choose(visible(z, enemy)); z.cards[enemy] = z.cards[enemy].filter(c => c !== target);
    } break;
    case 21: z.cards[enemy] = z.cards[enemy].filter(c => !c.face); break;
    case 23: add(c, 2 * s.hands[side].length); break;
    case 28: for (const target of visible(z, side)) add(target, 4); break;
    case 29: {
      const p = powers(s), dest = rng.choose(s.zones.filter((_, i) => p[i][side] < p[i][enemy]));
      if (dest) add(rng.choose(visible(dest, side)), 3); break;
    }
    case 30: s.bonus[side] += 2; break;
    // Receipts distinguish persistent base buffs from dynamic field bonuses:
    // 6+fortress4 -> +3; tower base11 -> +6 (ceil), not half currentPower.
    case 31: c.baseFactor = (c.baseFactor ?? 1) * 1.5; break;
    case 34: for (const target of z.cards[enemy]) if (CARDS[target.id].effectType === '持续') target.muted = true; break;
  }
  refresh(s);
  // Recursive retriggers already emit their own changes; do not double-play them.
  if(id!==16 && id!==19) emitSkill(step,before,s,uid);
}
function endEffects(s: State, rng: RNG, step?:ReplayStep) {
  // Official event streams settle battlefields before card end-turn effects.
  for (const z of s.zones) {
    if (!z.open) continue;
    const before=step?clone(s):undefined;
    const cards = [...visible(z, 0), ...visible(z, 1)];
    if (z.id === 1) for (const c of cards) if (CARDS[c.id].effectType === '持续') c.base++;
    if (z.id === 5 && s.round === 4) {
      const max = Math.max(...cards.map(c => c.power)); const target = rng.choose(cards.filter(c => c.power === max));
      if (target) target.base += 5;
    }
    if (z.id === 7) {const target = rng.choose(all(s).filter(c => c.face)); if (target) target.base += 2;}
    refresh(s);
    if([1,7].includes(z.id)||z.id===5&&s.round===4) emitSkill(step,before,s,undefined,s.zones.indexOf(z));
  }
  // Stable zone/side/placement order; server-only ordering is tested by receipts.
  for (const z of s.zones) for (let side = 0; side < 2; side++) for (const c of [...visible(z, side)]) {
    if (!active(c)) continue;
    const before=step?clone(s):undefined;
    const bonus = all(s, side).filter(t => active(t) && t.id === 27).length;
    const p = powers(s)[s.zones.indexOf(z)];
    if (c.id === 5) c.base += 1 + bonus;
    // The observed conditional compares persistent card power; dynamic lane
    // auras (Little Bu, Wind, etc.) do not satisfy the lead condition.
    const baseTotals = z.cards.map(cs=>cs.filter(t=>t.face).reduce((n,t)=>n+Math.ceil(t.base*(t.baseFactor??1)*(t.finalFactor??1)),0));
    if (c.id === 24 && baseTotals[side] < baseTotals[1-side]) c.base += 2 + bonus;
    if (c.id === 25 && visible(z, side).filter(active).length >= 2) c.base += 1 + bonus;
    if (c.id === 26) {
      const index = s.zones.indexOf(z);
      for (let i = 0; i < s.zones.length; i++) if (Math.abs(i-index) === 1) {
        const target = rng.choose(visible(s.zones[i], side)); if (target) target.base += 2 + bonus;
      }
    }
    if (c.id === 33) {
      const enemy = visible(z, 1 - side), max = Math.max(...enemy.map(t => t.power));
      const target = rng.choose(enemy.filter(t => t.power === max)); if (target) target.base = Math.max(0, target.base - 2);
    }
    refresh(s);
    if([5,24,25,26,33].includes(c.id)) emitSkill(step,before,s,c.uid);
  }
}
function pickHand(s: State, side: number, pick: number) {
  const hand = s.hands[side].map(c => ({...c}));
  if (s.offers[side].length && hand.length < 5) {
    if (!Number.isInteger(pick) || pick < 0 || pick >= s.offers[side].length) throw Error('必须选择本回合提供的卡牌');
    if (used(s, side).has(s.offers[side][pick])) throw Error('这张牌已经从牌池取走');
    hand.push(card(s.offers[side][pick], 'pick:' + side));
  } else if (pick !== -1) throw Error('当前不能选牌');
  return hand;
}
export function legal(s: State, side: number, plan: Plan) {
  let hand: Card[]; try {hand = pickHand(s, side, plan.pick);} catch {return false;}
  let energy = s.energy[side]; const counts = s.zones.map(z => z.cards[side].length), added = [0, 0, 0];
  if (!Array.isArray(plan.moves) || plan.moves.length > 5) return false;
  for (const m of plan.moves) {
    const c = hand.find(c => c.uid === m.uid), z = s.zones[m.zone];
    if (!c || !z || !z.open || counts[m.zone] >= z.limit || z.ban[side] === 0 || z.ban[side] > 0 && added[m.zone] >= z.ban[side]) return false;
    const cap = z.cap[side] || (visible(z, 1 - side).some(c => active(c) && c.id === 35) ? 3 : 0);
    if (cap > 0 && CARDS[c.id].cost > cap) return false;
    energy -= CARDS[c.id].cost; if (energy < 0) return false;
    hand = hand.filter(t => t !== c); counts[m.zone]++; added[m.zone]++;
  }
  return true;
}
export function resolve(s: State, plans: [Plan, Plan], rng: RNG, onStep?: ReplayStep): State {
  for (let side = 0; side < 2; side++) if (!legal(s, side, plans[side])) throw Error('非法出牌方案');
  if (s.deckMode !== 'independent' && plans.every(p => p.pick >= 0)
    && s.offers[0][plans[0].pick] === s.offers[1][plans[1].pick]) throw Error('双方不能取得同一张共享牌');
  const n = clone(s), order: string[][] = [[], []];
  // Reserve both sides' spaces before reveal. New hands are not added to energy.
  for (let side = 0; side < 2; side++) {
    if(n.offers[side].length&&n.hands[side].length<5)n.publicCounts[side]++;
    n.hands[side] = pickHand(n, side, plans[side].pick);
    n.seen??=[[],[]];
    n.seen[side] = [...new Set([...n.seen[side], ...n.hands[side].map(c => c.id)])];
    for (const m of plans[side].moves) {
      const c = n.hands[side].find(c => c.uid === m.uid)!;
      n.hands[side] = n.hands[side].filter(t => t !== c);
      n.publicCounts[side]--;
      c.uid = 'sim:' + n.nextUid++; c.face = false; c.power = 0;
      n.zones[m.zone].cards[side].push(c); order[side].push(c.uid);
    }
    for (const c of n.hands[side]) if (c.uid === 'pick:' + side) c.uid = 'sim:' + n.nextUid++;
  }
  n.offers = [[], []];
  for (const z of n.zones) z.ban = [-1, -1];
  onStep?.(clone(n), '双方出牌已锁定');
  for (const side of [n.priority, 1 - n.priority]) for (const uid of order[side]) {
    const f = locate(n, uid); if (!f) continue;
    const before=onStep?clone(n):undefined;
    f.c.face = true;
    n.revealed??=[[],[]];n.revealed[side].push(f.c.id);
    refresh(n);
    onStep?.(clone(n), `${side === 0 ? '你' : 'AI'}揭示了${CARDS[f.c.id].heroId}`, {kind:'reveal',source:uid,targets:[]});
    if(CARDS[f.c.id].effectType==='持续') emitSkill(onStep,before,n,uid);
    if (f.z.id === 6 && !f.z.first[side]) {
      const fieldBefore=onStep?clone(n):undefined;
      f.c.base += 5; f.z.first[side] = true;refresh(n);
      emitSkill(onStep,fieldBefore,n,undefined,n.zones.indexOf(f.z));
    }
    if (CARDS[f.c.id].effectType === '揭示') reveal(n, uid, rng, undefined, [], onStep);
  }
  refresh(n); endEffects(n, rng, onStep);
  onStep?.(clone(n), '回合效果结算完成');
  if (n.round < 6) {
    const p = powers(n), zones = [0, 0], total = [0, 0];
    for (const [a, b] of p) {if (a !== b) zones[a > b ? 0 : 1]++; total[0] += a; total[1] += b;}
    n.priority = zones[0] !== zones[1] ? +(zones[1] > zones[0]) : total[0] !== total[1] ? +(total[1] > total[0]) : +(rng.next() < .5);
    n.round++;
    for (let side = 0; side < 2; side++) {n.energy[side] = n.round + n.bonus[side]; n.bonus[side] = 0;}
    dealOffers(n, rng);
    n.zones.forEach((z, i) => {z.open = i < n.round;});
  } else n.round = 7;
  return n;
}
/** Exhaustive legal pick/order/place prefixes (pass included). Never prune by
 * energy alone: expensive cards can be kept for a later round. */
export function plans(s: State, side: number): Plan[] {
  const result: Plan[] = [], picks = s.offers[side].length && s.hands[side].length < 5 ? s.offers[side].map((_, i) => i) : [-1];
  for (const pick of picks) {
    const hand = pickHand(s, side, pick), counts = s.zones.map(z => z.cards[side].length), added = [0, 0, 0];
    const visit = (remaining: Card[], energy: number, moves: Move[]) => {
      result.push({pick, moves: [...moves]});
      for (const c of remaining) if (CARDS[c.id].cost <= energy) for (let zone = 0; zone < 3; zone++) {
        const z = s.zones[zone]; if (!z.open || counts[zone] >= z.limit || z.ban[side] === 0 || z.ban[side] > 0 && added[zone] >= z.ban[side]) continue;
        const cap = z.cap[side] || (visible(z, 1 - side).some(c => active(c) && c.id === 35) ? 3 : 0);
        if (cap && CARDS[c.id].cost > cap) continue;
        counts[zone]++; added[zone]++;
        visit(remaining.filter(t => t !== c), energy - CARDS[c.id].cost, [...moves, {uid: c.uid, zone}]);
        counts[zone]--; added[zone]--;
      }
    };
    visit(hand, s.energy[side], []);
  }
  return result;
}
function hold(c: Card, s: State, side: number) {
  const d = CARDS[c.id], turns = 7 - s.round;
  if (d.cost > s.round + turns) return 0;
  let value = d.power;
  if (c.id === 21) value = 20;
  if ([18, 28, 16, 17].includes(c.id)) value = 12;
  if ([0, 5, 8, 24, 25, 27, 32, 33].includes(c.id)) value += 2 * Math.max(0, turns - 1);
  if (c.id === 18) value += Math.max(...powers(s).map(p => p[side])) * .3;
  return value / (d.cost + 1);
}
export function evaluate(s: State, side: number, sweepGoal = true) {
  const p = powers(s);
  // This is a simultaneous-action prior, never a terminal payoff. Saturating
  // it to +/-100 here made the rollout pass while narrowly leading: it has not
  // seen the other player's committed play yet and still needs a safety margin.
  const horizon = Math.max(0, 7 - s.round);
  const forecast = p.map(v => [...v]);
  // Value future growth on BOTH public boards, including cross-lane support.
  // These are a ranking prior only: every search payoff still runs full rounds.
  if(horizon) for(let owner=0;owner<2;owner++) {
    const mechanic=all(s,owner).filter(c=>active(c)&&c.id===27).length;
    s.zones.forEach((z,i)=>{
      const own=visible(z,owner),mult=2**own.filter(c=>active(c)&&c.id===18).length;
      for(const c of own) {
        if(!active(c))continue;
        if(c.id===5)forecast[i][owner]+=horizon*(1+mechanic)*mult;
        if(c.id===25&&own.filter(active).length>=2)forecast[i][owner]+=horizon*(1+mechanic)*mult;
        if(c.id===24&&p[i][owner]<p[i][1-owner])forecast[i][owner]+=.65*horizon*(2+mechanic)*mult;
        if(c.id===33&&visible(z,1-owner).length)forecast[i][1-owner]-=horizon*2;
        if(c.id===26) {
          const lanes=s.zones.map((lane,j)=>({lane,j})).filter(({lane,j})=>Math.abs(j-i)===1&&visible(lane,owner).length);
          for(const {j} of lanes)forecast[j][owner]+=horizon*(2+mechanic);
        }
        if(z.id===1)forecast[i][owner]+=horizon*mult;
      }
    });
  }
  const diffs = forecast.map(v => v[side] - v[1 - side]).sort((a, b) => b - a);
  let value = diffs.reduce((n, d) => n + 6 * Math.tanh(d / (4 + horizon)), 0);
  if (sweepGoal) {
    // Reinforce the weakest lane and balanced margins. A tied third lane is
    // never treated as success, even when the official match is already won.
    value += 1.6 * Math.max(-25, Math.min(20, diffs[2]))
      + .35 * Math.max(-20, Math.min(20, diffs[1]));
  } else value += 1.1 * Math.max(-20, Math.min(20, diffs[1])) + .18 * Math.max(-25, Math.min(25, diffs[0]));
  if(horizon) {
    value += .4 * s.hands[side].reduce((n, c) => n + hold(c, s, side), 0);
    value += 2.2 * (s.energy[side]-s.energy[1-side]);
    for(const z of s.zones)for(const c of z.cards[side])if(active(c)&&c.id===10)value+=.35*horizon;
  }
  return value;
}
function pass(s: State, side: number): Plan {return {pick: s.offers[side].length && s.hands[side].length < 5 ? 0 : -1, moves: []};}
function rank(s: State, side: number, candidates: Plan[], seed: number, sweepGoal = true) {
  const other = pass(s, 1 - side);
  return candidates.map(plan => {
    const pair: [Plan, Plan] = side === 0 ? [plan, other] : [other, plan];
    return {plan, value: evaluate(resolve(s, pair, new RNG(seed)), side, sweepGoal)};
  }).sort((a, b) => b.value - a.value);
}
/** Bounded, diverse continuation actions. The current decision still enumerates
 * all legal prefixes. Future rollouts must not rebuild tens of thousands of
 * permutations merely to throw almost all away with a stride filter. */
export function rolloutPlans(s: State, side:number, rng:RNG, budget=120):Plan[] {
  if(s.hands[side].length<=3&&s.energy[side]<=4)return plans(s,side);
  const picks=s.offers[side].length&&s.hands[side].length<5?s.offers[side].map((_,i)=>i):[-1];
  const result:Plan[]=[],keys=new Set<string>();
  const add=(p:Plan)=>{const key=p.pick+':'+p.moves.map(m=>m.uid+'@'+m.zone).join(',');if(!keys.has(key)){keys.add(key);result.push(p);}};
  for(const pick of picks) {
    add({pick,moves:[]});
    const hand=pickHand(s,side,pick);
    for(const c of hand)for(let zone=0;zone<3;zone++) {
      const p={pick,moves:[{uid:c.uid,zone}]};if(legal(s,side,p))add(p);
    }
    for(let attempt=0;attempt<Math.ceil(budget/picks.length);attempt++) {
      let p:Plan={pick,moves:[]};
      const available=[...hand];
      while(available.length) {
        const index=Math.floor(rng.next()*available.length),c=available.splice(index,1)[0];
        const lanes=[0,1,2].filter(zone=>legal(s,side,{pick,moves:[...p.moves,{uid:c.uid,zone}]}));
        if(lanes.length)p={pick,moves:[...p.moves,{uid:c.uid,zone:rng.choose(lanes)!}]};
        if(p.moves.length&&rng.next()<.12)break;
      }
      add(p);
    }
  }
  return result;
}
function continuationPrior(s:State,side:number,plan:Plan,sweepGoal:boolean) {
  const p=powers(s).map(v=>[...v]),hand=pickHand(s,side,plan.pick),counts=s.zones.map(z=>visible(z,side).length);
  let held=hand.reduce((n,c)=>n+hold(c,s,side),0),horizon=Math.max(0,6-s.round);
  for(const move of plan.moves) {
    const c=hand.find(c=>c.uid===move.uid)!,d=CARDS[c.id],z=s.zones[move.zone],i=move.zone;
    let gain=d.power;
    if(c.id===2&&!counts[i])gain+=3;
    if(c.id===0)gain+=counts[i]+1;
    if(c.id===3)gain+=2;
    if(c.id===4)gain+=visible(z,1-side).length;
    if(c.id===5)gain+=horizon+1;
    if(c.id===8)gain+=counts[i]+1;
    if(c.id===11&&counts[i])gain+=3;
    if(c.id===18)gain+=p[i][side];
    if(c.id===21)gain+=p[i][1-side];
    if(c.id===24)gain+=1.3*(horizon+1);
    if(c.id===28)gain+=4*(counts[i]+1);
    if(c.id===31)gain+=Math.ceil(d.power/2);
    if(c.id===32)gain+=2*visible(z,1-side).length;
    if(c.id===33&&visible(z,1-side).length)gain+=2*(horizon+1);
    if(z.id===6&&!counts[i])gain+=5;
    if(z.id===8&&d.cost>=4)gain+=4;
    if(z.id===9&&d.cost<=3)gain+=2;
    if(z.id===2&&d.effectType==='持续'||z.id===3&&d.effectType==='揭示')gain+=2;
    counts[i]++;p[i][side]+=gain;held-=hold(c,s,side);
  }
  const diffs=p.map(v=>v[side]-v[1-side]).sort((a,b)=>b-a);
  return diffs.reduce((a,d)=>a+6*Math.tanh(d/(4+horizon)),0)
    +(sweepGoal?1.6*Math.max(-25,Math.min(20,diffs[2]))+.35*Math.max(-20,Math.min(20,diffs[1]))
      :1.1*Math.max(-20,Math.min(20,diffs[1]))+.18*Math.max(-25,Math.min(25,diffs[0])))+.4*held;
}
function continuationBeam(s:State,side:number,candidates:Plan[],width:number,sweepGoal:boolean) {
  if(candidates.length<=width)return candidates;
  const ranked=candidates.map(plan=>({plan,value:continuationPrior(s,side,plan,sweepGoal)})).sort((a,b)=>b.value-a.value);
  return ranked.slice(0,width).map(v=>v.plan);
}
/** Cheap rollout policy. It knows its own cards and the public board only, never
 * the opponent's planned move. Stochastic top choices avoid a single weak bot. */
export function tactical(s: State, side: number, rng: RNG, width = 36, sweepGoal = false): Plan {
  if(s.round===6) width=Math.max(width,120);
  const candidates = rolloutPlans(s,side,rng,Math.max(80,width*2));
  const subset = continuationBeam(s,side,candidates,width,sweepGoal);
  const best = rank(s, side, subset, rng.seed, sweepGoal);
  return best[Math.min(best.length - 1, Math.floor(rng.next() ** 5 * Math.min(5, best.length)))].plan;
}
/** Independent baselines: no search evaluation or rollout policy reuse. */
export function randomPolicy(s: State, side: number, rng: RNG): Plan {
  return rng.choose(plans(s, side))!;
}
export function greedyPolicy(s: State, side: number, rng: RNG): Plan {
  return immediatePolicy(s,side,rng,plans(s,side));
}
function immediatePolicy(s: State, side:number,rng:RNG,candidates:Plan[]):Plan {
  const other = pass(s, 1 - side);
  let best = candidates[0], max = -Infinity;
  for (const plan of candidates) {
    const state = resolve(s, side ? [other, plan] : [plan, other], new RNG(371));
    const p = powers(state), diffs = p.map(p => p[side] - p[1 - side]).sort((a, b) => b - a);
    // Immediate two-lane score; does not value future hand, growth or counters.
    const value = diffs.reduce((n, x) => n + Math.tanh(x / 5), 0) * 12 + diffs[1] * .6 + p.reduce((n, x) => n + x[side], 0) * .1;
    if (value > max || value === max && rng.next() < .5) {max = value; best = plan;}
  }
  return best;
}
export function sampleWorld(o: Observation, rng: RNG, trial=false): State {
  const {hand, choices, side, ...publicState} = o;
  const s: State = {...publicState, hands: [[], []], offers: [[], []]};
  const n = clone(s); n.hands[side] = hand.map(c => ({...c})); n.offers[side] = [...choices];
  if(trial)n.trialSide=1-side;
  // No invented known opponent hand. Vary plausible hand sizes and retention of
  // costly finishers. This is a prior, not a recovered server deck distribution.
  const count = o.opponentCount >= 0 ? o.opponentCount : 2 + Math.floor(rng.next() * 3);
  n.publicCounts[1-side]=count;
  n.seen ??= [[], []];
  for (let i = 0; i < count; i++) {
    const id=weightedCard(rng,unavailable(n,1-side,true),trial,o.round-1,o.round===1?dealCosts(n,true):undefined);
    n.hands[1 - side].push(card(id, 'hidden:' + i));
    n.seen[1 - side].push(id);
  }
  n.offers[1 - side] = count < 5 ? offer(rng,unavailable(n,1-side,true),trial,dealCosts(n)) : [];
  const remaining=FIELDS.map(f=>f.battlefieldId).filter(id=>!n.zones.some(z=>z.id===id));
  for (const z of n.zones) if (!z.id) {
    const index=Math.floor(rng.next()*remaining.length);z.id=remaining.splice(index,1)[0];
  }
  refresh(n); return n;
}
export function interval(win: number, n: number): [number, number] {
  if (!n) return [0, 1]; const p = win / n, z = 1.96, den = 1 + z * z / n;
  const mid = (p + z * z / (2 * n)) / den, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}
export function search(o: Observation, options: {iterations?: number; timeMs?: number; seed?: number; width?: number; opponent?:'mixed'|'official-trial';goal?:'sweep'|'win'} = {}): Advice {
  const begin = performance.now(), rng = new RNG(options.seed ?? 71937);
  const trial=options.opponent==='official-trial';
  const sweepGoal=options.goal!=='win';
  const sample = sampleWorld(o, rng,trial), allPlans = plans(sample, o.side);
  const ranked = rank(sample, o.side, allPlans, 9183,sweepGoal), width = Math.max(4, Math.min(48, options.width ?? 18));
  // Include a candidate for each offered card and each lane footprint. A pure
  // score beam can otherwise discard a winning counter or a held finisher.
  const pool = ranked.slice(0, width);
  for (const r of ranked) {
    const footprint = r.plan.pick + ':' + [...new Set(r.plan.moves.map(m => m.zone))].sort().join(',');
    if (!pool.some(x => x.plan.pick + ':' + [...new Set(x.plan.moves.map(m => m.zone))].sort().join(',') === footprint)) {
      pool.push(r);
    }
    if (pool.length >= width + 12) break;
  }
  const stats = pool.map(r => ({plan: r.plan, n: 0, sweep: 0, officialWin: 0, draw: 0, sum: 0, prior: r.value}));
  const limit = Math.max(stats.length, Math.min(50000, options.iterations ?? 1500)), deadline = begin + Math.max(50, Math.min(30000, options.timeMs ?? 3500));
  let simulations = 0;
  // Successive halving with shared worlds: every surviving action faces exactly
  // the same hidden cards, opponent plan and future RNG for each batch.
  let alive = stats;
  while (simulations < limit && (simulations === 0 || performance.now() < deadline)) {
    const worldSeed = Math.floor(rng.next() * 4294967296), wr = new RNG(worldSeed), world = sampleWorld(o, wr,trial);
    const opponent = wr.next()<.6?immediatePolicy(world,1-o.side,wr,continuationBeam(world,1-o.side,rolloutPlans(world,1-o.side,wr,160),36,false)):tactical(world, 1 - o.side, wr);
    const continuationSeed = wr.seed;
    for (const st of alive) {
      const cr = new RNG(continuationSeed);
      let game = resolve(world, o.side === 0 ? [st.plan, opponent] : [opponent, st.plan], cr);
      while (game.round <= 6) {
        const a = tactical(game, 0, cr, 18, sweepGoal&&o.side === 0), b = tactical(game, 1, cr, 18, sweepGoal&&o.side === 1);
        game = resolve(game, [a, b], cr);
      }
      const w = winner(game), success = +sweep(game, o.side);
      st.n++; st.sweep += success; st.officialWin += +(w === o.side); st.draw += +(w < 0);
      // PvE keeps the sweep objective; PvP values ordinary wins and lane points.
      st.sum += (sweepGoal?success+.02*+(w===o.side):+(w===o.side)+.1*zoneWins(game,o.side)/3)
        + .003 * zoneWins(game,o.side)/3 + .001 * Math.tanh(evaluate(game,o.side,sweepGoal)/40);
      simulations++;
    }
    if (alive[0].n % 16 === 0 && alive.length > 6) alive = [...alive].sort((a, b) => b.sum / b.n - a.sum / a.n || b.prior - a.prior).slice(0, Math.ceil(alive.length / 2));
  }
  const result = stats.map(st => ({plan: st.plan, score: st.n ? st.sum / st.n : 0, sweep: st.n ? st.sweep / st.n : 0,
    officialWin: st.n ? st.officialWin / st.n : 0, draw: st.n ? st.draw / st.n : 0, n: st.n, interval: interval(st.sweep, st.n)}));
  const survivors = new Set(alive.map(s => s.plan));
  result.sort((a, b) => +survivors.has(b.plan) - +survivors.has(a.plan) || b.score - a.score || b.n - a.n);
  return {plan: result[0].plan, candidates: result.slice(0, 6), simulations, candidatesCount: allPlans.length,
    elapsedMs: performance.now() - begin, warnings: [...o.warnings], model: MODEL_VERSION};
}
/** Adapter of the visible Snap state. Never consume an opponent hand/draft.
 * Recover persistent base buffs from authoritative currentPower, not a guessed
 * historical replay. Power residuals and unknown effects are shown explicitly. */
function receiptModifiers(raw: any, turns: any[]) {
  const result = new Map<string,{baseFactor:number;finalFactor:number;muted:boolean}>();
  const n = Number(raw?.round?.round);
  const history = turns.slice(-Math.max(0,n-1));
  // UIDs restart each match. Never borrow effects from a previous game, a
  // partial history or a receipt that doesn't advance to this current round.
  if(n<=1 || history.length!==n-1 || history.some((t,i)=>t.before?.round?.round!==i+1)
    || history.at(-1)?.reply?.nextRound?.round!==n) return result;
  const mod = (uid: any) => {const key=String(uid);if(!result.has(key))result.set(key,{baseFactor:1,finalFactor:1,muted:false});return result.get(key)!;};
  for(const t of history) {
    const events=t.reply?.events||[];
    const locations=new Map<string,{owner:number;zone:number;id:number;face:boolean}>();
    for(const z of t.before.zones||[])for(const owner of [1,2])for(const c of (owner===1?z.sideA:z.sideB)?.cards||[]) {
      const id=defs.get(c.heroId);if(id!==undefined)locations.set(String(c.uid),{owner,zone:z.zoneIndex,id,face:true});
    }
    // Both sides reserve hidden cards before the first reveal. Shanji also
    // removes an unrevealed ongoing card's effect in that committed batch.
    for(const e of events)if(e.type===2&&defs.has(e.heroId))locations.set(String(e.cardUid),{owner:e.owner,zone:e.zoneIndex,id:defs.get(e.heroId)!,face:false});
    for(const e of events) {
      const c=locations.get(String(e.cardUid));
      if(e.type===2&&c)c.face=true;
      if(e.type===6&&c)c.zone=e.zoneIndex;
      if(e.type===7)locations.delete(String(e.cardUid));
      if(e.type!==4)continue;
      const enemies=[...locations.entries()].filter(([,v])=>v.owner!==e.owner&&v.zone===e.zoneIndex);
      if(enemies.some(([uid,v])=>v.face&&v.id===10&&!mod(uid).muted))continue;
      if(e.heroId==='典狱长赛斯')mod(e.cardUid).baseFactor*=1.5;
      if(e.heroId==='小丑')for(const p of e.powerChanges||[])if(p.deltaPower<0)mod(p.cardUid).finalFactor*=.5;
      if(e.heroId==='成龙'&&[...locations.values()].some(v=>v.face&&v.owner===e.owner&&v.zone===e.zoneIndex&&v.id===17))
        for(const p of e.powerChanges||[])if(p.deltaPower<0&&enemies.some(([uid])=>uid===String(p.cardUid)))mod(p.cardUid).finalFactor*=.5;
      if(e.heroId==='山鸡哥')for(const [uid,v]of enemies)if(CARDS[v.id].effectType==='持续')mod(uid).muted=true;
    }
  }
  return result;
}
export function fromServer(raw: any): Observation {
  const turns=raw?.turns||[];
  if (raw?.state) raw = raw.state;
  const modifiers=receiptModifiers(raw,turns);
  const side = raw.mySide === 2 ? 1 : 0, warnings: string[] = [];
  const convert = (v: any) => {const id = defs.get(v.heroId); if (id === undefined) throw Error('模型未覆盖卡牌：' + v.heroId); return {...card(id, String(v.uid)),...modifiers.get(String(v.uid))};};
  const zones: Zone[] = [...(raw.zones || [])].sort((a, b) => a.zoneIndex - b.zoneIndex).map((z: any) => ({
    id: Number(z.battlefieldId), cards: [(z.sideA?.cards || []).map(convert), (z.sideB?.cards || []).map(convert)],
    limit: Number(z.cardLimit || 4), open: !!z.unlocked, ban: [z.placeLimitA?.limit ?? -1, z.placeLimitB?.limit ?? -1],
    cap: [z.placeLimitA?.costCap || 0, z.placeLimitB?.costCap || 0], mute: [!!z.silencedSideA, !!z.silencedSideB],
    first: [!!z.sideA?.cards?.length, !!z.sideB?.cards?.length]}));
  if (zones.length !== 3 || zones.some(z => z.id && !FIELDS.some(f => f.battlefieldId === z.id))) throw Error('战场配置不匹配，需更新模型');
  const s: State = {deckMode:'shared', dealProfile:ROUND_DEAL_PROFILE, round: Number(raw.round?.round), energy: [Number(raw.round?.round), Number(raw.round?.round)],
    priority: raw.round?.priority === 2 ? 1 : 0, zones, hands: [[], []], offers: [[], []], bonus: [0, 0], nextUid: 100000,
    publicCounts:[-1,-1],opponentCount: -1, warnings};
  s.energy[side] = Number(raw.round?.energy);
  if (!Number.isInteger(s.round) || s.round < 1 || s.round > 6 || !Number.isInteger(s.energy[side]) || s.energy[side] < 0) throw Error('没有可分析的当前回合');
  s.hands[side] = (raw.hand || []).map(convert); s.offers[side] = (raw.round?.choices || []).map((name: string) => {
    const id = defs.get(name); if (id === undefined) throw Error('未知候选卡牌：' + name); return id;
  });
  s.seen=[[],[]];s.revealed=[[],[]];
  for(const owner of [0,1])s.revealed[owner]=all(s,owner).map(c=>c.id);
  const history=turns.slice(-(s.round-1));
  const fullHistory=s.round>1&&history.length===s.round-1&&history.every((t:any,i:number)=>t.before?.round?.round===i+1)
    &&history.at(-1)?.reply?.nextRound?.round===s.round;
  let enemyCount=3;
  if(fullHistory)for(const t of history) {
    if(enemyCount<5)enemyCount++;
    const events=t.reply?.events||[];
    enemyCount-=events.filter((e:any)=>e.type===2&&e.owner===2-side).length;
    enemyCount+=events.filter((e:any)=>e.type===8&&e.owner===2-side).length;
    enemyCount=Math.min(5,Math.max(0,enemyCount));
    for(const e of events)if(e.type===2&&defs.has(e.heroId))s.revealed[e.owner-1].push(defs.get(e.heroId)!);
  }
  for(const owner of [0,1])s.seen[owner]=[...new Set([...s.revealed[owner],...s.hands[owner].map(c=>c.id)])];
  if (fullHistory) {
    // Own historical hands are known even when their cards were later removed.
    // Enemy draw identities and hidden drafts remain deliberately unread.
    for (const t of history) for (const c of [...(t.before?.hand || []), ...(t.reply?.hand || [])]) {
      const id = defs.get(c.heroId); if (id !== undefined) s.seen[side].push(id);
    }
    s.seen[side] = [...new Set(s.seen[side])];
  }
  s.publicCounts[side]=s.hands[side].length;
  if(s.round===1||fullHistory)s.publicCounts[1-side]=enemyCount;
  if(fullHistory)for(const e of history.at(-1).reply?.events||[])if(e.type===4&&e.owner===2-side)
    s.energy[1-side]+=e.heroId==='乔帮主'?2:e.heroId==='棒球手'?1:0;
  refresh(s);
  raw.zones.forEach((z: any) => {
    const zone = s.zones[z.zoneIndex - 1];
    for (let owner = 0; owner < 2; owner++) {
      const input = owner ? z.sideB : z.sideA;
      const mult = 2 ** zone.cards[owner].filter(c => active(c) && c.id === 18).length;
      for (const v of input?.cards || []) {
        const c = zone.cards[owner].find(c => c.uid === String(v.uid))!;
        c.base += (Number(v.currentPower) - c.power) / (mult*(c.baseFactor??1)*(c.finalFactor??1));
      }
    }
  });
  refresh(s);
  // A clamped zero can hide a negative aura offset. One subtraction from an
  // already-clamped prediction cannot recover the authoritative card power.
  // Reconcile independently a second time; all aura membership stays fixed.
  for(let attempt=0;attempt<3;attempt++) {
    let changed=false;
    for(const z of raw.zones)for(let owner=0;owner<2;owner++) {
      const zone=s.zones[z.zoneIndex-1],input=owner?z.sideB:z.sideA;
      const mult=2**zone.cards[owner].filter(c=>active(c)&&c.id===18).length;
      for(const v of input?.cards||[]) {
        const c=zone.cards[owner].find(c=>c.uid===String(v.uid))!;
        const difference=Number(v.currentPower)-c.power;
        if(difference){c.base+=difference/(mult*(c.baseFactor??1)*(c.finalFactor??1));changed=true;}
      }
    }
    if(!changed)break;
    refresh(s);
  }
  for (const z of raw.zones) for (let owner = 0; owner < 2; owner++) {
    const input = owner ? z.sideB : z.sideA, zone = s.zones[z.zoneIndex - 1];
    if (input && zone.cards[owner].reduce((n, c) => n + c.power, 0) !== Number(input.power)) warnings.push('战场总战力与单卡战力不一致，结果仅供参考');
  }
  if (raw.draft?.length) warnings.push('存在未结束的手工草稿，自动试玩暂停');
  return {...observe(s, side), warnings};
}
export function wirePlan(o: Observation, plan: Plan) {
  const picked = plan.pick >= 0 ? String(plan.pick + 1) : '';
  const rows = plan.moves.map(m => ({cardUid: m.uid === 'pick:' + o.side ? picked : m.uid, zoneIndex: m.zone + 1}));
  if (picked && !plan.moves.some(m => m.uid === 'pick:' + o.side)) rows.push({cardUid: picked, zoneIndex: 0});
  return rows;
}
