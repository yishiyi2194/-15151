import { deflateSync } from 'node:zlib';
export const TEST_ORIGIN = 'https://paintai-fixture.invalid';
export const TEST_TOKEN = 'fixtureheader.fixturepayload.fixturesignature';

function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
}
function fixturePng() {
    const width = 320, height = 400, raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sun = (x - 221) ** 2 + (y - 110) ** 2 < 44 ** 2;
            const hill = y > 280 - 60 * Math.sin(x / 85);
            const line = x % 40 === 0 || y % 40 === 0;
            const color = sun ? [243, 191, 101] : hill ? [27, 87, 91] : line ? [63, 80, 106] : [35, 51, 75];
            const offset = y * (width * 3 + 1) + 1 + x * 3;
            raw.set(color, offset);
        }
    }
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const image = fixturePng();
/** 此入口仅在隔离验证环境安装，不打包进用户插件。完全不联网。 */
export async function mockFetch(url, options) {
    if (!url.startsWith(TEST_ORIGIN + '/')) throw new Error('Fixture refuses external traffic');
    if (url.endsWith('/api/tokens/check')) {
        const valid = JSON.parse(options.body).token === TEST_TOKEN;
        return Response.json({ valid, remaining: valid ? 100 : 0, quota: 100, used: 0, message: valid ? '' : '模拟 Token 无效' });
    }
    if (options.headers.Authorization !== `Bearer ${TEST_TOKEN}` || options.headers['X-User-Token'] !== TEST_TOKEN) {
        return new Response('', { status: 401 });
    }
    const payload = JSON.parse(options.body);
    const failure = payload.input.includes('fixture-error'), slow = payload.input.includes('fixture-slow');
    let timer, listener, closed = false;
    return new Response(new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            const send = event => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            send({ event_type: 'intermediate', step: 1, image });
            const finish = () => {
                if (closed) return;
                send(failure ? { event_type: 'error', message: '模拟上游失败' } : { event_type: 'final', image });
                closed = true; controller.close(); options.signal.removeEventListener('abort', listener);
            };
            listener = () => { clearTimeout(timer); if (!closed) { closed = true; controller.error(new Error('Fixture aborted')); } };
            options.signal.addEventListener('abort', listener, { once: true });
            timer = setTimeout(finish, slow ? 45000 : 1200);
        },
        cancel() { closed = true; clearTimeout(timer); options.signal.removeEventListener('abort', listener); },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
}
