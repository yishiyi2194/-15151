import { DEFAULTS, MODELS, SIZES, SAMPLERS, normalizeBaseUrl, normalizeToken, buildPayload, decodeImage, readImageStream, bridgeRequest, safeError } from './api.js';
import { chatKey, saveImageToChat, verifyChatImage, uploadImage } from './chat.js';
import { extractImagePrompts, extractImagePromptsFromMessage, scenePromptKey } from './scene.js';

const KEY = 'paintai_bridge';
const context = () => SillyTavern.getContext();
let root, activeController, lastResult, previewUrl, chatEpoch = 0, enabled = true, busy = false;
let sceneRunning = false;
let sceneQueue = [];
const seenScenePrompts = new Set();
const $ = name => root.querySelector(`[data-field="${name}"]`);
const status = (text, error = false) => {
    $('status').textContent = text;
    $('status').classList.toggle('paintai-error', error);
};

function settings() {
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        const field = $(key);
        result[key] = field.type === 'checkbox' ? field.checked : field.value;
    }
    return result;
}

function saveSettings() {
    const persisted = settings();
    delete persisted.token;
    context().extensionSettings[KEY] = persisted;
    context().saveSettingsDebounced();
}

function connection() {
    return { baseUrl: normalizeBaseUrl($('baseUrl').value), token: normalizeToken($('token').value) };
}

function setBusy(value, cancelable = true) {
    busy = value;
    root.setAttribute('aria-busy', String(value));
    $('fields').disabled = value;
    $('generate').disabled = value;
    $('check').disabled = value;
    $('cancel').hidden = !value || !cancelable;
    $('add').disabled = value || !lastResult || lastResult.added;
    $('read').disabled = value;
}

function preview(image, final = false) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(image.blob);
    $('image').src = previewUrl;
    $('preview').hidden = false;
    $('previewLabel').textContent = final ? '生成结果' : '生成预览';
    $('download').hidden = !final;
    $('add').hidden = !final;
    if (final) {
        $('download').href = previewUrl;
        $('download').download = `paintai_${Date.now()}.${image.format}`;
    }
}

async function checkQuota() {
    if (busy || !enabled) return;
    let token = '';
    activeController = new AbortController();
    const controller = activeController;
    const timer = setTimeout(() => controller.abort(new Error('额度检查超时。')), 25000);
    setBusy(true);
    status('正在检查连接与额度…');
    try {
        const config = connection(); token = config.token;
        const response = await bridgeRequest('check', config, { headers: context().getRequestHeaders(), signal: controller.signal });
        const data = await response.json();
        controller.signal.throwIfAborted();
        if (data.valid !== true) throw new Error(data.message || 'Token 无效、过期或已被撤销。');
        $('quota').textContent = `剩余 ${data.remaining} 点`;
        status(`连接正常，剩余 ${data.remaining} 点。检查额度不扣费。`);
    } catch (error) {
        status(safeError(controller.signal.aborted ? controller.signal.reason : error, token), true);
    } finally {
        clearTimeout(timer); activeController = null; setBusy(false);
    }
}

async function addToChat(targetKey = chatKey(context()), epoch = chatEpoch) {
    if (!lastResult || lastResult.added) return '';
    if (!targetKey) throw new Error('请先打开一个角色或群组聊天；图片可以先下载。');
    const result = await saveImageToChat({
        image: lastResult.image, prompt: lastResult.prompt, seed: lastResult.seed,
        targetKey, getContext: context,
        upload: (base64, folder, filename, format) => uploadImage(base64, folder, filename, format, context().getRequestHeaders()),
        verifySaved: verifyChatImage,
        isCurrent: () => chatEpoch === epoch && enabled,
    });
    if (result.changed) {
        status('聊天已切换，图片保留在这里。确认当前聊天后可点击“加入当前聊天”。');
    } else {
        lastResult.added = true;
        $('add').disabled = true;
        status(`图片已保存到聊天。种子 ${lastResult.seed}`);
    }
    return result.path || '';
}

async function generate(promptOverride) {
    if (busy || !enabled) { status('已有任务正在进行，请等待完成或取消。', true); return ''; }
    let token = '', saving = false;
    activeController = new AbortController();
    const controller = activeController;
    const timer = setTimeout(() => controller.abort(new Error('生成超过 5 分钟，已停止等待；请先检查额度再决定是否重试。')), 300000);
    setBusy(true);
    try {
        const config = connection(); token = config.token;
        const options = settings();
        const prompt = typeof promptOverride === 'string' ? promptOverride : $('prompt').value;
        const payload = buildPayload(options, prompt);
        const target = chatKey(context()), epoch = chatEpoch;
        lastResult = null;
        $('preview').hidden = true; $('add').disabled = true;
        status('正在等待出图…');
        const response = await bridgeRequest('generate', { ...config, payload }, {
            headers: context().getRequestHeaders(), signal: controller.signal,
        });
        const image = await readImageStream(response, {
            signal: controller.signal,
            onProgress: event => {
                if (event.image) preview(decodeImage(event.image));
                status(Number.isFinite(event.step) ? `生成中 · 步骤 ${event.step}` : '正在生成图片…');
            },
        });
        controller.signal.throwIfAborted();
        preview(image, true);
        await $('image').decode();
        controller.signal.throwIfAborted();
        clearTimeout(timer);
        lastResult = { image, prompt: payload.input, seed: payload.parameters.seed, added: false };
        status(`生成完成。种子 ${lastResult.seed}`);
        if (options.autoSend && target) {
            saving = true; setBusy(true, false);
            return await addToChat(target, epoch);
        }
        if (!target) status('生成完成。打开聊天后可加入，或直接下载图片。');
        return '';
    } catch (error) {
        if (error.chatAppended && lastResult) lastResult.added = true;
        const reason = controller.signal.aborted ? controller.signal.reason : error;
        const prefix = saving ? '图片已生成，聊天保存未完成：' : '';
        status(prefix + safeError(reason, token), true);
        if (!lastResult) { $('add').hidden = true; $('download').hidden = true; }
        return '';
    } finally {
        clearTimeout(timer); activeController = null; setBusy(false);
    }
}

function enqueueScenePrompts(prompts, targetKey, messageId) {
    const added = [];
    for (const prompt of prompts) {
        const key = scenePromptKey(targetKey, messageId, prompt);
        if (seenScenePrompts.has(key)) continue;
        seenScenePrompts.add(key);
        sceneQueue.push({ prompt, targetKey, messageId });
        added.push(prompt);
    }
    if (added.length && !sceneRunning) void drainSceneQueue();
    return added;
}

async function drainSceneQueue() {
    if (sceneRunning) return;
    sceneRunning = true;
    try {
        while (sceneQueue.length && enabled) {
            const item = sceneQueue.shift();
            if (!item || item.targetKey !== chatKey(context())) continue;
            $('prompt').value = item.prompt;
            status('检测到图片标签，正在自动出图…');
            await generate(item.prompt);
        }
    } finally {
        sceneRunning = false;
    }
}

function lastAssistantMessage() {
    const messages = context().chat || [];
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message && !message.is_user && !message.is_system && typeof message.mes === 'string') {
            return { message, index };
        }
    }
    return null;
}

function readLatestMessage() {
    const latest = lastAssistantMessage();
    if (!latest) {
        status('当前聊天没有可读取的 AI 回复。', true);
        return [];
    }
    const prompts = extractImagePrompts(latest.message.mes, Number(settings().sceneMaxImages));
    if (!prompts.length) {
        status('最近的 AI 回复没有明确的图片标记。可让世界书输出 [[paintai: ...]]。', true);
        return [];
    }
    $('prompt').value = prompts[0];
    status(`已从最近回复读取 ${prompts.length} 条图片提示词；点击“生成图片”开始。`);
    return prompts;
}

function processRenderedMessage(messageId) {
    const options = settings();
    if (!options.autoScene) return;
    const index = Number(messageId);
    const message = Number.isInteger(index) ? context().chat?.[index] : null;
    if (!message) return;
    const prompts = extractImagePromptsFromMessage(message, Number(options.sceneMaxImages));
    if (!prompts.length) return;
    const added = enqueueScenePrompts(prompts, chatKey(context()), index);
    if (added.length > 1) status(`检测到 ${added.length} 条图片提示词，将按顺序生成。`);
}

export async function init() {
    if (root) return;
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!host) throw new Error('找不到酒馆扩展设置面板。');
    root = document.createElement('section');
    root.id = 'paintai-extension';
    root.innerHTML = `
      <details class="paintai-drawer" open>
        <summary><strong>PaintAI 出图</strong><span data-field="quota">未检查额度</span></summary>
        <div class="paintai-body">
          <fieldset data-field="fields">
            <label>服务地址<input class="text_pole" data-field="baseUrl" type="url" spellcheck="false" autocomplete="off"></label>
            <label>项目 Token<input class="text_pole" data-field="token" type="password" placeholder="粘贴项目签发的 Token" autocomplete="off" spellcheck="false"></label>
            <p class="paintai-hint">Token 只保留在本次页面，刷新后需重新填写。</p>
            <label>画面提示词<textarea class="text_pole" data-field="prompt" rows="4" maxlength="12000" placeholder="例如：1girl, garden, sunlight, anime style"></textarea></label>
            <details class="paintai-parameters">
              <summary>模型与生成参数</summary>
              <label>模型<select class="text_pole" data-field="model"></select></label>
              <div class="paintai-grid">
                <label>尺寸<select class="text_pole" data-field="resolution"></select></label>
                <label>采样器<select class="text_pole" data-field="sampler"></select></label>
                <label>步数<input class="text_pole" data-field="steps" type="number" min="1" max="28" step="1"></label>
                <label>CFG<input class="text_pole" data-field="scale" type="number" min="1" max="30" step="0.1"></label>
              </div>
              <label>种子（-1 为随机）<input class="text_pole" data-field="seed" type="number" min="-1" max="4294967295" step="1"></label>
              <label>负面提示词<textarea class="text_pole" data-field="negative" rows="3" maxlength="12000"></textarea></label>
            </details>
              <label class="paintai-checkbox"><input type="checkbox" data-field="autoSend">完成后加入当前聊天</label>
            <label class="paintai-checkbox"><input type="checkbox" data-field="autoScene">检测到图片标签后自动生成</label>
            <label>每条 AI 回复最多自动生成<input class="text_pole" data-field="sceneMaxImages" type="number" min="1" max="3" step="1"></label>
          </fieldset>
          <div class="paintai-actions">
            <button class="menu_button" type="button" data-field="check">检查连接 / 额度</button>
            <button class="menu_button paintai-primary" type="button" data-field="generate">生成图片</button>
            <button class="menu_button" type="button" data-field="cancel" hidden>取消等待</button>
            <button class="menu_button" type="button" data-field="read">读取最近 AI 回复</button>
          </div>
          <p data-field="status" class="paintai-status" role="status" aria-live="polite">填写 URL 和 Token 后检查连接。也可输入 /paintai 提示词 出图。</p>
          <p class="paintai-hint">自动出图只识别 [[paintai: 提示词]]、【文生图】提示词或 &lt;paintai&gt;提示词&lt;/paintai&gt;。建议配合世界书使用。</p>
          <p class="paintai-hint">出图沿用网站扣额规则；取消等待不保证上游停止或退额。</p>
          <figure data-field="preview" hidden>
            <figcaption data-field="previewLabel">生成结果</figcaption>
            <img data-field="image" alt="PaintAI 生成图片">
            <div class="paintai-actions">
              <a class="menu_button" data-field="download" hidden>下载图片</a>
              <button type="button" class="menu_button" data-field="add" hidden>加入当前聊天</button>
            </div>
          </figure>
        </div>
      </details>`;
    host.append(root);
    for (const [key, values] of Object.entries({ model: MODELS, resolution: SIZES, sampler: SAMPLERS })) {
        values.forEach(value => $(key).add(new Option(value, value)));
    }
    const stored = context().extensionSettings[KEY] || {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
        const field = $(key), value = stored[key] ?? fallback;
        if (field.type === 'checkbox') field.checked = Boolean(value);
        else field.value = value;
        field.addEventListener('change', saveSettings);
    }
    // URL 与 Token 一变，旧额度立即失效，避免把另一账号的额度误显示为当前账号。
    for (const key of ['baseUrl', 'token']) $(key).addEventListener('input', () => { $('quota').textContent = '未检查额度'; });
    $('check').addEventListener('click', checkQuota);
    $('generate').addEventListener('click', () => { void generate(); });
    $('cancel').addEventListener('click', () => activeController?.abort(new Error('已取消等待；上游是否扣额请通过额度检查确认。')));
    $('read').addEventListener('click', () => { readLatestMessage(); });
    $('add').addEventListener('click', async () => {
        setBusy(true, false);
        try { await addToChat(); } catch (error) {
            if (error.chatAppended && lastResult) lastResult.added = true;
            status(safeError(error), true);
        } finally { setBusy(false); }
    });
    const ctx = context();
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => { chatEpoch++; sceneQueue = []; seenScenePrompts.clear(); });
    if (ctx.eventTypes.CHARACTER_MESSAGE_RENDERED) {
        ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, messageId => processRenderedMessage(messageId));
    }
    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'paintai', callback: (_args, value) => generate(String(value || '')),
        unnamedArgumentList: [ctx.SlashCommandArgument.fromProps({
            description: '画面提示词', typeList: [ctx.ARGUMENT_TYPE.STRING], isRequired: true,
        })],
        helpString: '通过 PaintAI 生成图片并保存到聊天。先在扩展设置填写 URL 和 Token。',
    }));
    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'paintai-text', callback: (_args, value) => {
            const prompts = extractImagePrompts(String(value || ''), Number(settings().sceneMaxImages));
            if (!prompts.length) {
                status('文字中没有明确的图片标记。格式示例：[[paintai: 1girl, garden]]。', true);
                return '';
            }
            enqueueScenePrompts(prompts, chatKey(context()), `slash-${Date.now()}`);
            return '';
        },
        unnamedArgumentList: [ctx.SlashCommandArgument.fromProps({
            description: '包含图片标记的文字', typeList: [ctx.ARGUMENT_TYPE.STRING], isRequired: true,
        })],
        helpString: '从文字中提取 [[paintai: ...]] 等标记并生成图片。',
    }));
    window.addEventListener('pagehide', () => {
        enabled = false; activeController?.abort(new Error('页面已关闭。'));
        $('token').value = '';
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    });
}

// 使用 1.13.3 原生扩展加载方式；不依赖较新版本才有的 manifest hooks。
jQuery(() => { void init().catch(error => toastr.error(safeError(error), 'PaintAI')); });
