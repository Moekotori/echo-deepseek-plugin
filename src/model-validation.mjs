import { modelProfile, modelProviders, validateModelProfile } from './model-settings.mjs';
import { requestModel } from './model-request.mjs';

export function modelSettingsError(error) {
  const message = error instanceof Error ? error.message : '';
  const known = ['请输入有效的 API Key', '请填写有效的模型 ID', '模型协议无效', '模型服务验证结果无效',
    'API 地址须为不含密钥、查询参数和自定义端口的 HTTPS 地址', '更改 API 地址后请重新填写该服务的 API Key',
    '需要支持模型密钥安全存储的新版 ECHO 客户端', '服务地址已更改，请重新保存该服务的 API Key',
    'API Key 无效或无权访问此服务', 'API Key 无权访问此模型', '接口地址或模型不存在', '模型服务请求频率受限，请稍后再试'];
  if (known.includes(message)) return message;
  if (message.includes('model-endpoint-denied')) return '已取消自定义服务连接';
  if (message.includes('network-host-denied') || message.includes('model-endpoint-unavailable')) return '请更新 ECHO 客户端以使用自定义模型地址';
  return '连接验证失败，请检查地址、模型和网络后重试';
}

/** Validate the destination before persistence; a saved key is never reused at a different endpoint. */
export async function saveModelProfile(host, input, value, signal) {
  const profile = validateModelProfile(input);
  const previous = await modelProfile(host, profile.provider);
  const keyName = modelProviders[profile.provider].key;
  if (typeof host.storage.isSecure !== 'function' || !await host.storage.isSecure(keyName)) throw new Error('需要支持模型密钥安全存储的新版 ECHO 客户端');
  const replacing = Boolean(value.trim());
  if (!replacing && previous.baseUrl !== profile.baseUrl) throw new Error('更改 API 地址后请重新填写该服务的 API Key');
  const saved = replacing ? null : await host.storage.get(keyName);
  const record = typeof saved === 'string' ? JSON.parse(saved) : null;
  if (record && record.baseUrl !== profile.baseUrl) throw new Error('更改 API 地址后请重新填写该服务的 API Key');
  const stored = replacing ? value.trim() : record?.key;
  if (typeof stored !== 'string' || !stored || stored.length > 512 || /\s/u.test(stored)) throw new Error('请输入有效的 API Key');
  if (previous.baseUrl !== profile.baseUrl) {
    await host.network.request({ url: profile.baseUrl, approveHost: true });
    signal.throwIfAborted();
  }
  const result = await requestModel(host, profile, stored, '/models', undefined, signal);
  if (!Array.isArray(result.data)) throw new Error('模型服务验证结果无效');
  signal.throwIfAborted();
  // Binding the destination inside the encrypted record prevents cross-origin reuse after a partial save.
  if (replacing) await host.storage.set(keyName, JSON.stringify({ key: stored, baseUrl: profile.baseUrl }));
  await host.storage.set('model-profile-' + profile.provider, profile);
  await host.storage.set('model-provider', profile.provider);
  return profile;
}
