export function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
export async function publishSources(host, sources) {
  await host.ui.setPanelPresentation({ sourceLinks: sources.map((source, index) => ({ label: `[${index + 1}] ${source.label}`, url: source.url })) });
}
export function sourceList(host, sources, fetchedAt, expanded = false) {
  const details = element('details', undefined, 'research-sources'); details.open = expanded;
  const summary = element('summary'); const badges = element('span', undefined, 'source-badges'); badges.setAttribute('aria-hidden', 'true');
  for (const source of sources.slice(0, 3)) badges.append(element('span', new URL(source.url).hostname.replace(/^www\./u, '').charAt(0)));
  summary.append(badges, '来源与日期'); details.append(summary);
  if (!expanded) details.append(element('small', '检索于 ' + fetchedAt));
  const list = element('ol');
  for (const source of sources) {
    const row = element('li'); const title = element('button', source.label, 'source-title'); title.type = 'button';
    title.onclick = () => { void publishSources(host, [source]).catch(error => { title.textContent = error.message; }); };
    row.append(title, element('div', new URL(source.url).hostname, 'source-url'),
      element('small', source.publishedAt ? '网页发布：' + source.publishedAt : '检索于 ' + fetchedAt)); list.append(row);
  }
  const select = element('button', '查看来源'); select.type = 'button';
  select.onclick = () => { void publishSources(host, sources).catch(error => { select.textContent = error.message; }); };
  details.append(list, select); return details;
}

export function displayResearch(host, results, result, { onResearch, onDraft }) {
  results.replaceChildren();
  const article = element('article', undefined, 'research-article');
  const heading = element('header', undefined, 'research-heading');
  heading.append(element('h2', result.name), element('small', '检索于 ' + result.fetchedAt));
  article.append(heading, element('p', result.summary));
  const labels = { release: '新作', concert: '演出', announcement: '公告', background: '背景', relation: '作品关系' };
  if (result.items.length) {
    const list = element('ul', undefined, 'research-items');
    for (const item of result.items) {
      const row = element('li'); row.append(element('strong', item.title));
      const past = item.type === 'concert' && /^\d{4}-\d{2}-\d{2}$/u.test(item.date || '') && item.date < result.fetchedAt;
      row.append(element('p', item.detail), element('small', [labels[item.type], item.date || '日期未提供', past ? '已结束' : '', item.location, `来源 [${item.sourceIndex + 1}]`].filter(Boolean).join(' · '), 'research-item-meta')); list.append(row);
    }
    article.append(list);
  }
  if (result.people.length) {
    const people = element('div', undefined, 'actions research-people');
    for (const person of result.people) {
      const button = element('button', person.role + ' · ' + person.name); button.type = 'button';
      button.onclick = () => { void onResearch({ kind: 'contributor', name: person.name, question: person.role }); }; people.append(button);
    }
    article.append(people);
  }
  if (result.works.length) {
    const list = element('ul', undefined, 'research-works');
    for (const work of result.works) {
      const name = element('strong', work.title); name.append(element('span', ' — ' + work.artist));
      const row = element('li'); row.append(name,
        element('small', [work.relation, work.date, `来源 [${work.sourceIndex + 1}]`, work.track ? '曲库已匹配' : '曲库未匹配'].filter(Boolean).join(' · ')));
      if (result.kind === 'explore') {
        const explore = element('button', '继续探索'); explore.type = 'button';
        explore.onclick = () => { void onResearch({ kind: 'explore', name: (work.title + ' — ' + work.artist).slice(0, 400) }); };
        row.append(explore);
      }
      list.append(row);
    }
    article.append(list);
    const tracks = [...new Map(result.works.filter(work => work.track).map(work => [work.track.id, work.track])).values()];
    if (tracks.length) {
      const prepare = element('button', '用匹配作品准备歌单', 'research-prepare'); prepare.type = 'button';
      prepare.onclick = () => onDraft({ name: (result.name + ' · 相关作品').slice(0, 120), description: '', tracks, missing: [], playlistId: null, saved: false });
      article.append(prepare);
    }
  }
  results.append(article, sourceList(host, result.sources, result.fetchedAt, true));
  results.scrollIntoView({ block: 'nearest' });
}
