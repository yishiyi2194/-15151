const MAX_PROMPT_LENGTH = 12000;
const DEFAULT_MAX_PROMPTS = 1;
const MARKER = '(?:paintai|绘图|文生图|插图|image)';
function cleanPrompt(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/```(?:paintai|绘图|文生图|image)?/gi, '').replace(/```/g, '').replace(/^s*[-*]s+/, '').replace(/s+/g, ' ').trim().slice(0, MAX_PROMPT_LENGTH);
}
function addPrompt(result, value, maxPrompts) {
    const prompt = cleanPrompt(value);
    if (!prompt || result.includes(prompt) || result.length >= maxPrompts) return;
    result.push(prompt);
}
export function extractImagePrompts(text, maxPrompts = DEFAULT_MAX_PROMPTS) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const limit = Math.max(1, Math.min(3, Number(maxPrompts) || DEFAULT_MAX_PROMPTS));
    const result = [];
    const patterns = [
        new RegExp('\\[\\[\\s*' + MARKER + '\\s*[:：]\\s*([\\s\\S]*?)\\s*\\]\\]', 'gi'),
        new RegExp('\\[\\s*' + MARKER + '\\s*[:：]\\s*([^\\]\\n]+?)\\s*\\]', 'gi'),
        new RegExp('【\\s*' + MARKER + '\\s*】\\s*[:：-]?\\s*([^\\n]+)', 'gi'),
        new RegExp('<(?:paintai|image)\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/(?:paintai|image)>', 'gi'),
        new RegExp('(?:^|\\n)\\s*' + MARKER + '\\s*[:：]\\s*([^\\n]+)', 'gim'),
    ];
    const matches = [];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) matches.push({ index: match.index ?? 0, value: match[1] });
    matches.sort((a, b) => a.index - b.index);
    for (const match of matches) {
        addPrompt(result, match.value, limit);
        if (result.length >= limit) return result;
    }
    return result;
}
export function extractImagePromptsFromMessage(message, maxPrompts = DEFAULT_MAX_PROMPTS) {
    if (!message || message.is_user || message.is_system) return [];
    return extractImagePrompts(message.mes, maxPrompts);
}
export function scenePromptKey(chat, messageId, prompt) {
    return String(chat || 'no-chat') + ':' + String(messageId) + ':' + prompt;
}
