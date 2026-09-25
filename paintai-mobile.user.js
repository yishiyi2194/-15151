// ==UserScript==
// @name         PaintAI 手机出图
// @namespace    https://github.com/yishiyi2194/-15151
// @version      1.0.0
// @description  在支持 Violentmonkey 的手机浏览器中直接使用 PaintAI 文生图；可选接入当前 SillyTavern 聊天。
// @author       PaintAI
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      www.r67831767.nyat.app
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    if (window.__PAINTAI_MOBILE_LOADED__) return;
    window.__PAINTAI_MOBILE_LOADED__ = true;

    const DEFAULT_URL = 'https://www.r67831767.nyat.app:19088';
    const MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated'];
    const SIZES = ['832x1216', '1216x832', '1024x1024', '1024x768', '512x768'];
    const SAMPLERS = ['k_dpmpp_2m', 'k_euler_ancestral', 'k_euler', 'k_dpmpp_sde'];
    const SETTINGS_KEY = 'paintai-mobile-settings';
    const MAX_BASE64 = 32 * 1024 * 1024;
    let root;
    let busy = false;
    let lastImage = null;
    let sceneBound = false;
    const seenScenes = new Set();

    function normalizeUrl(value) {
        const url = new URL(String(value).trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
            throw new Error('服务地址必须是 HTTPS 根地址，不能带路径。');
        }
        return url.origin;
    }

    function normalizeToken(value) {
        const token = String(value || '').trim().replace(/^Bearer\s+/i, '');
        if (token.length < 16 || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
            throw new Error('请填写 PaintAI 网站签发的完整 JWT Token。');
        }
        return token;
    }

    function errorText(error, token = '') {
        let message = String(error?.message || error || '请求失败');
        if (token) message = message.split(token).join('[已隐藏]');
        return message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[已隐藏]').slice(0, 500);
    }

    function request(url, data, headers = {}, timeout = 300000) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url, data: JSON.stringify(data), headers: { 'Content-Type': 'application/json', ...headers },
                timeout,
                onload: response => {
                    if (response.status >= 200 && response.status < 300) return resolve(response.responseText || '');
                    let message = `请求失败（HTTP ${response.status}）`;
                    try { message = JSON.parse(response.responseText).message || JSON.parse(response.responseText).error || message; } catch {}
                    reject(new Error(message));
                },
                onerror: () => reject(new Error('无法连接 PaintAI 网站。')),
                ontimeout: () => reject(new Error('请求超时。')),
                onabort: () => reject(new Error('请求已取消。')),
            });
        });
    }

    function buildPayload(settings, prompt) {
        if (!prompt.trim()) throw new Error('请输入画面提示词。');
        const steps = Number(settings.steps), scale = Number(settings.scale), configuredSeed = Number(settings.seed);
        if (!MODELS.includes(settings.model) || !SIZES.includes(settings.resolution) || !SAMPLERS.includes(settings.sampler)) throw new Error('生成参数不受支持。');
        if (!Number.isInteger(steps) || steps < 1 || steps > 28) throw new Error('步数必须是 1 到 28 的整数。');
        if (!Number.isFinite(scale) || scale < 1 || scale > 30) throw new Error('CFG 必须在 1 到 30 之间。');
        if (!Number.isInteger(configuredSeed) || configuredSeed < -1 || configuredSeed > 4294967295) throw new Error('种子必须是 -1 或 0 到 4294967295。');
        const [width, height] = settings.resolution.split('x').map(Number);
        const seed = configuredSeed === -1 ? crypto.getRandomValues(new Uint32Array(1))[0] : configuredSeed;
        return {
            action: 'generate', input: prompt.trim(), model: settings.model, use_new_shared_trial: true,
            parameters: {
                params_version: 3, width, height, scale, sampler: settings.sampler, steps, n_samples: 1, seed,
                negative_prompt: settings.negative, ucPreset: 0, qualityToggle: true, noise_schedule: 'karras', clip_skip: 1,
                cfg_rescale: 0.7, legacy: false, legacy_uc: false, legacy_v3_extend: false, add_original_image: true,
                autoSmea: false, dynamic_thresholding: false, normalize_reference_strength_multiple: true,
                skip_cfg_above_sigma: null, use_coords: false,
                v4_prompt: { caption: { base_caption: prompt.trim(), char_captions: [], use_coords: false }, use_order: true },
                v4_negative_prompt: { caption: { base_caption: settings.negative, char_captions: [], legacy_uc: false }, legacy_uc: false },
            },
        };
    }

    function parseFinalImage(streamText) {
        const blocks = String(streamText).split(/\r?\n\r?\n/);
        for (const block of blocks) {
            const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (!data || data === '[DONE]') continue;
            let event;
            try { event = JSON.parse(data); } catch { continue; }
            if (event.event_type === 'error') throw new Error(event.message || `生成失败（${event.code || '未知错误'}）`);
            if (event.event_type === 'final') return decodeImage(event.image);
        }
        throw new Error('没有收到完整的 final 图片。');
    }

    function decodeImage(base64) {
        if (typeof base64 !== 'string' || base64.length > MAX_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('服务返回了无效图片。');
        const raw = atob(base64);
        const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
        const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
        const jpg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!png && !jpg) throw new Error('当前只支持 PNG 或 JPEG 图片。');
        const format = png ? 'png' : 'jpg';
        return { base64, format, blob: new Blob([bytes], { type: `image/${format}` }) };
    }

    function extractPrompts(text) {
        const result = [];
        const patterns = [
            /\[\[\s*(?:paintai|绘图|文生图|插图|image)\s*[:：]\s*([\s\S]*?)\s*\]\]/gi,
            /<\s*(?:paintai|image)\s*>\s*([\s\S]*?)\s*<\/\s*(?:paintai|image)\s*>/gi,
            /【\s*(?:文生图|绘图|paintai)\s*】\s*[:：-]?\s*([^\n]+)/gi,
        ];
        for (const pattern of patterns) {
            for (const match of String(text || '').matchAll(pattern)) {
                const prompt = match[1].replace(/\s+/g, ' ').trim();
                if (prompt && !result.includes(prompt)) result.push(prompt);
                if (result.length >= 3) return result;
            }
        }
        return result;
    }

    function context() {
        return window.SillyTavern?.getContext?.() || null;
    }

    async function addToChat(image, prompt) {
        const ctx = context();
        if (!ctx?.chat || !ctx.addOneMessage || !ctx.saveChat) throw new Error('当前页面不是可写入聊天的 SillyTavern。');
        const filename = `paintai_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        const response = await fetch('/api/images/upload', {
            method: 'POST', headers: { ...(ctx.getRequestHeaders?.() || {}), 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: image.base64, ch_name: 'PaintAI', filename, format: image.format }),
        });
        if (!response.ok) throw new Error(`酒馆图片上传失败（HTTP ${response.status}）。`);
        const data = await response.json();
        if (typeof data.path !== 'string' || !data.path.startsWith('/') || data.path.startsWith('//')) throw new Error('酒馆没有返回有效图片路径。');
        const message = { name: 'PaintAI', is_user: false, is_system: true, send_date: new Date().toISOString(), mes: '', extra: { image: data.path, title: prompt, inline_image: false, paintai: { prompt } } };
        ctx.chat.push(message);
        ctx.addOneMessage(message);
        await ctx.saveChat();
        return data.path;
    }

    function value(name) { return root.querySelector(`[data-paintai="${name}"]`).value; }
    function field(name) { return root.querySelector(`[data-paintai="${name}"]`); }
    function status(message, error = false) { const node = field('status'); node.textContent = message; node.dataset.error = String(error); }
    function setBusy(value) { busy = value; root.querySelectorAll('button').forEach(button => { button.disabled = value; }); }

    async function generate(promptOverride) {
        if (busy) return;
        let token = '';
        setBusy(true);
        try {
            const baseUrl = normalizeUrl(value('baseUrl'));
            token = normalizeToken(value('token'));
            const settings = { model: value('model'), resolution: value('resolution'), sampler: value('sampler'), steps: value('steps'), scale: value('scale'), seed: value('seed'), negative: value('negative') };
            const prompt = promptOverride || value('prompt');
            const response = await request(`${baseUrl}/api/proxy/novelai/ai/generate-image-stream`, buildPayload(settings, prompt), { Accept: 'text/event-stream', Authorization: `Bearer ${token}`, 'X-User-Token': token });
            const image = parseFinalImage(response);
            lastImage = { image, prompt: prompt.trim() };
            const url = URL.createObjectURL(image.blob);
            field('image').src = url;
            field('image').hidden = false;
            field('download').href = url;
            field('download').download = `paintai_${Date.now()}.${image.format}`;
            field('download').hidden = false;
            field('add').hidden = !context();
            status('生成完成。');
        } catch (error) { status(errorText(error, token), true); }
        finally { setBusy(false); }
    }

    function bindAutoScene() {
        const ctx = context();
        if (sceneBound || !ctx?.eventSource || !ctx.eventTypes?.CHARACTER_MESSAGE_RENDERED) return;
        sceneBound = true;
        ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, messageId => {
            if (!field('autoScene').checked) return;
            const message = ctx.chat?.[Number(messageId)];
            if (!message || message.is_user || message.is_system) return;
            for (const prompt of extractPrompts(message.mes)) {
                const key = `${messageId}:${prompt}`;
                if (!seenScenes.has(key)) { seenScenes.add(key); void generate(prompt); }
            }
        });
    }

    function init() {
        if (document.querySelector('#paintai-mobile-panel')) return;
        root = document.createElement('section');
        root.id = 'paintai-mobile-panel';
        root.innerHTML = `<details open><summary>PaintAI 手机出图</summary><div class="paintai-mobile-body">
          <label>服务地址<input data-paintai="baseUrl" type="url"></label>
          <label>项目 Token<input data-paintai="token" type="password" autocomplete="off"></label>
          <label>画面提示词<textarea data-paintai="prompt" rows="3" placeholder="1girl, garden, sunlight"></textarea></label>
          <label>模型<select data-paintai="model">${MODELS.map(x => `<option>${x}</option>`).join('')}</select></label>
          <label>尺寸<select data-paintai="resolution">${SIZES.map(x => `<option>${x}</option>`).join('')}</select></label>
          <label>采样器<select data-paintai="sampler">${SAMPLERS.map(x => `<option>${x}</option>`).join('')}</select></label>
          <label>步数<input data-paintai="steps" type="number" min="1" max="28" value="28"></label>
          <label>CFG<input data-paintai="scale" type="number" min="1" max="30" step="0.1" value="5"></label>
          <label>种子<input data-paintai="seed" type="number" value="-1"></label>
          <label>负面提示词<textarea data-paintai="negative" rows="2">blurry, lowres, worst quality, bad quality, jpeg artifacts, watermark, logo</textarea></label>
          <label class="paintai-mobile-check"><input data-paintai="autoScene" type="checkbox">检测到图片标签后自动生成</label>
          <div class="paintai-mobile-actions"><button data-paintai="check">检查额度</button><button data-paintai="generate">生成图片</button><button data-paintai="add" hidden>加入当前聊天</button></div>
          <p data-paintai="status">填写 Token 后检查额度。</p><img data-paintai="image" hidden alt="PaintAI 生成图片"><a data-paintai="download" hidden>下载图片</a>
        </div></details>`;
        document.body.append(root);
        const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        field('baseUrl').value = stored.baseUrl || DEFAULT_URL;
        field('model').value = stored.model || MODELS[0]; field('resolution').value = stored.resolution || SIZES[0]; field('sampler').value = SAMPLERS[0];
        field('baseUrl').addEventListener('change', () => localStorage.setItem(SETTINGS_KEY, JSON.stringify({ baseUrl: value('baseUrl'), model: value('model'), resolution: value('resolution') })));
        field('check').onclick = async () => { let token = ''; try { const url = normalizeUrl(value('baseUrl')); token = normalizeToken(value('token')); const data = JSON.parse(await request(`${url}/api/tokens/check`, { token }, { Accept: 'application/json' }, 20000)); if (data.valid !== true) throw new Error(data.message || 'Token 无效或额度不足。'); status(`连接正常，剩余 ${data.remaining ?? data.quota ?? '未知'} 点。`); } catch (error) { status(errorText(error, token), true); } };
        field('generate').onclick = () => void generate();
        field('add').onclick = async () => { try { if (!lastImage) throw new Error('还没有生成图片。'); await addToChat(lastImage.image, lastImage.prompt); status('图片已加入当前聊天。'); } catch (error) { status(errorText(error), true); } };
        field('autoScene').addEventListener('change', bindAutoScene); field('download').textContent = '下载图片';
        bindAutoScene();
    }

    const style = document.createElement('style');
    style.textContent = `#paintai-mobile-panel{position:fixed;z-index:2147483647;right:8px;bottom:8px;width:min(360px,calc(100vw - 16px));font:14px sans-serif;color:#111827}#paintai-mobile-panel details{background:#fff;border:1px solid #94a3b8;border-radius:10px;box-shadow:0 4px 18px #0003;overflow:hidden}#paintai-mobile-panel summary{padding:11px;font-weight:700;cursor:pointer;background:#eff6ff}#paintai-mobile-panel .paintai-mobile-body{padding:10px;max-height:78vh;overflow:auto}#paintai-mobile-panel label{display:block;margin:7px 0}#paintai-mobile-panel input,#paintai-mobile-panel textarea,#paintai-mobile-panel select{box-sizing:border-box;width:100%;margin-top:4px;padding:7px;border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#111827}#paintai-mobile-panel .paintai-mobile-check{display:flex;gap:6px;align-items:center}#paintai-mobile-panel .paintai-mobile-check input{width:auto;margin:0}#paintai-mobile-panel button,#paintai-mobile-panel a{display:inline-block;margin:4px 4px 4px 0;padding:8px 10px;border:0;border-radius:6px;background:#2563eb;color:#fff;text-decoration:none;cursor:pointer}#paintai-mobile-panel button:disabled{opacity:.5}#paintai-mobile-panel p{margin:8px 0;color:#334155}#paintai-mobile-panel p[data-error="true"]{color:#b91c1c}#paintai-mobile-panel img{display:block;width:100%;margin-top:8px;border-radius:6px}`;
    document.head.append(style);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
