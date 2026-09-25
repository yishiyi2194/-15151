import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../paintai-mobile.user.js', import.meta.url), 'utf8');

test('手机用户脚本包含可安装的 Violentmonkey 元数据', () => {
    assert.match(source, /^\/\/ ==UserScript==/m);
    assert.match(source, /@grant\s+GM_xmlhttpRequest/);
    assert.match(source, /@connect\s+www\.r67831767\.nyat\.app/);
    assert.match(source, /@match\s+\*:\/\/\*\/\*/);
});

test('手机用户脚本渲染采样器并保留令牌脱敏边界', () => {
    assert.match(source, /data-paintai="sampler"/);
    assert.match(source, /Authorization:\s+`Bearer \$\{token\}`/);
    assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*token/i);
});

test('手机用户脚本只把明确图片标签交给自动出图', () => {
    assert.match(source, /paintai\|绘图\|文生图\|插图\|image/);
    assert.match(source, /event\.event_type === 'error'/);
    assert.match(source, /event\.event_type === 'final'/);
});
