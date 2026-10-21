// Slides the shared highlight behind whichever tab is pressed.
export function mountTabPill(container) {
  function place() {
    const active = container.querySelector('[aria-pressed="true"]');
    if (!active) return;
    container.style.setProperty('--pill-x', active.offsetLeft + 'px');
    container.style.setProperty('--pill-width', active.offsetWidth + 'px');
  }
  window.addEventListener('resize', place);
  window.addEventListener('pagehide', () => window.removeEventListener('resize', place), { once: true });
  return place;
}
