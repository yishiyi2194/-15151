export function chatKey(context) {
    const id = context.getCurrentChatId?.() ?? context.chatId;
    if (id === undefined || id === null || id === '') return null;
    return JSON.stringify([context.groupId ?? null, context.characterId ?? null, id]);
}

/** 使用酒馆公开 context 和图片上传 API，不持有或改写其他聊天的内部状态。 */
export async function saveImageToChat({ image, prompt, seed, targetKey, getContext, upload, verifySaved, isCurrent = () => true }) {
    if (!targetKey || chatKey(getContext()) !== targetKey || !isCurrent()) return { changed: true };
    const filename = `paintai_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const path = await upload(image.base64, 'PaintAI', filename, image.format);
    const context = getContext();
    if (chatKey(context) !== targetKey || !isCurrent()) return { changed: true, path };
    // 1.13.3 使用 extra.image；新版本通过官方迁移逻辑识别此字段。
    const message = {
        name: 'PaintAI', is_user: false, is_system: true, send_date: new Date().toISOString(), mes: '',
        extra: { image: path, title: prompt, inline_image: false, paintai: { prompt, seed } },
    };
    const savedTarget = {
        groupId: context.groupId, chatId: context.getCurrentChatId?.() ?? context.chatId,
        character: context.characters?.[context.characterId], headers: context.getRequestHeaders?.(),
    };
    context.chat.push(message);
    try {
        context.addOneMessage(message);
        // 先持久化再发送可让其他扩展切换聊天的异步事件。
        let timer;
        try {
            await Promise.race([
                context.saveChat(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('聊天保存超时。')), 20000); }),
            ]);
        } finally { clearTimeout(timer); }
        // 1.13.3 的 saveChat 会吞掉网络失败，必须读回目标文件才宣告已保存。
        await verifySaved(savedTarget, path);
    } catch {
        if (!isCurrent() && !getContext().chat.includes(message)) return { changed: true, path };
        const error = new Error('图片消息已加入当前会话，但酒馆保存失败。请保留下载图片并检查酒馆连接，避免重复插入。');
        error.chatAppended = true;
        throw error;
    }
    if (chatKey(getContext()) === targetKey && isCurrent()) {
        const id = context.chat.indexOf(message);
        try {
            await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, id, 'extension');
            if (chatKey(getContext()) === targetKey && isCurrent()) {
                await context.eventSource.emit(context.eventTypes.CHARACTER_MESSAGE_RENDERED, id, 'extension');
            }
        } catch { /* 图片已持久化，其他扩展的通知失败不应重复出图。 */ }
    }
    return { path, message };
}

/** 官方 saveBase64AsFile 使用同一上传接口，但不支持超时参数。 */
export async function uploadImage(base64, subFolder, filename, format, headers, fetchImpl = fetch) {
    const response = await fetchImpl('/api/images/upload', {
        method: 'POST', headers, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ image: base64, ch_name: subFolder, filename, format }),
    });
    if (!response.ok) throw new Error(`酒馆图片上传失败（HTTP ${response.status}）。`);
    const data = await response.json();
    if (typeof data.path !== 'string' || !data.path.startsWith('/') || data.path.startsWith('//')) {
        throw new Error('酒馆没有返回有效的本地图片路径。');
    }
    return data.path;
}

export async function verifyChatImage(target, imagePath, fetchImpl = fetch) {
    const group = target.groupId !== null && target.groupId !== undefined && target.groupId !== '';
    const body = group ? { id: target.chatId } : {
        ch_name: target.character?.name, avatar_url: target.character?.avatar, file_name: target.chatId,
    };
    const response = await fetchImpl(group ? '/api/chats/group/get' : '/api/chats/get', {
        method: 'POST', headers: target.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('无法确认聊天保存状态。');
    const messages = await response.json();
    if (!Array.isArray(messages) || !messages.some(m => m.extra?.image === imagePath || m.extra?.media?.some(a => a.url === imagePath))) {
        throw new Error('聊天文件中未找到本次图片。');
    }
}
