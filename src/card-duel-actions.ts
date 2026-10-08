import {CARDS, legal} from './card-engine';
import type {State, Plan} from './card-engine';

/** Replan from the current draft; moving a pending card keeps its reveal order. */
export function moveDraft(moves: Plan['moves'], uid: string, zone: number) {
  return moves.some(m => m.uid === uid)
    ? moves.map(m => m.uid === uid ? {...m, zone} : m)
    : [...moves, {uid, zone}];
}

export function placementError(s: State, pick: number, moves: Plan['moves'], uid: string, zone: number) {
  if (s.round > 6) return '本局已经结束';
  if (s.offers[0].length && s.hands[0].length < 5 && pick < 0) return '请先选择本回合的新牌';
  const id = uid === 'pick:0' ? s.offers[0][pick] : s.hands[0].find(c => c.uid === uid)?.id;
  if (id === undefined) return '这张牌已经不在手牌中';
  const z = s.zones[zone], others = moves.filter(m => m.uid !== uid);
  if (!z || !z.open) return '这个战场尚未解锁';
  const inZone = others.filter(m => m.zone === zone).length;
  if (z.cards[0].length + inZone >= z.limit) return '这个战场的四个卡位已满';
  if (z.ban[0] === 0 || z.ban[0] > 0 && inZone >= z.ban[0]) return '这个战场本回合不能继续出牌';
  const spent = others.reduce((n, m) => {
    const cardId = m.uid === 'pick:0' ? s.offers[0][pick] : s.hands[0].find(c => c.uid === m.uid)?.id;
    return n + (cardId === undefined ? 0 : CARDS[cardId].cost);
  }, 0);
  if (spent + CARDS[id].cost > s.energy[0]) return '剩余能量不足，可留到后续回合';
  // Includes public ongoing effects and the current battlefield's cost cap.
  if (!legal(s, 0, {pick, moves: moveDraft(moves, uid, zone)})) return '这张牌的费用超过此战场的出牌限制';
  return '';
}
