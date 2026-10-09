import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CardDuel} from './CardDuel';
describe('standalone human vs AI entry',()=>{
  it('opens without an account API and exposes exactly the human hand and draw offers',()=>{
    const html=renderToStaticMarkup(<CardDuel initialSeed={17}/>);
    expect(html).toContain('三个战场全部获胜');
    expect(html).toContain('对手手牌与本回合安排保持隐藏');
    // The header also uses a bundled native sprite, with no assistant icon catalog.
    expect((html.match(/class="native-hero-art"/g)||[]).length).toBe(6);
    expect((html.match(/class="duel-avatar"/g)||[]).length).toBe(1);
    expect(html).toContain('duel-city-art');
    expect(html).not.toContain('请先上线');expect(html).not.toContain('/api/');
    expect(html).toContain('90%三星通过率仍未达到');
    expect(html).toContain('30秒思考');expect(html).toContain('旧版本统计保留');
    expect(html).toContain('第 1 回合 · 选择一张卡牌');
    expect(html).toContain('<dialog');expect(html).toContain('选中的卡牌加入手牌');
    expect(html).not.toContain('① 选一张牌');
    expect(html).toContain('查看战场');expect(html).toContain('duel-draft-dialog');
    expect(html).not.toContain('duel-dialog-drag');
    expect(html).not.toContain('⠿ 移动');
    expect(html).toContain('按住标题移动窗口；方向键微调');
    expect(html).toContain('AI思考时间');
    expect(html).toContain('AI实际思考状态');
    expect(html).toContain('AI 与你同时思考，准备好后直接出牌。');
  });
});
