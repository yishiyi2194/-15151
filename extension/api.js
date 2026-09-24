export const DEFAULTS = Object.freeze({
    baseUrl: 'https://www.r67831767.nyat.app:19088',
    model: 'nai-diffusion-4-5-full',
    resolution: '832x1216',
    steps: 28,
    scale: 5,
    sampler: 'k_dpmpp_2m',
    seed: -1,
    negative: 'blurry, lowres, worst quality, bad quality, jpeg artifacts, watermark, logo',
    autoSend: true,
    autoScene: false,
    sceneMaxImages: 1,
});
export const MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated'];
export const SIZES = ['832x1216', '1216x832', '1024x1024', '1024x768', '512x768'];
export const SAMPLERS = ['k_dpmpp_2m', 'k_euler_ancestral', 'k_euler', 'k_dpmpp_sde'];
const MAX_IMAGE = 32 * 1024 * 1024;

export function normalizeBaseUrl(value) {
    let url;
    try { url = new URL(String(value).trim()); } catch { throw new Error('请输入完整的 HTTPS 网站地址。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('服务地址应为 HTTPS 域名与端口，不包含接口路径、账号或查询参数。');
    }
    return url.origin;
}

export function normalizeToken(value) {
    const token = String(value || '').trim().replace(/^Bearer\s+/i, '');
    if (token.length < 16 || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error('请填写网站签发的完整项目 JWT Token。');
    }
    return token;
}

export function safeError(error, token = '') {
    let message = String(error?.message || error || '请求失败');
    if (token) message = message.split(token).join('[已隐藏]');
    return message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[已隐藏]').slice(0, 500);
}

export function buildPayload(settings, prompt, randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('请输入画面提示词。');
    if (prompt.length > 12000 || String(settings.negative).length > 12000) throw new Error('提示词过长，最多 12000 个字符。');
    if (!MODELS.includes(settings.model) || !SIZES.includes(settings.resolution) || !SAMPLERS.includes(settings.sampler)) {
        throw new Error('请选择支持的模型、尺寸和采样器。');
    }
    const steps = Number(settings.steps), scale = Number(settings.scale), configuredSeed = Number(settings.seed);
    if (!Number.isInteger(steps) || steps < 1 || steps > 28) throw new Error('步数必须为 1–28 的整数。');
    if (!Number.isFinite(scale) || scale < 1 || scale > 30) throw new Error('CFG 必须在 1–30 之间。');
    if (!Number.isInteger(configuredSeed) || configuredSeed < -1 || configuredSeed > 4294967295) throw new Error('种子应为 -1 或 0–4294967295 的整数。');
    const [width, height] = settings.resolution.split('x').map(Number);
    const seed = configuredSeed === -1 ? randomSeed() : configuredSeed;
    return {
        action: 'generate', input: prompt.trim(), model: settings.model, use_new_shared_trial: true,
        parameters: {
            params_version: 3, width, height, scale, sampler: settings.sampler, steps, n_samples: 1, seed,
            negative_prompt: settings.negative, ucPreset: 0, qualityToggle: true,
            noise_schedule: 'karras', clip_skip: 1, cfg_rescale: 0.7,
            legacy: false, legacy_uc: false, legacy_v3_extend: false,
            add_original_image: true, autoSmea: false, dynamic_thresholding: false,
            normalize_reference_strength_multiple: true, skip_cfg_above_sigma: null, use_coords: false,
            v4_prompt: { caption: { base_caption: prompt.trim(), char_captions: [], use_coords: false }, use_order: true },
            v4_negative_prompt: { caption: { base_caption: settings.negative, char_captions: [], legacy_uc: false }, legacy_uc: false },
        },
    };
}

export function decodeImage(base64) {
    if (typeof base64 !== 'string' || base64.length > MAX_IMAGE || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        throw new Error('服务返回了无效或过大的图片。');
    }
    let raw;
    try { raw = atob(base64); } catch { throw new Error('图片 Base64 数据损坏。'); }
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    let format;
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) format = 'png';
    else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) format = 'jpg';
    else throw new Error('当前仅支持 PNG 或 JPEG 图片。');
    return { base64, format, blob: new Blob([bytes], { type: format === 'png' ? 'image/png' : 'image/jpeg' }) };
}

/** 按事件边界解析；网络块、UTF-8 字符与 SSE 行都可能在任意位置切开。 */
export async function readImageStream(response, { signal, onProgress = () => {} } = {}) {
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
        throw new Error('服务没有返回图片事件流，请检查插件和网站接口。');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', dataLines = [], eventSize = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    const dispatch = () => {
        const data = dataLines.join('\n');
        dataLines = []; eventSize = 0;
        if (!data || data === '[DONE]') return null;
        let event;
        try { event = JSON.parse(data); } catch { throw new Error('图片事件数据损坏。'); }
        if (event.event_type === 'error') throw new Error(event.message || `生成失败：${event.code || '未知错误'}`);
        if (event.event_type === 'final') return decodeImage(event.image);
        if (event.event_type === 'intermediate') onProgress({ step: event.step_ix ?? event.step ?? event.step_index, image: event.image });
        return null;
    };
    try {
        while (true) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            signal?.throwIfAborted();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (buffer.length + eventSize > MAX_IMAGE + 16384) throw new Error('图片事件超过大小限制。');
            let match;
            while ((match = /\r\n|\r|\n/.exec(buffer))) {
                if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
                const line = buffer.slice(0, match.index);
                buffer = buffer.slice(match.index + match[0].length);
                if (line === '') {
                    const image = dispatch();
                    if (image) return image;
                } else if (line.startsWith('data:')) {
                    const data = line.slice(5).replace(/^ /, '');
                    dataLines.push(data); eventSize += data.length;
                }
            }
            if (done) throw new Error('连接已结束，但未收到完整的 final 图片；本次不自动重试。');
        }
    } finally {
        signal?.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

export async function bridgeRequest(operation, data, { headers, signal, fetchImpl = fetch } = {}) {
    let response;
    try {
        response = await fetchImpl(`/api/plugins/paintai-bridge/${operation}`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            credentials: 'same-origin', body: JSON.stringify(data), signal,
        });
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw new Error('无法连接酒馆转发插件，请检查酒馆服务器。');
    }
    if (response.status === 404) throw new Error('服务端插件未加载，请安装 paintai-bridge、启用 enableServerPlugins 并重启酒馆。');
    if (!response.ok) {
        let message = `请求失败（HTTP ${response.status}）`;
        try { const json = await response.json(); message = json.error?.message || json.error || json.message || message; } catch {}
        throw new Error(safeError(message, data.token));
    }
    return response;
}
