// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { mountKeySettings } from './src/key-panel.js';
import { postDeepSeek } from './src/api.mjs';
import { modelResponse } from './test-support.mjs';

const balanceBody = (amount = '12.3456', available = true) => JSON.stringify({ is_available: available,
  balance_infos: [{ currency: 'CNY', total_balance: amount }] });
afterEach(() => { window.dispatchEvent(new Event('pagehide')); document.body.replaceChildren(); });
it('shows saved-key validation outside the closed settings and preserves it after an invalid replacement', async () => {
  document.documentElement.innerHTML = readFileSync(resolve('src/panel.html'), 'utf8');
  let saved = 'saved-fixture';
  const set = vi.fn(async (_key, value) => { saved = value; });
  const request = vi.fn(async () => ({ ok: true, status: 200, body: balanceBody() }));
  const host = { storage: { isSecure: async () => true, get: async () => saved, set, remove: async () => { saved = ''; } }, network: { request, cancel: async () => {} } };
  const onConfigured = vi.fn();
  const panel = mountKeySettings(host, { onConfigured, onChanged: vi.fn() });
  await panel.load();
  const status = document.getElementById('status')!;
  const settings = document.getElementById('key-settings') as HTMLDetailsElement;
  const input = document.getElementById('api-key') as HTMLInputElement;
  expect(settings.open).toBe(false); expect(status.closest('details')).toBeNull();
  expect(status.textContent).toContain('验证通过'); expect(input.value).toBe('');
  expect(input.placeholder).toContain('已保存');
  document.getElementById('save')!.click();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(false));
  expect(set).not.toHaveBeenCalled(); expect(saved).toBe('saved-fixture');
  const balance = document.getElementById('balance')!;
  expect(balance.closest('details')).toBeNull(); expect(balance.textContent).toContain('12.3456 CNY');
  request.mockResolvedValueOnce({ ok: false, status: 401, body: '{}' });
  input.value = 'invalid-fixture'; document.getElementById('save')!.click();
  await vi.waitFor(() => expect(status.textContent).toContain('API Key 无效'));
  expect(saved).toBe('saved-fixture'); expect(set).not.toHaveBeenCalled();
  expect(onConfigured).toHaveBeenLastCalledWith(true);
  document.getElementById('clear')!.click();
  await vi.waitFor(() => expect(status.textContent).toBe('已清除'));
  expect(onConfigured).toHaveBeenLastCalledWith(false);
  expect(balance.textContent).toBe('');
});

it('prompts for a revoked saved key on reopen without deleting the encrypted credential', async () => {
  document.documentElement.innerHTML = readFileSync(resolve('src/panel.html'), 'utf8');
  const remove = vi.fn(); const onConfigured = vi.fn();
  const host = { storage: { isSecure: async () => true, get: async () => 'revoked-fixture', remove },
    network: { request: async () => ({ ok: false, status: 401, body: '{}' }), cancel: async () => {} } };
  await mountKeySettings(host, { onConfigured, onChanged: vi.fn() }).load();
  expect(document.getElementById('status')!.textContent).toContain('已失效，请重新配置');
  expect((document.getElementById('key-settings') as HTMLDetailsElement).open).toBe(true);
  expect(document.getElementById('balance')!.textContent).toBe('');
  expect(onConfigured).toHaveBeenLastCalledWith(false); expect(remove).not.toHaveBeenCalled();
});

it('refreshes numeric balance after API calls and immediately reports a revoked key during use', async () => {
  document.documentElement.innerHTML = readFileSync(resolve('src/panel.html'), 'utf8');
  const request = vi.fn(async () => ({ ok: true, status: 200, body: balanceBody() }));
  const onConfigured = vi.fn();
  const host = { storage: { isSecure: async () => true, get: async () => 'saved-fixture' },
    network: { request, cancel: async () => {} } };
  await mountKeySettings(host, { onConfigured, onChanged: vi.fn() }).load();
  request.mockResolvedValueOnce(modelResponse({ choices: [{ finish_reason: 'stop', message: { content: '完成' } }] }))
    .mockResolvedValueOnce({ ok: true, status: 200, body: balanceBody('0.00', false) });
  const completion = { model: 'deepseek-flash', max_tokens: 100, messages: [{ role: 'user', content: '音乐' }] };
  await postDeepSeek(host, '/chat/completions', completion, 'saved-fixture', new AbortController().signal);
  await vi.waitFor(() => expect(document.getElementById('balance')!.textContent).toContain('0.00 CNY'));
  expect(document.getElementById('status')!.textContent).toContain('余额不足');
  request.mockResolvedValueOnce({ ok: false, status: 401, body: '{}' })
    .mockResolvedValueOnce({ ok: false, status: 401, body: '{}' });
  await expect(postDeepSeek(host, '/chat/completions', completion, 'saved-fixture', new AbortController().signal)).rejects.toThrow('API Key 无效');
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('已失效，请重新配置'));
  expect(document.getElementById('balance')!.textContent).toBe('');
  expect((document.getElementById('key-settings') as HTMLDetailsElement).open).toBe(true);
  expect(onConfigured).toHaveBeenLastCalledWith(false);
});

it('keeps the saved key usable when search rejects authentication but account validation succeeds or is offline', async () => {
  document.documentElement.innerHTML = readFileSync(resolve('src/panel.html'), 'utf8');
  const request = vi.fn(async () => ({ ok: true, status: 200, body: balanceBody() }));
  const onConfigured = vi.fn();
  const remove = vi.fn();
  const host = { storage: { isSecure: async () => true, get: async () => 'saved-fixture', remove },
    network: { request, cancel: async () => {} } };
  await mountKeySettings(host, { onConfigured, onChanged: vi.fn() }).load();
  for (const offline of [false, true]) {
    request.mockResolvedValueOnce({ ok: false, status: 401, body: '{}' });
    if (offline) request.mockRejectedValueOnce(new Error('offline'));
    else request.mockResolvedValueOnce({ ok: true, status: 200, body: balanceBody() });
    await expect(postDeepSeek(host, '/v1/tools/search', {}, 'saved-fixture', new AbortController().signal)).rejects.toThrow();
    await vi.waitFor(() => expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(false));
    expect((document.getElementById('key-settings') as HTMLDetailsElement).open).toBe(false);
    expect(onConfigured).toHaveBeenLastCalledWith(true);
    expect(document.getElementById('status')!.textContent).toContain(offline ? '已保存' : '验证通过');
  }
  expect(remove).not.toHaveBeenCalled();
});
