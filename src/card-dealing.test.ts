import {describe, it, expect} from 'vitest';
import {CARDS, ROUND_DEAL_PROFILE, newGame, resolve, observe, card, RNG, legal, search} from './card-engine';
import type {Plan} from './card-engine';

describe('official-observation-based local round dealing', () => {
  it('starts mostly with low costs, without forbidding the rare high-cost cards seen in official receipts', () => {
    const hands = Array(7).fill(0), offers = Array(7).fill(0);
    for (let seed = 1; seed <= 2000; seed++) {
      const s = newGame(Math.imul(seed, 2654435761), ROUND_DEAL_PROFILE);
      for (const c of s.hands.flat()) hands[CARDS[c.id].cost]++;
      for (const id of s.offers.flat()) offers[CARDS[id].cost]++;
      for (let side = 0; side < 2; side++) {
        expect(new Set(s.hands[side].map(c => c.id)).size).toBe(3);
        expect(new Set(s.offers[side]).size).toBe(3);
        expect(s.offers[side].some(id => s.hands[side].some(c => c.id === id))).toBe(false);
      }
    }
    expect((hands[1] + hands[2]) / 12000).toBeGreaterThan(.8);
    // Shared initial hands and the other player's reserved candidates deplete
    // scarce low costs; the old independent-deck 78% bound is not applicable.
    expect((offers[1] + offers[2]) / 12000).toBeGreaterThan(.72);
    expect((hands[5] + hands[6]) / 12000).toBeLessThan(.035);
    expect((offers[5] + offers[6]) / 12000).toBeLessThan(.055);
    expect(hands[5]).toBeGreaterThan(0); expect(offers[6]).toBeGreaterThan(0);
  });
  it('moves the offer peak toward the current round for both sides, while late low costs remain rare rather than banned', () => {
    const means:number[] = [];
    for (let round = 2; round <= 6; round++) {
      const bySide = [Array(7).fill(0), Array(7).fill(0)];
      for (let seed = 1; seed <= 2000; seed++) {
        const s = newGame(Math.imul(seed, 2654435761), ROUND_DEAL_PROFILE);
        s.round = round - 1; s.hands = [[], []]; s.offers = [[], []]; s.seen = [[], []];
        const next = resolve(s, [{pick:-1, moves:[]}, {pick:-1, moves:[]}], new RNG(Math.imul(seed, 7919)));
        for (let side = 0; side < 2; side++) for (const id of next.offers[side]) bySide[side][CARDS[id].cost]++;
      }
      const combined = bySide[0].map((v, cost) => v + bySide[1][cost]);
      const mean = combined.reduce((n, count, cost) => n + count * cost, 0) / 12000;
      if (means.length) expect(mean).toBeGreaterThan(means.at(-1)!);
      means.push(mean);
      for (let cost = 1; cost <= 6; cost++) expect(Math.abs(bySide[0][cost] - bySide[1][cost]) / 6000).toBeLessThan(.05);
      if (round >= 5) {
        expect((combined[5] + combined[6]) / 12000).toBeGreaterThan(.65);
        expect((combined[1] + combined[2]) / 12000).toBeLessThan(.085);
        expect(combined[1] + combined[2]).toBeGreaterThan(0);
      }
    }
  });
  it('keeps previously held low-cost cards, respects the full-hand rule and excludes acquired cards', () => {
    let s = newGame(17, ROUND_DEAL_PROFILE);
    const held = s.hands[0].map(c => ({...c}));
    for (let round = 1; round <= 5; round++) {
      const keep = (side:number):Plan => ({pick:s.offers[side].length ? 0 : -1, moves:[]});
      const plans:[Plan, Plan] = [keep(0), keep(1)];
      s = resolve(s, plans, new RNG(round));
      expect(s.dealProfile).toBe(ROUND_DEAL_PROFILE);
      for (const c of held) expect(s.hands[0].find(h => h.uid === c.uid)).toEqual(c);
      for (let side = 0; side < 2; side++) {
        if (s.hands[side].length === 5) expect(s.offers[side]).toEqual([]);
        expect(s.offers[side].some(id => s.seen![side].includes(id))).toBe(false);
      }
    }
  });
  it('carries the public dealing profile into AI forecasting without exposing the human private hand', () => {
    const s = newGame(44, ROUND_DEAL_PROFILE), before = observe(s, 1);
    expect(before.dealProfile).toBe(ROUND_DEAL_PROFILE);
    s.hands[0] = [card(21, 'private-six-cost')];
    expect(observe(s, 1)).toEqual(before);
    const advice = search(before, {seed:173, timeMs:100, iterations:24, width:8});
    const original = newGame(44, ROUND_DEAL_PROFILE);
    expect(legal(original, 1, advice.plan)).toBe(true);
    expect(newGame(44).deckMode).toBe('shared');
    expect(newGame(44).dealProfile).toBe(ROUND_DEAL_PROFILE);
  });
});
