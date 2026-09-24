import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImagePrompts, extractImagePromptsFromMessage, scenePromptKey } from '../extension/scene.js';

test('只提取明确的 PaintAI 图片标记并去重', () => {
    const text = '普通叙事不会触发。\n[[paintai: 1girl, garden, sunlight]]\n[paintai: 1girl, garden, sunlight]\n【文生图】 city at night';
    assert.deepEqual(extractImagePrompts(text, 3), [
        '1girl, garden, sunlight',
        'city at night',
    ]);
});

test('支持 XML 标记、多行内容和最大数量限制', () => {
    const text = '<paintai>1girl,\nwhite dress</paintai>\n[[image: forest]]\n[[paintai: beach]]';
    assert.deepEqual(extractImagePrompts(text, 2), ['1girl, white dress', 'forest']);
});

test('用户消息和系统图片消息不会自动触发', () => {
    assert.deepEqual(extractImagePromptsFromMessage({ is_user: true, mes: '[[paintai: user]]' }), []);
    assert.deepEqual(extractImagePromptsFromMessage({ is_system: true, mes: '[[paintai: system]]' }), []);
    assert.deepEqual(extractImagePromptsFromMessage({ is_user: false, mes: '[[paintai: assistant]]' }), ['assistant']);
});

test('场景指纹区分聊天、消息和提示词', () => {
    assert.equal(scenePromptKey('chat', 2, 'a'), 'chat:2:a');
    assert.notEqual(scenePromptKey('chat', 2, 'a'), scenePromptKey('chat', 3, 'a'));
});
