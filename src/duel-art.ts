import manifest from './card-art/manifest.json';
// Only native sprites used by the account-free duel enter its public build.
const assets = import.meta.glob('./card-art/{hero_card_*,field-*,card_bg_01,card_bg_02,card_bg_03,bg_card,card_btn_01,card_btn_02,card_icon_01,card_icon_02,card_icon_03,card_icon_robot,bullet-blue,bullet-red,skill-hit}.webp', {eager:true, query:'?url', import:'default'}) as Record<string,string>;
export function duelSprite(name:string) {
  const file = (manifest.sprites as Record<string,string>)[name];
  return assets['./card-art/' + file];
}
export function duelPortrait(hero:string) {
  return assets['./card-art/' + (manifest.heroes as Record<string,string>)[hero]];
}
