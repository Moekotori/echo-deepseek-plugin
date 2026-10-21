import { searchMusic } from './music-search.mjs';

export const artistProfilePrompt = '艺术家专用：extract写350至550字、分3段概览，覆盖身份、音乐特点、代表作品和主要经历，资料不足时按已有内容写，不凑字数。facts最多12项，每项value最多600字符，优先保留成员、音乐风格、代表作品、重要经历，再补别名、地区、出道/成立、厂牌、活动年代等。成员应完整列出资料明确记录的现任/历史成员及身份，不受relatedArtists的6人上限限制；音乐风格必须有来源描述，不凭角色或国籍推测；代表作品列3至6首/张明确归属的作品及已知年份，保留作品原名；重要经历按时间列最多5项已发生且有记录的出道、重要发行、奖项、演出或人员变动，未知日期不编造。成员、作品、经历可用换行分项。每项facts必须有sourceIndices数组，最多3个支持该项的搜索来源零基序号；没有支持来源的字段不输出。尤其音乐风格如果只有团体身份或动画关联而没有风格分类，不创建该字段；不得以“未提供”“未给出”“未找到”或类似缺失说明填充任何facts。优先官网、唱片公司、正式采访和可靠媒体。不得输出自己生成的URL、HTML或Markdown链接，超链接只由宿主从引用来源生成。';

export async function searchArtistProfile(host, name, key, signal) {
  const queries = ['音乐艺人 简介 成员 历史成员 官方 profile', 'music genre discography career biography interview 音乐风格'];
  const results = await Promise.all(queries.map(query => searchMusic(host, name + ' ' + query, key, signal, 3)));
  return [...new Map(results.flat().map(source => [source.url, source])).values()].slice(0, 6);
}
