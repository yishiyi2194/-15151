import test from 'node:test';
import assert from 'node:assert/strict';
import { chatKey, saveImageToChat, verifyChatImage } from '../extension/chat.js';

function setup() {
    const log = [];
    const ctx = { characterId: 0, groupId: null, chatId: 'test', chat: [],
        addOneMessage: () => log.push('render'), saveChat: async () => log.push('save'),
        eventTypes: { MESSAGE_RECEIVED: 'received', CHARACTER_MESSAGE_RENDERED: 'rendered' },
        eventSource: { emit: async e => log.push(e) } };
    const params = { image: { base64: 'test-image', format: 'png' }, prompt: 'garden', seed: 20,
        getContext: () => ctx, targetKey: chatKey(ctx), upload: async () => '/user/images/test.png', verifySaved: async () => {} };
    return { ctx, params, log };
}
test('最终图片经上传后加入聊天并先保存再通知', async () => {
    const { ctx, params, log } = setup();
    const result = await saveImageToChat(params);
    assert.equal(result.path, '/user/images/test.png');
    assert.equal(ctx.chat[0].extra.image, result.path);
    assert.equal(ctx.chat[0].extra.paintai.seed, 20);
    assert.deepEqual(log, ['render', 'save', 'received', 'rendered']);
    assert.ok(!JSON.stringify(ctx.chat).includes('token'));
});
test('上传途中切换聊天不误写新聊天', async () => {
    const { ctx, params } = setup();
    params.upload = async () => { ctx.chatId = 'other'; return '/saved.png'; };
    assert.equal((await saveImageToChat(params)).changed, true);
    assert.equal(ctx.chat.length, 0);
});
test('离开再回来也由epoch拒绝自动插入', async () => {
    const { ctx, params } = setup(); let current = true;
    params.isCurrent = () => current;
    params.upload = async () => { current = false; return '/saved.png'; };
    assert.equal((await saveImageToChat(params)).changed, true); assert.equal(ctx.chat.length, 0);
});
test('上传失败不插入空消息；保存失败明确标记已插入防止重复', async () => {
    const a = setup(); a.params.upload = async () => { throw new Error('upload failed'); };
    await assert.rejects(saveImageToChat(a.params)); assert.equal(a.ctx.chat.length, 0);
    const b = setup(); b.ctx.saveChat = async () => { throw new Error('save failed'); };
    await assert.rejects(saveImageToChat(b.params), e => e.chatAppended === true);
    assert.equal(b.ctx.chat.length, 1);
});
test('宿主吞掉保存错误时，读回缺少图片不会误报成功', async () => {
    const { ctx, params } = setup();
    params.verifySaved = (target, path) => verifyChatImage(target, path, async () => Response.json([]));
    await assert.rejects(saveImageToChat(params), e => e.chatAppended === true);
    assert.equal(ctx.chat.length, 1);
});
test('群组与角色聊天使用自己的读取契约验证图片', async () => {
    for (const groupId of [null, 'group-1']) {
        let request;
        await verifyChatImage({ groupId, chatId: 'c', character: { name: 'n', avatar: 'a.png' }, headers: {} }, '/i.png', async (url, init) => {
            request = { url, body: JSON.parse(init.body) }; return Response.json([{ extra: { image: '/i.png' } }]);
        });
        assert.equal(request.url, groupId ? '/api/chats/group/get' : '/api/chats/get');
        assert.equal(groupId ? request.body.id : request.body.file_name, 'c');
    }
});
