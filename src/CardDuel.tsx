import {useEffect, useRef, useState} from 'react';
import type {PointerEvent, ReactNode} from 'react';
import {CARDS, FIELDS, MODEL_VERSION, ROUND_DEAL_PROFILE, RNG, card, newGame, observe, resolve, powers, winner, sweep, zoneWins} from './card-engine';
import type {State, Plan, Advice, Card} from './card-engine';
import {moveDraft, placementError} from './card-duel-actions';
import {DuelCard as PlayingCard} from './DuelCard';
import {DuelEffects} from './DuelEffects';
import {duelSprite, duelPortrait} from './duel-art';
import type {ReplayCue} from './card-replay';

const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const scoreKey = `snap-duel-scores-${MODEL_VERSION}-${ROUND_DEAL_PROFILE}`;
const laneNames = ['左', '中', '右'];
type RecordTurn = {round:number; human:Plan; ai:Plan; powers:number[][]; simulations:number; ms:number; effects:string[]};
type Detail = {card:Card; pending?:boolean} | {zone:number};

function DuelDialog({title, children, onClose, inspect}:{title:string; children:ReactNode; onClose?:()=>void; inspect?:ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  const dragOrigin = useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const [position, setPosition] = useState<{left:number;top:number}|null>(null), [showRules, setShowRules] = useState(false);
  const fit = (left:number, top:number) => {
    const bounds = ref.current!.getBoundingClientRect();
    return {left:Math.max(8, Math.min(innerWidth - bounds.width - 8, left)), top:Math.max(8, Math.min(innerHeight - bounds.height - 8, top))};
  };
  useEffect(() => {
    const d = ref.current!; d.showModal();
    d.querySelector<HTMLButtonElement>('.duel-offers button')?.focus();
    return () => d.close();
  }, []);
  useEffect(() => {
    if (!inspect) return;
    const resize = () => setPosition(p => p ? fit(p.left, p.top) : p);
    const observer = new ResizeObserver(resize); observer.observe(ref.current!);
    window.addEventListener('resize', resize);
    return () => {observer.disconnect(); window.removeEventListener('resize', resize);};
  }, [!!inspect]);
  const begin = (e:PointerEvent<HTMLElement>) => {
    if (!inspect || e.button !== 0) return;
    const button = (e.target as HTMLElement).closest('button');
    if (button) return;
    const rect = ref.current!.getBoundingClientRect();
    dragOrigin.current = {x:e.clientX, y:e.clientY, left:rect.left, top:rect.top};
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e:PointerEvent<HTMLElement>) => {
    const from = dragOrigin.current;
    if (from) setPosition(fit(from.left + e.clientX - from.x, from.top + e.clientY - from.y));
  };
  return <dialog className={'duel-dialog ' + (inspect ? 'duel-draft-dialog' : '')} ref={ref} aria-label={title}
    style={position ? {position:'fixed', margin:0, left:position.left, top:position.top, right:'auto', bottom:'auto'} : undefined}
    onCancel={e => {e.preventDefault(); onClose?.();}}>
    <header onPointerDown={begin} onPointerMove={move} onPointerUp={() => {dragOrigin.current = null;}} onPointerCancel={() => {dragOrigin.current = null;}}>
      <h2 tabIndex={inspect ? 0 : undefined} title={inspect ? '按住标题移动窗口；方向键微调' : undefined} onKeyDown={e => {
          if (!inspect) return;
          const delta:Record<string,number[]> = {ArrowLeft:[-20,0], ArrowRight:[20,0], ArrowUp:[0,-20], ArrowDown:[0,20]};
          if (!delta[e.key]) return; e.preventDefault();
          const box = ref.current!.getBoundingClientRect();setPosition(fit(box.left + delta[e.key][0], box.top + delta[e.key][1]));
        }}>{title}</h2><div className="duel-dialog-tools">{inspect && <>
        <button aria-expanded={showRules} onClick={() => setShowRules(!showRules)}>{showRules ? '收起战场' : '查看战场'}</button>
      </>}{onClose && <button aria-label="关闭详情" onClick={onClose}>×</button>}</div>
    </header>{showRules && <div className="duel-rules-peek" role="region" aria-label="三个战场完整规则">{inspect}</div>}{children}
  </dialog>;
}

export function CardDuel({initialSeed}:{initialSeed?:number} = {}) {
  const [seed, setSeed] = useState(() => initialSeed ?? freshSeed()), [game, setGame] = useState<State>(() => newGame(seed, ROUND_DEAL_PROFILE));
  const [pick, setPick] = useState(-1), [moves, setMoves] = useState<Plan['moves']>([]), [selected, setSelected] = useState('');
  const [ackRound, setAckRound] = useState(0), [detail, setDetail] = useState<Detail|null>(null), [confirmNew, setConfirmNew] = useState(false);
  const [advice, setAdvice] = useState<Advice|null>(null), [thinking, setThinking] = useState(false), [thinkingMs, setThinkingMs] = useState(0), [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false), [replay, setReplay] = useState<{state:State; label:string; cue?:ReplayCue; tick:number}|null>(null);
  const [depth, setDepth] = useState(15000), [log, setLog] = useState<RecordTurn[]>([]), [catalog, setCatalog] = useState(false);
  const [drag, setDrag] = useState<{uid:string; x:number; y:number; over:number|null}|null>(null);
  const pointer = useRef<{uid:string; x:number; y:number; moved:boolean}|null>(null), draggedAt = useRef(0);
  const worker = useRef<Worker|null>(null), rng = useRef(new RNG(seed + 193)), timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const board=useRef<HTMLDivElement>(null);
  const committing = useRef(false), endButton = useRef<HTMLButtonElement>(null), wasDrafting = useRef(false);
  const [scores, setScores] = useState(() => {
    try {return JSON.parse(localStorage.getItem(scoreKey) || 'null') || {games:0, human:0, ai:0, draws:0, aiSweeps:0};}
    catch {return {games:0, human:0, ai:0, draws:0, aiSweeps:0};}
  });

  // AI sees only its round-start observation, never the human draft.
  useEffect(() => {
    setAdvice(null); setError('');
    if (game.round > 6) return;
    const w = new Worker(new URL('./card-worker.ts', import.meta.url), {type:'module'});
    worker.current = w; setThinking(true); setThinkingMs(0);
    const started = performance.now();
    const clock = setInterval(() => {if (worker.current === w) setThinkingMs(performance.now() - started);}, 200);
    w.onmessage = e => {
      if (worker.current !== w) return;
      clearInterval(clock);
      setThinking(false);
      if (e.data.error) {setError(e.data.error); setSubmitted(false);} else setAdvice(e.data.result);
      w.terminate(); worker.current = null;
    };
    w.onerror = () => {
      if (worker.current !== w) return;
      clearInterval(clock);
      setThinking(false); setSubmitted(false); setError('AI计算失败，请重新开局'); w.terminate(); worker.current = null;
    };
    w.postMessage({action:'search', observation:observe(game, 1), options:{timeMs:depth, iterations:30000, width:depth >= 8000 ? 32 : 24, seed:seed + game.round * 971}});
    return () => {clearInterval(clock); w.terminate(); if (worker.current === w) worker.current = null;};
  }, [game, depth, seed]);
  useEffect(() => () => {if (timer.current) clearTimeout(timer.current);}, []);

  const finished = game.round > 6, locked = submitted || !!replay;
  const thinkingLabel = thinking ? `已思考 ${(thinkingMs / 1000).toFixed(1)} 秒`
    : advice ? `已就绪 · 实算 ${(advice.elapsedMs / 1000).toFixed(1)} 秒 · ${advice.simulations} 次推演` : error ? '计算失败' : '准备中';
  const thinkingPanel = <div className="duel-thinking" aria-label="AI实际思考状态">
    <div><strong>AI · {depth / 1000} 秒档</strong><span>{thinkingLabel}</span></div>
    <progress aria-label="AI思考预算进度" max={depth} value={advice ? depth : Math.min(depth, thinkingMs)}/>
    <small>AI 与你同时思考，准备好后直接出牌。</small>
  </div>;
  const offerAllowed = game.offers[0].length > 0 && game.hands[0].length < 5;
  const drafting = !finished && !locked && ackRound !== game.round;
  const picked = pick >= 0 && offerAllowed ? card(game.offers[0][pick], 'pick:0') : null;
  const hand = [...game.hands[0], ...(picked ? [picked] : [])], available = replay ? replay.state.hands[0] : hand.filter(c => !moves.some(m => m.uid === c.uid));
  const energy = game.energy[0] - moves.reduce((n, m) => n + CARDS[hand.find(c => c.uid === m.uid)!.id].cost, 0);
  const view = replay?.state || game, p = powers(view), activeUid = drag?.uid || selected, activeCard = hand.find(c => c.uid === activeUid);
  const canPlace = (zone:number, uid = activeUid) => !!uid && !locked && !drafting && !placementError(game, pick, moves, uid, zone);
  const staged = (zone:number) => moves.filter(m => m.zone === zone).map(m => hand.find(c => c.uid === m.uid)!);
  const choose = (i:number) => {
    if (!drafting || !offerAllowed) return;
    setPick(i); setAckRound(game.round); setSelected(''); setError('');
  };
  useEffect(() => {
    if (wasDrafting.current && !drafting && !locked) endButton.current?.focus();
    wasDrafting.current = drafting;
  }, [drafting, locked]);
  const place = (zone:number, uid = activeUid) => {
    if (!uid || locked || drafting) return;
    const message = placementError(game, pick, moves, uid, zone);
    if (message) {setError(message); return;}
    setMoves(moveDraft(moves, uid, zone)); setSelected(''); setError('');
  };
  const withdraw = (uid:string) => {
    if (locked || drafting) return;
    setMoves(moves.filter(m => m.uid !== uid)); setSelected(''); setError('');
  };

  // Pointer capture works on mouse and touch; dropping outside preserves the draft.
  const startDrag = (e:PointerEvent<HTMLButtonElement>, uid:string) => {
    if (locked || drafting || e.button !== 0) return;
    pointer.current = {uid, x:e.clientX, y:e.clientY, moved:false}; e.currentTarget.setPointerCapture(e.pointerId);
  };
  const updateDrag = (e:PointerEvent<HTMLButtonElement>) => {
    const pt = pointer.current; if (!pt) return;
    if (Math.hypot(e.clientX - pt.x, e.clientY - pt.y) < 6 && !pt.moved) return;
    pt.moved = true;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop-zone]');
    setDrag({uid:pt.uid, x:e.clientX, y:e.clientY, over:target ? Number(target.dataset.dropZone) : null});
  };
  const finishDrag = (e:PointerEvent<HTMLButtonElement>) => {
    const pt = pointer.current; pointer.current = null; setDrag(null);
    if (!pt?.moved) return;
    draggedAt.current = Date.now();
    const target = document.elementFromPoint(e.clientX, e.clientY), lane = target?.closest<HTMLElement>('[data-drop-zone]');
    if (lane) place(Number(lane.dataset.dropZone), pt.uid);
    else if (target?.closest('[data-hand]')) withdraw(pt.uid);
  };
  const pointerProps = (uid:string) => ({
    onPointerDown:(e:PointerEvent<HTMLButtonElement>) => startDrag(e, uid), onPointerMove:updateDrag, onPointerUp:finishDrag,
    onPointerCancel:() => {pointer.current = null; setDrag(null);},
  });
  const select = (c:Card) => {
    if (locked || drafting || Date.now() - draggedAt.current < 250) return;
    setSelected(selected === c.uid ? '' : c.uid); setError('');
  };

  const settle = () => {
    if (!advice || committing.current || finished) return;
    committing.current = true;
    const human = {pick, moves}, frames:{state:State; label:string; cue?:ReplayCue; tick:number}[] = [];
    const next = resolve(game, [human, advice.plan], rng.current, (state, label, cue) => frames.push({state, label, cue, tick:frames.length}));
    setDetail(null); setSelected(''); setDrag(null);
    let index = 0;
    const showNext = () => {
      if (index < frames.length) {setReplay(frames[index++]); timer.current = setTimeout(showNext, frames[index-1].cue?.kind==='reveal'?600:frames[index-1].cue?1200:500); return;}
      setLog(v => [...v, {round:game.round, human, ai:advice.plan, powers:powers(next), simulations:advice.simulations, ms:advice.elapsedMs, effects:frames.filter(f=>f.cue).map(f=>f.label)}]);
      if (next.round > 6) {
        const w = winner(next), total = {...scores, games:scores.games + 1, human:scores.human + +(w === 0),
          ai:scores.ai + +(w === 1), draws:scores.draws + +(w < 0), aiSweeps:scores.aiSweeps + +sweep(next, 1)};
        setScores(total); try {localStorage.setItem(scoreKey, JSON.stringify(total));} catch {/* Optional browser storage. */}
      }
      setReplay(null); setSubmitted(false); setPick(-1); setMoves([]); setGame(next); committing.current = false;
    };
    showNext();
  };
  useEffect(() => {if (submitted && advice && !confirmNew && !committing.current) settle();}, [submitted, advice, confirmNew]);
  const restart = (same = false) => {
    if (timer.current) clearTimeout(timer.current);
    worker.current?.terminate(); committing.current = false;
    const v = same ? seed : freshSeed(); rng.current = new RNG(v + 193);
    setConfirmNew(false); setDetail(null); setReplay(null); setSubmitted(false); setSeed(v); setLog([]);
    setPick(-1); setAckRound(0); setMoves([]); setSelected(''); setDrag(null); pointer.current = null; setGame(newGame(v, ROUND_DEAL_PROFILE));
  };
  const exportReplay = () => {
    const blob = new Blob([JSON.stringify({model:MODEL_VERSION, dealProfile:game.dealProfile, seed, depth, goal:'three-zone-sweep', turns:log, final:game}, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `水世界牌-本地对局-${seed}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const instruction = replay?.label || (submitted ? '你已结束回合，等待 AI 出牌…' : error || (activeCard
    ? `${CARDS[activeCard.id].heroId} · ${CARDS[activeCard.id].effectDesc}`
    : drafting ? '请选择本回合的新牌'
      : !available.some(c => game.zones.some((_, i) => canPlace(i, c.uid))) ? '本回合没有可出的手牌，可以结束回合；留牌不消耗能量。'
      : '拖动手牌到战场，或点选手牌再点击空位'));

  return <main className="duel-page snap-game" style={{'--duel-bg':`url(${duelSprite('card_bg_01')})`,'--duel-button':`url(${duelSprite('card_btn_01')})`,'--duel-green':`url(${duelSprite('card_btn_02')})`} as React.CSSProperties}>
    <header className="duel-topbar"><img className="duel-avatar" src={duelPortrait('戴安娜')} alt="戴安娜" width={26} height={26}/><h1>水世界牌 · 挑战 AI</h1><span>36张牌 · 9种战场</span>
      <button disabled={!!replay} onClick={() => finished ? restart() : setConfirmNew(true)}>新对局</button></header>
    <section className="duel-hud"><div><small>回合</small><b>{finished ? '终局' : `${game.round} / 6`}</b></div>
      <div><small>能量</small><b><img src={duelSprite('card_icon_01')} alt=""/> {finished ? 0 : energy} / {finished ? 0 : game.energy[0]}</b></div>
      <div><small>先手</small><b>{game.priority === 0 ? '你' : 'AI'}</b></div>
      <div className="duel-ai-state"><small>AI</small><b>{finished ? '已结束' : replay ? '揭示中' : thinking ? '思考中…' : '已就绪'}</b></div></section>
    {!finished && !replay && !drafting && thinkingPanel}
    {finished && <section className="duel-result" role="status"><h2>{winner(game) === 0 ? '你赢了！' : winner(game) === 1 ? 'AI 赢下了这一局' : '本局平局'}</h2>
      <p>你拿下 {zoneWins(game, 0)} 处战场，AI 拿下 {zoneWins(game, 1)} 处。{sweep(game, 1) ? 'AI 三战场全胜，本局达到目标。' : 'AI 未达到三战场全胜目标。'}</p>
      <button className="primary" onClick={() => restart()}>再战一局</button><button onClick={() => restart(true)}>同一开局再挑战</button><button onClick={exportReplay}>保存本局复盘</button></section>}
    <div className="duel-label"><strong>对手战场</strong><span>对手手牌与本回合安排保持隐藏</span></div>
    <div className="duel-battle-table" ref={board}><div className="snap-board">{view.zones.map((z, i) => {
      const f = FIELDS.find(f => f.battlefieldId === z.id), ghosts = replay ? [] : staged(i), allowed = canPlace(i);
      const renderBoardCard = (c:Card) => c.face
        ? <button data-card-uid={c.uid} className={'duel-board-card '+(replay?.cue?.source===c.uid?'duel-skill-source ':'')+(replay?.cue?.kind==='reveal'&&replay.cue.source===c.uid?'duel-flipping':'')} key={c.uid} disabled={locked} onClick={() => setDetail({card:c})} aria-label={`查看${CARDS[c.id].heroId}`}><PlayingCard c={c} small/></button>
        : <span data-card-uid={c.uid} className="duel-card-back snap-slot" style={{backgroundImage:`url(${duelSprite('card_bg_03')})`}} key={c.uid} aria-label="待揭示卡牌"/>;
      return <section data-drop-zone={i} className={`snap-zone ${!z.open ? 'snap-locked' : ''} ${allowed ? 'duel-can-drop' : ''} ${drag?.over === i ? 'duel-drop-hover' : ''}`} key={i}>
        <div className="snap-lane-cards enemy">{z.cards[1].map(renderBoardCard)}</div>
        <button data-effect-zone={i} className={'snap-field ' + (p[i][0] > p[i][1] ? 'snap-leading' : '') + (replay?.cue?.zone===i?' duel-skill-source':'')} style={{backgroundImage:`url(${duelSprite('bg_card')})`}} onClick={() => activeUid && !locked ? place(i) : setDetail({zone:i})}
          disabled={locked} aria-label={`${laneNames[i]}战场：${f?.battlefieldName}，查看规则或放置卡牌`} title={f?.effectDesc}>
          <div className="duel-field-powers"><span className="enemy-power" style={{backgroundImage:`url(${duelSprite('card_icon_03')})`}}><em>AI</em><b>{p[i][1]}</b></span><span className="own-power" style={{backgroundImage:`url(${duelSprite('card_icon_02')})`}}><em>你</em><b>{p[i][0]}</b></span></div><strong>{f?.battlefieldName}</strong><img className="duel-city-art" src={duelSprite(f!.battlefieldRes)} alt=""/>
          <small>{!z.open && `第${i + 1}回合解锁 · `}{f?.effectDesc}</small>
        </button>
        <div className="snap-lane-cards">{z.cards[0].map(renderBoardCard)}{ghosts.map(c => <div className="duel-pending-card" key={c.uid}>
          <button className={`duel-ghost ${selected === c.uid ? 'selected' : ''}`} disabled={locked} {...pointerProps(c.uid)} onClick={() => select(c)} aria-label={`调整${CARDS[c.id].heroId}的出牌位置`}>
            <PlayingCard c={c} small/><span>#{moves.findIndex(m => m.uid === c.uid) + 1} 待揭示</span></button>
          <button className="duel-withdraw" disabled={locked} onClick={() => withdraw(c.uid)} aria-label={`收回${CARDS[c.id].heroId}`}>↩</button>
        </div>)}{Array.from({length:Math.max(0, z.limit - z.cards[0].length - ghosts.length)}, (_, j) => <button className="snap-slot" disabled={locked || !activeUid || drafting}
          onClick={() => place(i)} aria-label={`${laneNames[i]}战场空位`} key={j}>{allowed ? '放置' : ''}</button>)}</div>
        <span className="duel-lane-count">{z.cards[0].length + ghosts.length} / {z.limit} 卡位{z.ban[0]===0?' · 禁止出牌':z.cap[0]>0?` · 限${z.cap[0]}费`:z.mute[0]?' · 技能沉默':''}</span>
      </section>;
    })}</div><DuelEffects board={board} cue={replay?.cue} tick={replay?.tick??-1}/></div>
    {replay?.cue && <div className="duel-skill-banner" key={replay.tick} role="status"><b>{replay.cue.kind==='reveal'?'卡牌揭示':replay.cue.kind==='field'?'战场效果':'技能释放'}</b><span>{replay.label}</span>{replay.cue.draw?.map((n,i)=>n>0?<small key={i}>{i===0?'你':'AI'}抽牌 +{n}</small>:null)}{replay.cue.bonus?.map((n,i)=>n>0?<small key={i}>{i===0?'你':'AI'}下回合能量 +{n}</small>:null)}</div>}
    {!finished && <>
      <section className="duel-hand-area" data-hand><h2>你的手牌 <small>{available.length} 张 · 未出牌可留到下回合</small></h2>
        <div className="snap-hand" data-hand-count={available.length} style={{gridTemplateColumns:`repeat(${Math.max(available.length, 1)}, minmax(0, 100px))`}}>{available.map(c => <div className="duel-hand-card" key={c.uid}>
          <button className={`duel-card-button ${selected === c.uid ? 'selected' : ''} ${CARDS[c.id].cost > energy ? 'duel-unaffordable' : ''}`} disabled={locked || drafting}
            {...pointerProps(c.uid)} onClick={() => select(c)} aria-label={`选择${CARDS[c.id].heroId}，费用${CARDS[c.id].cost}`} aria-pressed={selected === c.uid}>
            <PlayingCard c={c}/>{CARDS[c.id].cost > energy && <b>能量不足</b>}
          </button><button className="duel-card-info" disabled={locked || drafting} aria-label={`查看${CARDS[c.id].heroId}详情`} onClick={() => setDetail({card:c})}>ⓘ</button>
        </div>)}</div>{!available.length && <p>手牌已全部出战，结束回合后揭示。</p>}
      </section>
      <div className={`duel-instruction ${error ? 'duel-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">{instruction}</div>
      {activeCard && !locked && <div className="duel-selection-actions"><button onClick={() => setDetail({card:activeCard, pending:moves.some(m => m.uid === activeUid)})}>卡牌详情</button>
        {moves.some(m => m.uid === activeUid) && <button onClick={() => withdraw(activeUid)}>收回手牌</button>}<button onClick={() => setSelected('')}>取消选择</button></div>}
      <div className="duel-controls duel-turn-actions"><span>{replay ? '双方揭示中…' : submitted ? '已结束 · 等待对手' : `剩余能量 ${energy}`}</span>
        <button disabled={locked || drafting || !moves.length} onClick={() => {setMoves([]); setSelected(''); setError('');}}>全部收回</button>
        <button className="primary" ref={endButton} disabled={locked || drafting || !!error && !advice && !thinking} onClick={() => {setError(''); setSubmitted(true);}}>
          {replay ? '揭示中…' : submitted ? '等待 AI…' : '结束回合'}</button></div>
    </>}
    {drag && activeCard && <div className="duel-drag-preview" style={{left:drag.x, top:drag.y}}><PlayingCard c={activeCard} small/></div>}
    {drafting && <DuelDialog title={`第 ${game.round} 回合 · ${offerAllowed ? '选择一张卡牌' : game.hands[0].length >= 5 ? '手牌已满' : '牌池已空'}`}
      inspect={game.zones.map((z, i) => {const f = FIELDS.find(f => f.battlefieldId === z.id)!;return <section className={'duel-rule-card ' + (z.open ? 'open' : '')} key={i}>
        <strong>{laneNames[i]} · {f.battlefieldName}</strong><small>{z.open ? '已开放' : `第${i + 1}回合解锁`}</small><p>{f.effectDesc}</p>
      </section>;})}>
      {offerAllowed ? <><p>选中的卡牌加入手牌，之后可出战或留牌。</p><div className="duel-offers">{game.offers[0].map((id, i) =>
        <button className="duel-card-button" key={i} onClick={() => choose(i)} aria-label={`选取${CARDS[id].heroId}`}><PlayingCard c={card(id, 'offer' + i)}/><span className="duel-offer-desc">{CARDS[id].effectDesc}</span><b>选择</b></button>)}</div></>
        : <><p>{game.hands[0].length >= 5 ? '已持有5张手牌，本回合不再抽牌。' : '共享牌池没有可选的新牌，已有手牌仍可出战。'}</p><button className="primary" onClick={() => setAckRound(game.round)}>继续本回合</button></>}
      <details className="duel-think-settings"><summary>AI思考时间 · {depth / 1000} 秒</summary><div className="duel-controls">{[1500, 3500, 8000, 15000, 30000].map(t => <button aria-pressed={t === depth} className={t === depth ? 'active' : ''} key={t} onClick={() => setDepth(t)}>{t / 1000}秒思考</button>)}</div></details>
      {thinkingPanel}
    </DuelDialog>}
    {detail && !drafting && <DuelDialog title={'card' in detail ? CARDS[detail.card.id].heroId : FIELDS.find(f => f.battlefieldId === view.zones[detail.zone].id)!.battlefieldName} onClose={() => setDetail(null)}>
      {'card' in detail ? <><PlayingCard c={detail.card}/><p>{CARDS[detail.card.id].effectDesc}</p><p>{CARDS[detail.card.id].effectType || '无特殊效果'} · 费用 {CARDS[detail.card.id].cost} · 当前战力 {detail.card.power}</p>
        {detail.card.muted && <p>技能已被沉默</p>}{detail.pending && <button onClick={() => {withdraw(detail.card.uid); setDetail(null);}}>收回手牌</button>}</>
        : <p>{FIELDS.find(f => f.battlefieldId === view.zones[detail.zone].id)!.effectDesc}{!view.zones[detail.zone].open && `（第${detail.zone + 1}回合解锁）`}</p>}
    </DuelDialog>}
    {confirmNew && !drafting && <DuelDialog title="开始新对局？" onClose={() => setConfirmNew(false)}><p>当前对局将结束，不计入胜负统计。</p>
      <button onClick={() => setConfirmNew(false)}>继续当前对局</button><button className="primary" onClick={() => restart()}>开始新对局</button></DuelDialog>}
    {!!log.length && <details><summary>每回合复盘</summary>{log.map(t => <p key={t.round}>第 {t.round} 回合 · 各战场 你:AI = {t.powers.map(v => v.join(':')).join(' / ')} · AI 推演 {t.simulations} 次，{(t.ms / 1000).toFixed(1)} 秒<br/>{t.effects?.join(' → ')}</p>)}</details>}
    <details className="duel-stats"><summary>对局统计 · 你胜 {scores.human} / AI胜 {scores.ai}</summary><section className="duel-score"><strong>本版发牌规则下的完整对局</strong>
      <p>你胜 {scores.human} · AI 胜 {scores.ai} · 平 {scores.draws}；AI 三战场全胜 {scores.aiSweeps} / {scores.games}{scores.games ? `（${(100 * scores.aiSweeps / scores.games).toFixed(1)}%）` : ''}</p>
      <small>只在完整6回合结束后计数，提前重开不计入已完成对局；旧版本统计保留在本机，不混入本版。人机挑战不能替代官方试玩验收。</small></section></details>
    <details><summary>AI难度、规则与评测边界</summary><div className="duel-controls">{[1500, 3500, 8000, 15000, 30000].map(t => <button disabled={locked} aria-pressed={t === depth} className={t === depth ? 'active' : ''} key={t} onClick={() => setDepth(t)}>{t / 1000}秒思考</button>)}</div>
      <p>这里设置每回合的思考预算；AI在你选牌、摆牌时同时思考。修改后重新计算本回合，实际用时和推演次数显示在上方。较长时间允许更多推演，不保证每局更强，也不会额外等待凑满秒数。</p>
      <p>官方规则两处战场胜出即可赢一局。AI争取三个战场全部获胜，不读取你的手牌或本回合安排。90%三星通过率仍未达到。</p>
      <p>发牌按回合偏向相应费用：开局以低费为主，后期以高费为主；少见费用仍可能出现。依据454局完整历史官方对战拟合，并用86局留出对战比较模型，不代表已获得官方发牌算法。双方使用同一规则，保留的旧手牌不因回合变化而消失。</p>
      <p>双方共用36张英雄牌池。一方取得后，另一方不能再取得同一英雄；未选中的候选之后仍可能出现。AI按共享牌池推演，不读取你的隐藏手牌或本回合选择。</p>
      <p>回合开始三选一，拖动手牌到战场，按先手顺序揭示。撤回及移动待揭示卡牌是本地试玩的便捷操作，这里没有官方限时处罚。同战力裁决、隐藏抽牌分布及部分技能组合尚未完整确认，不能宣称完全复刻。对局不连接游戏账号。</p></details>
    <button onClick={() => setCatalog(!catalog)}>{catalog ? '收起卡牌图鉴' : '展开卡牌图鉴'}</button>{catalog && <div className="snap-catalog">{CARDS.map((_, id) => <PlayingCard key={id} c={card(id, String(id))}/>)}</div>}
    <footer>水世界牌 · 本地人机实验场</footer>
  </main>;
}
