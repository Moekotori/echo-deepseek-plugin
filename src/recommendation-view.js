import { element } from './research-view.js';

function playIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 12 12'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M2.5 1.2v9.6L10.5 6z'); path.setAttribute('fill', 'currentColor');
  svg.append(path); return svg;
}

export function recommendationList(host, recommendations, { onSelect, onError }) {
  const list = element('ul', undefined, 'recommendation-list');
  const ids = [...new Set(recommendations.filter(item => item.track && !item.track.unavailable).map(item => item.track.id))];
  let playing = false;
  for (const item of recommendations) {
    const name = element('strong', item.title); name.append(element('span', ' — ' + item.artist));
    const row = element('li'); row.append(name, element('p', item.reason));
    const actions = element('div', undefined, 'actions'); const play = element('button'); play.type = 'button';
    play.setAttribute('aria-label', '播放'); play.title = '播放'; play.append(playIcon());
    play.disabled = !item.track || item.track.unavailable;
    play.onclick = async () => {
      if (playing || play.disabled) return;
      playing = true;
      const buttons = [...list.querySelectorAll('[data-play]')]; for (const button of buttons) button.disabled = true;
      try { await host.queue.playTrack(item.track.id, ids); onSelect(item); }
      catch (error) { onError(error); }
      finally { playing = false; for (const button of buttons) button.disabled = button.dataset.play === 'unavailable'; }
    };
    play.dataset.play = play.disabled ? 'unavailable' : 'ready';
    const ask = element('button', '追问这首'); ask.type = 'button'; ask.onclick = () => onSelect(item);
    actions.append(play, ask); row.append(actions);
    if (!item.track) row.append(element('small', '曲库未匹配'));
    list.append(row);
  }
  return list;
}
