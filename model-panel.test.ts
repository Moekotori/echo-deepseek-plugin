// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { mountKeySettings } from './src/key-panel.js';

afterEach(() => { window.dispatchEvent(new Event('pagehide')); document.body.replaceChildren(); });
it('switches protocols, keeps DeepSeek recommended and its saved key intact, and clears only the selected service key', async () => {
  document.documentElement.innerHTML = readFileSync('src/panel.html', 'utf8');
  const values = new Map<string, unknown>([['api-key', 'deepseek-fixture']]);
  const request = vi.fn(async (input: { url: string }) => ({ ok: true, status: 200,
    body: JSON.stringify(input.url.endsWith('/user/balance') ? { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.3456' }] } : { data: [{ id: 'model' }] }) }));
  const host = { storage: { isSecure: async () => true, get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: unknown) => { values.set(key, value); }, remove: async (key: string) => { values.delete(key); } }, network: { request, cancel: async () => {} } };
  const onConfigured = vi.fn(); const onProvider = vi.fn();
  const keys = mountKeySettings(host, { onConfigured, onProvider, onChanged: vi.fn() }); await keys.load();
  const byId = (id: string) => document.getElementById(id)!;
  const field = (id: string) => byId(id) as HTMLInputElement;
  expect(document.querySelector('[data-provider="deepseek"]')!.textContent).toContain('推荐');
  expect(byId('balance').textContent).toContain('12.3456');
  (document.querySelector('[data-provider="openai"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(byId('model-fields').hidden).toBe(false));
  await vi.waitFor(() => expect((byId('save') as HTMLButtonElement).disabled).toBe(false));
  expect(field('model-base-url').value).toBe('https://api.openai.com/v1');
  expect(byId('balance').textContent).toBe(''); expect(onConfigured).toHaveBeenLastCalledWith(false);
  field('model-name').value = 'selected-model'; field('api-key').value = 'openai-fixture'; byId('save').click();
  await vi.waitFor(() => expect(byId('status').textContent).toContain('连接验证通过'));
  expect(values.get('api-key')).toBe('deepseek-fixture'); expect(field('api-key').value).toBe('');
  expect(JSON.parse(values.get('openai-api-key') as string)).toEqual({ key: 'openai-fixture', baseUrl: 'https://api.openai.com/v1' });
  expect(onConfigured).toHaveBeenLastCalledWith(true); expect(onProvider.mock.lastCall?.[0].provider).toBe('openai');
  byId('clear').click(); await vi.waitFor(() => expect(byId('status').textContent).toBe('已清除'));
  expect(values.has('openai-api-key')).toBe(false); expect(values.get('api-key')).toBe('deepseek-fixture');
  (document.querySelector('[data-provider="deepseek"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(byId('balance').textContent).toContain('12.3456'));
  expect(byId('model-fields').hidden).toBe(true); expect(onConfigured).toHaveBeenLastCalledWith(true);
});
