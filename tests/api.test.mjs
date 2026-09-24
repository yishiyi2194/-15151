import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, buildPayload, normalizeBaseUrl, normalizeToken, readImageStream, bridgeRequest, safeError } from '../extension/api.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
function stream(text, chunkSize = 1) {
    const data = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(c) {
        for (let i = 0; i < data.length; i += chunkSize) c.enqueue(data.slice(i, i + chunkSize));
        c.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
}
const final = `data: ${JSON.stringify({ event_type: 'final', image: PNG })}\n\n`;

test('项目参数、随机种子及范围保持后端契约', () => {
    const p = buildPayload(DEFAULTS, ' garden ', () => 19);
    assert.equal(p.input, 'garden'); assert.equal(p.parameters.seed, 19);
    assert.equal(p.parameters.width, 832); assert.equal(p.parameters.n_samples, 1);
    assert.equal(p.parameters.v4_prompt.caption.base_caption, 'garden');
    for (const invalid of [{ steps: 29 }, { steps: 1.5 }, { scale: NaN }, { seed: -2 }, { resolution: '512x512' }]) {
        assert.throws(() => buildPayload({ ...DEFAULTS, ...invalid }, 'a'));
    }
});
test('URL 校验拒绝带路径、凭证或非HTTPS，并去除token前缀', () => {
    assert.equal(normalizeBaseUrl(' https://example.com:19088/ '), 'https://example.com:19088');
    for (const u of ['http://example.com', 'https://a:b@example.com', 'https://example.com/api', 'https://example.com/?token=a']) assert.throws(() => normalizeBaseUrl(u));
    assert.equal(normalizeToken('Bearer fakeheader.fakepayload.fakesignature'), 'fakeheader.fakepayload.fakesignature');
});
test('逐字节 UTF-8、CRLF、多行data与注释解析最终图片', async () => {
    const intermediate = ': heartbeat\r\ndata: {"event_type":"intermediate",\r\ndata: "step":3,"message":"生成中"}\r\n\r\n';
    const progress = [];
    const image = await readImageStream(stream(intermediate + final.replaceAll('\n', '\r\n')), { onProgress: p => progress.push(p) });
    assert.equal(image.base64, PNG); assert.equal(image.format, 'png'); assert.equal(progress[0].step, 3);
});
test('错误事件不会被后续final掩盖', async () => {
    await assert.rejects(readImageStream(stream('data: {"event_type":"error","message":"额度不足"}\n\n' + final)), /额度不足/);
});
test('只有中间图或截断final都不算生成成功', async () => {
    for (const data of [`data: {"event_type":"intermediate","image":"${PNG}"}\n\n`, final.trimEnd(), 'data: {bad}\n\n']) {
        await assert.rejects(readImageStream(stream(data)));
    }
});
test('取消覆盖响应体等待并取消reader', async () => {
    let cancelled = false;
    const c = new AbortController();
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    const p = readImageStream(response, { signal: c.signal });
    c.abort(new Error('用户取消'));
    await assert.rejects(p, /用户取消/); assert.equal(cancelled, true);
});
test('无效图片和HTML登录页不能作为图片成功', async () => {
    await assert.rejects(readImageStream(new Response('<html>login</html>')), /事件流/);
    await assert.rejects(readImageStream(stream('data: {"event_type":"final","image":"YWJj"}\n\n')), /PNG/);
});
test('同源请求保留CSRF，404有安装提示，错误不回显Token', async () => {
    let request;
    await bridgeRequest('check', { token: 'fake-secret' }, { headers: { 'X-CSRF-Token': 'csrf' }, fetchImpl: async (url, init) => {
        request = { url, init }; return Response.json({ valid: true });
    } });
    assert.equal(request.url, '/api/plugins/paintai-bridge/check');
    assert.equal(request.init.headers['X-CSRF-Token'], 'csrf');
    await assert.rejects(bridgeRequest('generate', {}, { fetchImpl: async () => new Response('', { status: 404 }) }), /未加载/);
    await assert.rejects(bridgeRequest('check', { token: 'fake-secret' }, { fetchImpl: async () => Response.json({ error: 'bad fake-secret' }, { status: 401 }) }), /bad \[已隐藏\]/);
    assert.equal(safeError('bad fake-secret', 'fake-secret'), 'bad [已隐藏]');
});
