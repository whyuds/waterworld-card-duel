import {describe, it, expect} from 'vitest';
import {card, CARDS, newGame, plans, resolve, RNG} from './card-engine';
import type {State} from './card-engine';
import {moveDraft, placementError} from './card-duel-actions';

const setup = () => {
  const s = newGame(17, null, 'independent');
  s.round = 4; s.energy[0] = 6; s.offers[0] = [];
  s.zones.forEach(z => {z.open = true; z.id = 1;});
  const cheap = CARDS.findIndex(c => c.cost === 1), expensive = CARDS.findIndex(c => c.cost === 6);
  s.hands[0] = [card(cheap, 'cheap'), card(expensive, 'expensive')];
  return s;
};

describe('local drag and tap draft rules', () => {
  it('moving a pending card keeps order and does not charge its energy twice', () => {
    const s = setup(), draft = [{uid:'expensive', zone:0}];
    expect(placementError(s, -1, draft, 'expensive', 1)).toBe('');
    expect(moveDraft(draft, 'expensive', 1)).toEqual([{uid:'expensive', zone:1}]);
    expect(draft).toEqual([{uid:'expensive', zone:0}]);
    expect(moveDraft([...draft, {uid:'cheap', zone:0}], 'expensive', 2)).toEqual([{uid:'expensive', zone:2}, {uid:'cheap', zone:0}]);
  });
  it('rejects a locked battlefield, full lane and insufficient energy without modifying the draft', () => {
    const s = setup(); s.zones[1].open = false;
    expect(placementError(s, -1, [], 'cheap', 1)).toContain('尚未解锁');
    s.zones[0].cards[0] = Array.from({length:4}, (_, i) => card(0, String(i)));
    expect(placementError(s, -1, [], 'cheap', 0)).toContain('已满');
    s.energy[0] = 1;
    expect(placementError(s, -1, [], 'expensive', 2)).toContain('能量不足');
  });
  it('respects per-round placement caps and public ongoing cost limits', () => {
    const s = setup(); s.zones[0].ban[0] = 1;
    expect(placementError(s, -1, [{uid:'expensive', zone:0}], 'cheap', 0)).toContain('本回合');
    s.zones[1].cards[1] = [card(35, 'enemy-cost-cap')];
    expect(placementError(s, -1, [], 'expensive', 1)).toContain('出牌限制');
    expect(placementError(s, -1, [], 'cheap', 1)).toBe('');
  });
  it('requires the round pick before placing an existing card', () => {
    const s = setup(); s.seen = [[], []]; s.offers[0] = [5, 8, 9];
    expect(placementError(s, -1, [], 'cheap', 0)).toContain('先选择');
    expect(placementError(s, 0, [], 'cheap', 0)).toBe('');
  });
});

describe('reveal replay instrumentation', () => {
  it('preserves the exact six-round outcome and RNG while exposing immutable reveal snapshots', () => {
    for (const seed of [17, 100, 223]) {
      let plain = newGame(seed), replayed = newGame(seed);
      const a = new RNG(seed + 193), b = new RNG(seed + 193);
      for (let round = 1; round <= 6; round++) {
        const candidates = [plans(plain, 0), plans(plain, 1)];
        const chosen = candidates.map(p => p.find(plan => plan.moves.length > 0) || p[0]) as Parameters<typeof resolve>[1];
        const frames:State[] = [], labels:string[] = [];
        plain = resolve(plain, chosen, a);
        replayed = resolve(replayed, chosen, b, (state, label) => {frames.push(state); labels.push(label);});
        expect(replayed).toEqual(plain); expect(a.seed).toBe(b.seed);
        expect(labels[0]).toBe('双方出牌已锁定');
        expect(labels.at(-1)).toBe('回合效果结算完成');
        const revealLabels = labels.filter(s => s.includes('揭示了'));
        const firstSide = chosen[frames[0].priority].moves.length ? frames[0].priority : 1 - frames[0].priority;
        if (revealLabels.length) expect(revealLabels[0].startsWith(firstSide === 0 ? '你' : 'AI')).toBe(true);
        expect(frames[0].zones.some(z => z.cards.flat().some(c => !c.face))).toBe(chosen.some(p => p.moves.length > 0));
        const original = structuredClone(replayed);
        frames[0].zones[0].cards[0].push(card(0, 'mutated-frame'));
        expect(replayed).toEqual(original);
      }
    }
  });
});
