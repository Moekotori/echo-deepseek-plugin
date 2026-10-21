import { getDeepSeek, requireSecureDeepSeekStorage } from './api.mjs';

export async function validateDeepSeekKey(host, input, signal) {
  const key = input.trim();
  if (!key || key.length > 512 || /\s/u.test(key)) throw new Error('请输入有效的 API Key');
  const balance = await getDeepSeek(host, '/user/balance', key, signal);
  if (typeof balance.is_available !== 'boolean' || !Array.isArray(balance.balance_infos)
    || balance.balance_infos.length < 1 || balance.balance_infos.length > 2
    || balance.balance_infos.some(info => !['CNY', 'USD'].includes(info.currency)
      || typeof info.total_balance !== 'string' || info.total_balance.length > 64
      || !/^-?\d+(?:\.\d+)?$/u.test(info.total_balance))) throw new Error('DeepSeek 验证结果无效');
  return { available: balance.is_available,
    balances: balance.balance_infos.map(info => ({ currency: info.currency, total: info.total_balance })) };
}

export async function saveDeepSeekKey(host, input, signal) {
  await requireSecureDeepSeekStorage(host);
  const result = await validateDeepSeekKey(host, input, signal);
  signal.throwIfAborted();
  await host.storage.set('api-key', input.trim());
  return result;
}

/** Only known messages reach the UI; IPC/file errors and provider bodies stay private. */
export function deepSeekKeyError(error) {
  const message = error instanceof Error ? error.message : '';
  const known = ['请输入有效的 API Key', 'DeepSeek API Key 无效或已失效，请重新配置', 'DeepSeek 账户余额不足',
    'DeepSeek 请求频率受限，请稍后再试', 'DeepSeek 验证结果无效', '需要支持安全 Key 存储的 ECHO 客户端'];
  if (known.includes(message)) return message;
  if (message.includes('plugin-credential-secure-storage-unavailable')) return '系统安全存储不可用，无法保存 API Key';
  if (message.includes('plugin-credential-decryption-failed')) return '无法解密已保存的 API Key';
  if (message.includes('plugin-credential-storage-failed')) return 'API Key 保存失败，原配置已保留';
  return '连接验证失败，请检查网络后重试';
}
