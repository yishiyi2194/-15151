import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHandlers, init, info, normalizeOrigin } from '../index.mjs';

const ORIGIN = 'https://paintai.example:19088';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const encoder = new TextEncoder();
const finalEvent = 'data: {"event_type":"final","image":"aW1hZ2U="}\n\n';

function payload() {
  return {
    action: 'generate', input: 'a small lighthouse', model: 'nai-diffusion-4-5-full',
    parameters: {
      params_version: 3, width: 832, height: 1216, n_samples: 1,
      sampler: 'k_dpmpp_2m', steps: 28, scale: 5, seed: 42,
      negative_prompt: '', noise_schedule: 'karras', qualityToggle: true,
      v4_prompt: { caption: { base_caption: 'a small lighthouse', char_captions: [], use_coords: false }, use_order: true },
      v4_negative_prompt: { caption: { base_caption: '', char_captions: [], legacy_uc: false }, legacy_uc: false },
    },
    use_new_shared_trial: true,
  };
}

function request(generate = true, overrides = {}) {
  const req = new EventEmitter();
  req.body = { baseUrl: ORIGIN, token: TOKEN, ...(generate ? { payload: payload() } : {}), ...overrides };
  return req;
}

class ResponseRecorder extends EventEmitter {
  statusCode = 200;
  headers = {};
  chunks = [];
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  blockedWrites = 0;
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  flushHeaders() { this.headersSent = true; }
  write(chunk) {
    this.headersSent = true;
    this.chunks.push(String(chunk));
    if (this.blockedWrites > 0) { this.blockedWrites--; return false; }
    return true;
  }
  end(chunk) {
    if (chunk) this.write(chunk);
    this.writableEnded = true;
    this.emit('close');
  }
  disconnect() { this.destroyed = true; this.emit('close'); }
  get text() { return this.chunks.join(''); }
  get json() { return JSON.parse(this.text); }
}

function handlers(fetchImpl, options = {}) {
  return createHandlers({ allowedOrigins: [ORIGIN], fetchImpl, ...options });
}

function stream(chunks, { close = true, cancel } = {}) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
    cancel,
  });
}

function sse(chunks = [finalEvent], options = {}) {
  return new Response(stream(chunks, options), { headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'private=1' } });
}

test('加载契约和 health 不访问上游', async () => {
  assert.equal(info.id, 'paintai-bridge');
  const routes = [];
  await init({ get: (path, handler) => routes.push(['GET', path, handler]), post: (path, handler) => routes.push(['POST', path, handler]) });
  assert.deepEqual(routes.map(route => route.slice(0, 2)), [['GET', '/health'], ['POST', '/check'], ['POST', '/generate']]);
  const res = new ResponseRecorder();
  handlers(() => assert.fail('不应请求上游')).health(request(false), res);
  assert.deepEqual(res.json, { ok: true, version: '1.0.0' });
});

test('HTTPS 来源严格校验，允许根尾斜杠但拒绝路径、凭据、查询和混淆', async () => {
  assert.equal(normalizeOrigin(`${ORIGIN}/`), ORIGIN);
  for (const baseUrl of [
    'http://paintai.example:19088', `${ORIGIN}/api`, `${ORIGIN}/../`, `${ORIGIN}?x=1`,
    `${ORIGIN}#x`, `${ORIGIN}/?`, 'https://user:pass@paintai.example:19088',
    'https://paintai.example:19088\\@attacker.example', `${ORIGIN} `,
    'https://paintai.example:19088.evil.example', 'https://paintai.example:19089',
  ]) {
    const res = new ResponseRecorder();
    await handlers(() => assert.fail('非法来源不可请求上游')).generate(request(true, { baseUrl }), res);
    assert.ok([400, 403].includes(res.statusCode), baseUrl);
  }
});

test('生成固定路径及两个鉴权头，禁止重定向；响应仅保留明确头', async () => {
  let calls = 0;
  const req = request();
  const res = new ResponseRecorder();
  await handlers(async (url, options) => {
    calls++;
    assert.equal(url, `${ORIGIN}/api/proxy/novelai/ai/generate-image-stream`);
    assert.deepEqual(options.headers, {
      'Content-Type': 'application/json', Accept: 'text/event-stream',
      Authorization: `Bearer ${TOKEN}`, 'X-User-Token': TOKEN,
    });
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), req.body.payload);
    return sse(['data: {"event_type":"intermediate","image":"cHJldmlldw=="}\n\n', finalEvent]);
  }).generate(req, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.match(res.text, /"event_type":"final"/);
});

test('查询只传额度检查字段，限制响应字段并对消息脱敏', async () => {
  const res = new ResponseRecorder();
  await handlers(async (url, options) => {
    assert.equal(url, `${ORIGIN}/api/tokens/check`);
    assert.deepEqual(JSON.parse(options.body), { token: TOKEN });
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ valid: true, remaining: 9, quota: 10, used: 1, token: TOKEN, account: 'private', message: `ok ${TOKEN}` });
  }).check(request(false), res);
  assert.deepEqual(res.json, { valid: true, remaining: 9, quota: 10, used: 1, message: 'ok [已隐藏]' });
  assert.ok(!res.text.includes(TOKEN));
});

test('拒绝无效 Token、超大请求、附加地址、参考图与非单张文生图', async () => {
  const mutations = [
    body => { body.token = ''; }, body => { body.token = `Bearer ${TOKEN}`; },
    body => { body.token = `${TOKEN}\r\nX-Foo: bar`; },
    body => { body.url = 'https://attacker.example'; },
    body => { body.payload.action = 'img2img'; },
    body => { body.payload.parameters.image = 'aW1hZ2U='; },
    body => { body.payload.parameters.n_samples = 2; },
    body => { body.payload.parameters.width = 999; },
    body => { body.payload.parameters.height = 2048; },
    body => { body.payload.parameters.steps = 29; },
    body => { body.payload.parameters.scale = 31; },
    body => { body.payload.parameters.seed = -1; },
    body => { body.payload.parameters.scale = NaN; },
    body => { body.payload.model = 'other'; },
    body => { body.payload.parameters.v4_prompt.caption.char_captions.push({}); },
    body => { body.payload.input = 'a'.repeat(16001); },
    body => { body.payload.input = 'a'.repeat(600000); },
  ];
  for (const mutate of mutations) {
    const req = request();
    mutate(req.body);
    const res = new ResponseRecorder();
    await handlers(() => assert.fail('非法参数不可请求上游')).generate(req, res);
    assert.ok([400, 413].includes(res.statusCode), res.text);
  }
});

test('上游支持的五种分辨率、CFG30和重复中文提示词均可通过', async () => {
  for (const [width, height] of [[832, 1216], [1216, 832], [1024, 1024], [1024, 768], [512, 768]]) {
    const req = request();
    Object.assign(req.body.payload.parameters, { width, height, scale: 30, steps: 28 });
    req.body.payload.input = '中文'.repeat(6000);
    req.body.payload.parameters.negative_prompt = '负面'.repeat(6000);
    req.body.payload.parameters.v4_prompt.caption.base_caption = req.body.payload.input;
    req.body.payload.parameters.v4_negative_prompt.caption.base_caption = req.body.payload.parameters.negative_prompt;
    const res = new ResponseRecorder();
    await handlers(async () => sse()).generate(req, res);
    assert.equal(res.statusCode, 200, res.text);
    assert.match(res.text, /"event_type":"final"/);
  }
});

test('上游非成功状态保留状态码，不回显错误体和 Token，且不重试', async () => {
  for (const status of [401, 402, 403, 429, 500, 503, 302]) {
    let calls = 0;
    const res = new ResponseRecorder();
    await handlers(async () => { calls++; return new Response(`secret ${TOKEN}`, { status }); }).generate(request(), res);
    assert.equal(calls, 1);
    assert.equal(res.statusCode, status === 302 ? 502 : status);
    assert.equal(typeof res.json.error, 'string');
    assert.ok(!res.text.includes(TOKEN));
  }
});

test('网络异常或非 SSE 响应在发头前返回 502', async () => {
  for (const fetchImpl of [async () => { throw new Error(TOKEN); }, async () => Response.json({ data: TOKEN })]) {
    const res = new ResponseRecorder();
    await handlers(fetchImpl).generate(request(), res);
    assert.equal(res.statusCode, 502);
    assert.ok(!res.text.includes(TOKEN));
    assert.match(res.headers['content-type'], /application\/json/);
  }
});

test('流中断及无 final 的截断以 SSE 错误结束', async () => {
  const broken = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('data: {"event_type":"intermediate"}\n\n')); },
    pull(controller) { controller.error(new Error(TOKEN)); },
  });
  for (const response of [
    sse(['data: {"event_type":"intermediate"}\n\n']),
    sse(['data: {"event_type":"final","image":"truncated']),
    sse(['data: {"event_type":"final","image":"truncated\n\n']),
    new Response(broken, { headers: { 'Content-Type': 'text/event-stream' } }),
  ]) {
    const res = new ResponseRecorder();
    await handlers(async () => response).generate(request(), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.text, /"event_type":"error"/);
    assert.ok(!res.text.includes(TOKEN));
    assert.equal(res.writableEnded, true);
  }
});

test('SSE 脱敏支持 Token 跨块，final 标记跨块仍被识别', async () => {
  const res = new ResponseRecorder();
  await handlers(async () => sse([
    'data: {"event_type":"intermediate","message":"' + TOKEN.slice(0, 10),
    TOKEN.slice(10) + '"}\n\ndata: {"eve', 'nt_type":"fi', 'nal","image":"aW1hZ2U="}\n\n',
  ])).generate(request(), res);
  assert.ok(!res.text.includes(TOKEN));
  assert.match(res.text, /已隐藏/);
  assert.ok(!res.text.includes('"event_type":"error"'));
});

test('背压停止上游读取，drain 后继续', async () => {
  let readCount = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      readCount++;
      controller.enqueue(encoder.encode(readCount === 1 ? 'data: {"event_type":"intermediate"}\n\n' : finalEvent));
      if (readCount === 2) controller.close();
    },
  }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'text/event-stream' } });
  const res = new ResponseRecorder();
  res.blockedWrites = 1;
  const pending = handlers(async () => response).generate(request(), res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readCount, 1);
  assert.equal(res.writableEnded, false);
  res.emit('drain');
  await pending;
  assert.equal(readCount, 2);
});

test('超时覆盖 fetch 前后和完整响应体，取消读取并返回正确错误格式', async () => {
  const before = new ResponseRecorder();
  let fetchSignal;
  await handlers((_url, options) => { fetchSignal = options.signal; return new Promise(() => {}); }, { generateTimeoutMs: 20 }).generate(request(), before);
  assert.equal(before.statusCode, 504);
  assert.equal(fetchSignal.aborted, true);

  let bodyCancelled = false;
  const after = new ResponseRecorder();
  await handlers(async () => sse([], { close: false, cancel: () => { bodyCancelled = true; } }), { generateTimeoutMs: 20 }).generate(request(), after);
  assert.equal(after.statusCode, 200);
  assert.match(after.text, /"code":504/);
  assert.equal(bodyCancelled, true);

  const check = new ResponseRecorder();
  await handlers(async () => new Response(stream([], { close: false })), { checkTimeoutMs: 20 }).check(request(false), check);
  assert.equal(check.statusCode, 504);
});

test('客户端关闭取消上游且不再写错误', async () => {
  const res = new ResponseRecorder();
  let upstreamSignal;
  let bodyCancelled = false;
  const pending = handlers(async (_url, options) => {
    upstreamSignal = options.signal;
    return sse([], { close: false, cancel: () => { bodyCancelled = true; } });
  }).generate(request(), res);
  await new Promise(resolve => setImmediate(resolve));
  res.disconnect();
  await pending;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(bodyCancelled, true);
  assert.equal(res.text, '');
});

test('额度响应大小和 JSON 格式受限', async () => {
  for (const response of [new Response('x'.repeat(70000)), Response.json({ token: TOKEN }), new Response('not-json')]) {
    const res = new ResponseRecorder();
    await handlers(async () => response).check(request(false), res);
    assert.equal(res.statusCode, 502);
    assert.ok(!res.text.includes(TOKEN));
  }
});
