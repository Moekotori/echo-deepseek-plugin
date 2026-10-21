export const modelProviders = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', key: 'api-key' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', key: 'openai-api-key' },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: '', key: 'anthropic-api-key' },
};
export async function selectedProvider(host) {
  const selected = await host.storage.get('model-provider');
  return typeof selected === 'string' && Object.hasOwn(modelProviders, selected) ? selected : 'deepseek';
}
export async function modelProfile(host, provider = null) {
  provider ??= await selectedProvider(host);
  const defaults = modelProviders[provider];
  const stored = provider === 'deepseek' ? null : await host.storage.get('model-profile-' + provider);
  return { provider, baseUrl: stored?.baseUrl ?? defaults.baseUrl, model: stored?.model ?? defaults.model };
}
export function validateModelProfile(profile) {
  if (!Object.hasOwn(modelProviders, profile.provider)) throw new Error('模型协议无效');
  const url = new URL(profile.baseUrl.trim());
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.href.length > 500) {
    throw new Error('API 地址须为不含密钥、查询参数和自定义端口的 HTTPS 地址');
  }
  const model = profile.model.trim();
  if (!model || model.length > 200 || /[\s/?#]/u.test(model)) throw new Error('请填写有效的模型 ID');
  return { provider: profile.provider, baseUrl: url.href.replace(/\/+$/u, ''), model };
}
export async function readModelConnection(host) {
  const profile = await modelProfile(host);
  if (profile.provider !== 'deepseek') validateModelProfile(profile);
  const keyName = modelProviders[profile.provider].key;
  if (typeof host.storage.isSecure !== 'function' || !await host.storage.isSecure(keyName)) throw new Error('需要支持安全 Key 存储的 ECHO 客户端');
  let key = await host.storage.get(keyName);
  if (profile.provider !== 'deepseek' && typeof key === 'string') {
    const record = JSON.parse(key);
    if (record.baseUrl !== profile.baseUrl) throw new Error('服务地址已更改，请重新保存该服务的 API Key');
    key = record.key;
  }
  if (typeof key !== 'string' || !key.trim()) throw new Error('请先填写 ' + modelProviders[profile.provider].label + ' API Key');
  return { ...profile, key: key.trim() };
}
export const requireDeepSeekSearch = profile => {
  if (profile.provider !== 'deepseek') throw new Error('联网资料检索请切换至推荐的 DeepSeek');
};
