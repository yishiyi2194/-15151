import { readFile } from 'node:fs/promises';

export const info = {
  id: 'paintai-bridge',
  name: 'PaintAI 出图桥接',
  description: '向部署者允许的 PaintAI 站点转发文生图和额度查询。',
};

const VERSION = '1.0.0';
const BODY_LIMIT = 512 * 1024;
const CHECK_RESPONSE_LIMIT = 64 * 1024;
const MODELS = new Set(['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated']);
const SAMPLERS = new Set(['k_dpmpp_2m', 'k_euler_ancestral', 'k_euler', 'k_dpmpp_sde']);
const RESOLUTIONS = new Set(['832x1216', '1216x832', '1024x1024', '1024x768', '512x768']);
const BOOLEAN_PARAMS = new Set([
  'qualityToggle', 'legacy', 'legacy_uc', 'legacy_v3_extend', 'add_original_image',
  'autoSmea', 'dynamic_thresholding', 'normalize_reference_strength_multiple', 'use_coords',
  'sm', 'variety', 'add_quality_tags', 'use_new_shared_trial',
]);
const NUMBER_PARAMS = {
  scale: [1, 30], cfg_rescale: [0, 1], controlnet_strength: [0, 2],
  inpaintImg2ImgStrength: [0, 1],
};
const INTEGER_PARAMS = { steps: [1, 28], seed: [0, 4294967295], ucPreset: [0, 3], clip_skip: [1, 12] };
const PARAM_KEYS = new Set([
  'params_version', 'width', 'height', 'sampler', 'n_samples', 'negative_prompt',
  'noise_schedule', 'skip_cfg_above_sigma', 'v4_prompt', 'v4_negative_prompt',
  ...BOOLEAN_PARAMS, ...Object.keys(NUMBER_PARAMS), ...Object.keys(INTEGER_PARAMS),
]);

class BridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const reject = (message, status = 400) => { throw new BridgeError(status, message); };
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function requireKeys(object, allowed, message) {
  if (!plainObject(object) || Object.keys(object).some(key => !allowed.has(key))) reject(message);
}

function boundedNumber(value, minimum, maximum, integer = false) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    && (!integer || Number.isInteger(value));
}

function requirePrompt(value, required = false) {
  if (typeof value !== 'string' || value.length > 16000 || (required && !value.trim())) {
    reject('提示词必须是长度不超过 16000 字符的文本。');
  }
}

/** 只接受不带路径、凭据、查询参数的 HTTPS 来源。 */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value
    || !/^https:\/\/[^/?#\\]+\/?$/.test(value)) reject('服务地址必须是完整的 HTTPS 来源，不含路径或参数。');
  let url;
  try { url = new URL(value); } catch { reject('服务地址格式错误。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    reject('服务地址不允许携带用户名、密码、路径或参数。');
  }
  return url.origin;
}

function validateV4(value, negative) {
  requireKeys(value, new Set(['caption', ...(negative ? ['legacy_uc'] : ['use_order', 'use_coords'])]), 'V4 提示词结构不受支持。');
  requireKeys(value.caption, new Set(['base_caption', 'char_captions', 'legacy_uc', 'use_coords']), 'V4 caption 结构不受支持。');
  requirePrompt(value.caption.base_caption);
  if (!Array.isArray(value.caption.char_captions) || value.caption.char_captions.length !== 0) {
    reject('当前桥接仅支持基础文生图，不支持角色提示词或参考图。');
  }
  for (const object of [value, value.caption]) {
    for (const key of ['legacy_uc', 'use_coords', 'use_order']) {
      if (has(object, key) && typeof object[key] !== 'boolean') reject('V4 提示词开关必须是布尔值。');
    }
  }
}

/** 校验当前客户端文生图契约；未知字段不会被转发。 */
export function validatePayload(payload) {
  requireKeys(payload, new Set(['action', 'input', 'model', 'parameters', 'use_new_shared_trial']), '出图请求包含不支持的字段。');
  if (payload.action !== 'generate') reject('当前桥接仅支持文生图。');
  requirePrompt(payload.input, true);
  if (!MODELS.has(payload.model)) reject('请选择受支持的 NovelAI 4.5 模型。');
  if (has(payload, 'use_new_shared_trial') && typeof payload.use_new_shared_trial !== 'boolean') reject('共享试用参数必须是布尔值。');
  const parameters = payload.parameters;
  requireKeys(parameters, PARAM_KEYS, '出图参数包含不支持的字段。');
  if (parameters.params_version !== 3 || parameters.n_samples !== 1) reject('参数版本必须为 3，且每次只能生成 1 张图片。');
  if (!Number.isInteger(parameters.width) || !Number.isInteger(parameters.height)
    || !RESOLUTIONS.has(`${parameters.width}x${parameters.height}`)) reject('请选择上游支持的图片分辨率。');
  if (!SAMPLERS.has(parameters.sampler)) reject('采样器不受支持。');
  for (const required of ['steps', 'seed', 'scale']) {
    if (!has(parameters, required)) reject('缺少必要的出图参数。');
  }
  for (const [key, range] of Object.entries(NUMBER_PARAMS)) {
    if (has(parameters, key) && !boundedNumber(parameters[key], ...range)) reject(`出图参数 ${key} 超出范围。`);
  }
  for (const [key, range] of Object.entries(INTEGER_PARAMS)) {
    if (has(parameters, key) && !boundedNumber(parameters[key], ...range, true)) reject(`出图参数 ${key} 必须是范围内的整数。`);
  }
  for (const key of BOOLEAN_PARAMS) {
    if (has(parameters, key) && typeof parameters[key] !== 'boolean') reject(`出图参数 ${key} 必须是布尔值。`);
  }
  if (has(parameters, 'negative_prompt')) requirePrompt(parameters.negative_prompt);
  if (has(parameters, 'noise_schedule') && !['karras', 'exponential', 'native'].includes(parameters.noise_schedule)) reject('噪声调度器不受支持。');
  if (has(parameters, 'skip_cfg_above_sigma') && parameters.skip_cfg_above_sigma !== null
    && !boundedNumber(parameters.skip_cfg_above_sigma, 0, 100)) reject('CFG 截断参数超出范围。');
  if (has(parameters, 'v4_prompt')) validateV4(parameters.v4_prompt, false);
  if (has(parameters, 'v4_negative_prompt')) validateV4(parameters.v4_negative_prompt, true);
  return payload;
}

function validateRequest(body, allowedOrigins, generate) {
  requireKeys(body, new Set(generate ? ['baseUrl', 'token', 'payload'] : ['baseUrl', 'token']), '请求格式错误。');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > BODY_LIMIT) reject('请求内容过大。', 413);
  const origin = normalizeOrigin(body.baseUrl);
  if (!allowedOrigins.has(origin)) reject('该服务地址尚未被酒馆服务器允许。', 403);
  if (typeof body.token !== 'string' || body.token.length < 16 || body.token.length > 4096
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.token)) {
    reject('Token 格式错误；请填写站点签发的原始 JWT，不要添加 Bearer 前缀。');
  }
  return { origin, token: body.token, payload: generate ? validatePayload(body.payload) : undefined };
}

function writeJson(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function upstreamError(status) {
  const descriptions = {
    400: '上游服务拒绝了出图参数。', 401: 'Token 验证失败。', 403: 'Token 没有访问权限。',
    402: '上游服务余额不足。', 404: '上游接口不存在。', 429: '上游请求过于频繁，请稍后重试。',
    500: '上游服务内部错误。', 502: '上游服务暂时不可用。', 503: '上游服务正在维护。', 504: '上游请求超时。',
  };
  return new BridgeError(status >= 400 && status <= 599 ? status : 502, descriptions[status] || '上游服务请求失败。');
}

function lifetime(req, res, timeoutMs) {
  const controller = new AbortController();
  let cause;
  const abort = reason => {
    if (!controller.signal.aborted) {
      cause = reason;
      controller.abort();
    }
  };
  const onClose = () => { if (!res.writableEnded) abort('client'); };
  const onAborted = () => abort('client');
  res.once('close', onClose);
  req.once('aborted', onAborted);
  const timer = setTimeout(() => abort('timeout'), timeoutMs);
  return {
    signal: controller.signal,
    get cause() { return cause; },
    dispose() {
      clearTimeout(timer);
      res.off('close', onClose);
      req.off('aborted', onAborted);
    },
  };
}

function withAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(new BridgeError(504, '上游请求超时或已取消。'));
  return new Promise((resolve, rejectPromise) => {
    const aborted = () => rejectPromise(new BridgeError(504, '上游请求超时或已取消。'));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, rejectPromise).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function safeError(error, context) {
  if (context?.cause === 'timeout') return new BridgeError(504, '上游请求超时，请稍后重试。');
  return error instanceof BridgeError ? error : new BridgeError(502, '无法连接上游服务，或上游连接已中断。');
}

async function readLimitedJson(response, signal) {
  if (!response.body) throw new BridgeError(502, '上游额度响应为空。');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > CHECK_RESPONSE_LIMIT) throw new BridgeError(502, '上游额度响应过大。');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new BridgeError(502, '上游额度响应格式错误。'); }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function filterQuota(data, token) {
  if (!plainObject(data) || typeof data.valid !== 'boolean') throw new BridgeError(502, '上游额度响应缺少有效性字段。');
  const result = { valid: data.valid };
  for (const key of ['remaining', 'quota', 'used']) {
    if (has(data, key) && boundedNumber(data[key], 0, Number.MAX_SAFE_INTEGER, true)) result[key] = data[key];
  }
  if (typeof data.message === 'string') result.message = data.message.split(token).join('[已隐藏]').slice(0, 200);
  return result;
}

/** 只保留未匹配 Token 前缀，避免为了脱敏而缓存完整 SSE 图片。 */
function streamRedactor(token) {
  let pending = '';
  return (text, final = false) => {
    let current = (pending + text).split(token).join('[已隐藏]');
    pending = '';
    if (!final) {
      for (let length = Math.min(token.length - 1, current.length); length > 0; length--) {
        if (current.endsWith(token.slice(0, length))) {
          pending = current.slice(-length);
          current = current.slice(0, -length);
          break;
        }
      }
    }
    return current;
  };
}

async function writeChunk(res, text, signal) {
  if (!text) return;
  if (res.destroyed || res.writableEnded) throw new BridgeError(499, '客户端已断开。');
  if (res.write(text)) return;
  await new Promise((resolve, rejectPromise) => {
    const cleanup = () => {
      res.off('drain', drained);
      res.off('close', closed);
      signal.removeEventListener('abort', aborted);
    };
    const drained = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); rejectPromise(new BridgeError(499, '客户端已断开。')); };
    const aborted = () => { cleanup(); rejectPromise(new BridgeError(504, '上游请求超时或已取消。')); };
    res.once('drain', drained);
    res.once('close', closed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function pipeSse(response, res, signal, token) {
  if (!response.body) throw new BridgeError(502, '上游出图响应为空。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const redact = streamRedactor(token);
  let terminal = false;
  let inspectionTail = '';
  let lineHasTerminal = false;
  let lineEnd = '';
  const forward = async text => {
    // 只保留短尾部；终止 JSON 行完整结束后才记为终止事件。
    const segments = text.split('\n');
    for (let index = 0; index < segments.length; index++) {
      const inspected = inspectionTail + segments[index];
      lineHasTerminal ||= /(?:^|[,{])\s*"event_type"\s*:\s*"(?:final|error)"/.test(inspected);
      inspectionTail = inspected.slice(-128);
      const trimmed = segments[index].trimEnd();
      if (trimmed) lineEnd = trimmed.slice(-1);
      if (index < segments.length - 1) {
        terminal ||= lineHasTerminal && lineEnd === '}';
        inspectionTail = '';
        lineHasTerminal = false;
        lineEnd = '';
      }
    }
    await writeChunk(res, text, signal);
  };
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      await forward(redact(decoder.decode(value, { stream: true })));
    }
    await forward(redact(decoder.decode(), true));
    if (!terminal) throw new BridgeError(502, '上游出图流提前结束，未收到最终图片。');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** 可注入 fetch 与短超时，在不访问真实服务的条件下验证完整边界。 */
export function createHandlers({ allowedOrigins, fetchImpl = globalThis.fetch, generateTimeoutMs = 300000, checkTimeoutMs = 20000 }) {
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) throw new Error('桥接配置必须包含 allowedOrigins。');
  const origins = new Set(allowedOrigins.map(normalizeOrigin));
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 环境不支持 fetch。');
  for (const timeout of [generateTimeoutMs, checkTimeoutMs]) {
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('桥接超时配置必须是正数。');
  }

  const handle = generate => async (req, res) => {
    let context;
    let upstream;
    try {
      const { origin, token, payload } = validateRequest(req.body, origins, generate);
      context = lifetime(req, res, generate ? generateTimeoutMs : checkTimeoutMs);
      upstream = await withAbort(fetchImpl(`${origin}${generate ? '/api/proxy/novelai/ai/generate-image-stream' : '/api/tokens/check'}`, {
        method: 'POST',
        headers: generate ? {
          'Content-Type': 'application/json', 'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`, 'X-User-Token': token,
        } : { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(generate ? payload : { token }),
        redirect: 'error',
        signal: context.signal,
      }), context.signal);
      if (!upstream.ok) throw upstreamError(upstream.status);
      if (!generate) {
        writeJson(res, 200, filterQuota(await readLimitedJson(upstream, context.signal), token));
        return;
      }
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.split(';')[0].trim().toLowerCase() !== 'text/event-stream') {
        throw new BridgeError(502, '上游未返回 SSE 出图流。');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      await pipeSse(upstream, res, context.signal, token);
      res.end();
    } catch (error) {
      if (context?.cause === 'client' || res.destroyed || res.writableEnded) return;
      const failure = safeError(error, context);
      if (res.headersSent) {
        res.end(`\n\ndata: ${JSON.stringify({ event_type: 'error', code: failure.status, message: failure.message })}\n\n`);
      } else writeJson(res, failure.status, { error: failure.message });
    } finally {
      context?.dispose();
      if (upstream?.body && !upstream.body.locked) void upstream.body.cancel().catch(() => {});
    }
  };
  return {
    health(_req, res) { writeJson(res, 200, { ok: true, version: VERSION }); },
    check: handle(false),
    generate: handle(true),
  };
}

export async function init(router) {
  const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
  const handlers = createHandlers(config);
  router.get('/health', handlers.health);
  router.post('/check', handlers.check);
  router.post('/generate', handlers.generate);
}
