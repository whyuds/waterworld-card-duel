import {search, newGame, observe, resolve, greedyPolicy, RNG, winner, powers, interval, sweep, zoneWins, MODEL_VERSION} from './card-engine';
import type {State, Plan} from './card-engine';
self.onmessage = (e: MessageEvent) => {
  const {id, action, observation, options, seed} = e.data;
  try {
    if (action === 'search') self.postMessage({id, result: search(observation, options)});
    else if (action === 'local') {
      let s = newGame(seed), rng = new RNG(seed + 193), turns: any[] = [];
      while (s.round <= 6) {
        const advice = search(observe(s, 0), options), opponent = greedyPolicy(s, 1, rng);
        const before = s, plans: [Plan, Plan] = [advice.plan, opponent];
        s = resolve(s, plans, rng);
        turns.push({round: before.round, advice, powers: powers(s), moves: advice.plan.moves,
          selected: advice.plan.pick >= 0 ? before.offers[0][advice.plan.pick] : -1});
        self.postMessage({id, progress: {round: before.round, turns, state: s}});
      }
      self.postMessage({id, result: {state: s, turns, winner: winner(s), sweep: sweep(s, 0), zoneWins: zoneWins(s, 0)}});
    } else if (action === 'benchmark') {
      const n = Math.max(10, Math.min(1000, Number(e.data.count) || 100));
      const result = {n: 0, sweeps: 0, wins: 0, losses: 0, draws: 0, model: MODEL_VERSION, opponent: '独立面板贪心策略', interval: [0, 1]};
      for (let i = 0; i < n; i++) {
        let s: State = newGame(seed + i * 7919), rng = new RNG(seed + i * 11003 + 11);
        const side = i % 2;
        while (s.round <= 6) {
          const ai = search(observe(s, side), options), other = greedyPolicy(s, 1 - side, rng);
          s = resolve(s, side ? [other, ai.plan] : [ai.plan, other], rng);
        }
        const w = winner(s); result.n++;
        if (w < 0) result.draws++; else if (w === side) result.wins++; else result.losses++;
        result.sweeps += +sweep(s, side);
        result.interval = interval(result.sweeps, result.n);
        self.postMessage({id, progress: {...result}});
      }
      self.postMessage({id, result});
    } else throw Error('未知本地计算');
  } catch (error) {self.postMessage({id, error: error instanceof Error ? error.message : String(error)});}
};
