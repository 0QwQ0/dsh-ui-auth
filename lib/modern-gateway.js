import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createModernPolicy, remoteArgs, object, nonempty } from './modern-policy.js';
/**
 * DSH 0.1.2+ transport adapter: slash Remote (`/api/<ns>/<method>`), the
 * `/api/remote.mux` stream mux, and the native browser carrier.
 *
 * Adapted from the DSH 0.1.2 draft (#1) to the reviewed 0.1.5-rc.1 surface and
 * re-verified against 0.2.0-rc.2; the legacy dotted/`apiProxy` path was removed in
 * v0.7.0, so this adapter is the only transport. Design rules kept from that draft:
 * - a plugin-authenticated request is bridged to the native carrier internally,
 *   so the browser never holds the process launch token or the native cookie;
 * - unknown endpoints and unknown events fail closed for ordinary users;
 * - ownership is re-checked on every stream delivery and on logout/role change;
 * - a hidden waterfall recipient is released with `next` so an owner's
 *   interaction cannot be stranded.
 */
const MAX_BODY = 16 * 1024 * 1024;
const MUX_PATH = '/api/remote.mux';
/** Exact `/api` Fetch routes that bypass Remote dispatch (0.1.5 inventory). */
const HOST_CAPABILITY_PATHS = new Set(['/api/file', '/api/present.host', '/api/present.open']);
/** Own-session browser routes whose ownership is the `sessionId` query parameter. */
const SESSION_QUERY_PATHS = new Set(['/api/session.export', '/api/session/uploadFileBinary']);
/** Host-side app opening; never an ordinary-user capability. */
const HOST_OPEN_PREFIX = '/open-in-app/';
const json = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
};
const denial = () => new Error('Access denied');
async function bodyOf(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY)
            throw new Error('Request too large');
        chunks.push(buffer);
    }
    const body = Buffer.concat(chunks);
    return { body, envelope: JSON.parse(body.toString('utf8')) };
}
/** Replay once, preserving IncomingMessage events used by downstream HTTP bridges. */
function replay(req, body) {
    const proxy = Object.create(req);
    proxy[Symbol.asyncIterator] =
        async function* () { if (body.length)
            yield body; };
    return proxy;
}
/** Delay success until ownership has persisted; never forward an unfiltered prefix. */
async function forwardJson(forward, req, res, transform) {
    const original = { writeHead: res.writeHead, write: res.write, end: res.end };
    let status = 200;
    let size = 0;
    const chunks = [];
    const headers = {};
    await new Promise((resolve, reject) => {
        const restore = () => { Object.assign(res, original); };
        const capture = (chunk) => {
            if (chunk === null || chunk === undefined)
                return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > MAX_BODY)
                throw new Error('Response too large');
            chunks.push(buffer);
        };
        res.writeHead = ((code, reason, fields) => {
            status = code;
            Object.assign(headers, typeof reason === 'object' && reason !== null ? reason : fields);
            return res;
        });
        res.write = ((chunk, encoding, callback) => {
            try {
                capture(chunk);
            }
            catch (error) {
                restore();
                reject(error);
                return false;
            }
            if (typeof encoding === 'function')
                encoding();
            else
                callback?.();
            return true;
        });
        res.end = ((chunk, encoding, callback) => {
            void (async () => {
                try {
                    capture(chunk);
                    let body = Buffer.concat(chunks);
                    if (status >= 200 && status < 300) {
                        const envelope = JSON.parse(body.toString('utf8'));
                        if (envelope?.result?.ok === true)
                            envelope.result.value = await transform(envelope.result.value);
                        body = Buffer.from(JSON.stringify(envelope));
                    }
                    restore();
                    // The body is re-serialized here: framing/encoding headers of the original
                    // bytes no longer describe it, so they must not survive the projection.
                    for (const header of ['content-length', 'Content-Length', 'content-encoding', 'Content-Encoding', 'transfer-encoding', 'Transfer-Encoding']) {
                        delete headers[header];
                        res.removeHeader?.(header);
                    }
                    res.writeHead(status, headers);
                    res.end(body);
                    if (typeof encoding === 'function')
                        encoding();
                    else
                        callback?.();
                    resolve();
                }
                catch (error) {
                    restore();
                    reject(error);
                }
            })();
            return res;
        });
        try {
            forward(req, res);
        }
        catch (error) {
            restore();
            reject(error);
        }
        res.once('close', () => { restore(); resolve(); });
    });
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function createModernGateway(ctx, auth) {
    const policy = createModernPolicy(auth, {
        ...(auth.entitlement === undefined ? {} : { entitlement: auth.entitlement }),
    });
    const policies = new Map();
    const principalByRequest = new WeakMap();
    const correlations = new Set();
    const downstreamSockets = new Set();
    const principal = (req) => auth.principal(req);
    const publicApi = Object.freeze({
        ready: auth.ready,
        user: auth.user,
        principal: (req) => principalByRequest.get(req),
        ownerOfSession: auth.session,
        ownerOfWorkspace: auth.workspace,
        // Trusted Host provisioners own these calls; they are not browser RPCs.
        async claimSession(id, username) { await auth.ready; return auth.claimSession(id, username); },
        async claimWorkspace(id, username) { await auth.ready; return auth.claimWorkspace(id, username); },
        registerPolicy(id, rules) {
            if (!nonempty(id) || policies.has(id))
                throw new Error('Duplicate or invalid auth policy');
            policies.set(id, rules);
            return () => { policies.delete(id); };
        },
    });
    ctx.provide?.('uiAuth', publicApi);
    function extension(kind, target) {
        const matches = [...policies.values()].filter(rule => {
            const section = rule[kind];
            return section?.matches?.(target) === true;
        });
        if (matches.length > 1)
            throw new Error('Ambiguous authorization policy');
        return matches[0]?.[kind];
    }
    /** Own a `sessionId` query parameter on the exact `/api` routes that bypass Remote dispatch. */
    function ownsQuerySession(who, url) {
        if (who.role === 'admin')
            return true;
        const sessionId = url.searchParams.get('sessionId');
        return nonempty(sessionId) && auth.session(sessionId) === who.username;
    }
    function prepare(req) {
        const who = principal(req);
        if (who === undefined)
            return { status: 401 };
        const connection = ctx.get('connection');
        if (connection === undefined)
            return { status: 503 };
        const host = req.headers.host;
        if (typeof host !== 'string')
            return { status: 403 };
        // Mint this process's carrier cookie. It is injected into every request we forward, and it is
        // ALSO mirrored back to the browser (see handleHttp): the app's own connection module needs to
        // hold a carrier of its own to finish its handshake, and without it the client loops on
        // "connection lost". Mirroring is safe because the outer gate still demands a live
        // dsh-ui-auth session before anything is forwarded.
        let cookie;
        let carrier;
        try {
            const url = new URL(connection.authenticatedUrl(`http://${host}`));
            connection.authorizeIndex({ method: 'GET', url: url.pathname + url.search, headers: { host } }, {
                writeHead(_status, headers) {
                    const raw = headers?.['set-cookie'];
                    if (raw === undefined)
                        return;
                    cookie = raw.split(';')[0];
                    carrier = raw;
                },
                end() { },
            });
        }
        catch {
            return { status: 403 };
        }
        if (cookie === undefined)
            return { status: 503 };
        // Ignore client-supplied native carrier cookies; use only this process's freshly issued one.
        const retained = (req.headers.cookie ?? '').split(';').filter(part => !part.trim().startsWith('dsh-auth-')).join(';');
        req.headers.cookie = `${retained}; ${cookie}`;
        const rejected = connection.requestRejection(req);
        if (rejected !== undefined)
            return { status: rejected };
        principalByRequest.set(req, who);
        return { who, ...(carrier === undefined ? {} : { carrier }) };
    }
    async function handleHttp(req, res, forward) {
        const admitted = prepare(req);
        if (admitted.status !== undefined) {
            json(res, admitted.status, { error: 'Access denied' });
            return true;
        }
        const who = admitted.who;
        // 把现铸的载体 Cookie 回写给浏览器：客户端的连接模块需要自己持有一个载体才能完成握手，
        // 否则会一直 "connection lost" 重连（实测：闸门透传时该症状消失）。外层仍由本插件的会话
        // Cookie 把关——gate 对每个请求都会核对会话，所以浏览器持有该 Cookie 不构成绕过。
        if (admitted.carrier !== undefined && !res.headersSent) {
            try {
                res.setHeader('set-cookie', admitted.carrier);
            }
            catch (error) { /* 头已发出则忽略 */ }
        }
        const url = new URL(req.url, 'http://local');
        const pathname = url.pathname;
        const rule = extension('http', { pathname, method: req.method });
        if (rule !== undefined) {
            if (!(await rule.authorize(who, req)))
                json(res, 403, { error: 'Access denied' });
            else
                forward(req, res);
            return true;
        }
        // Host-side app opening registers outside /api and would otherwise pass on the carrier cookie alone.
        if (pathname.startsWith(HOST_OPEN_PREFIX)) {
            if (who.role !== 'admin') {
                json(res, 403, { error: 'Access denied' });
                return true;
            }
            return false;
        }
        if (!pathname.startsWith('/api/'))
            return false;
        // Exact Fetch routes registered beside the RPC channel: never a Remote endpoint.
        if (HOST_CAPABILITY_PATHS.has(pathname)) {
            if (who.role !== 'admin') {
                json(res, 403, { error: 'Access denied' });
                return true;
            }
            return false;
        }
        if (SESSION_QUERY_PATHS.has(pathname)) {
            if (!ownsQuerySession(who, url)) {
                json(res, 403, { error: 'Access denied' });
                return true;
            }
            return false;
        }
        if (pathname === MUX_PATH) {
            if (who.role !== 'admin') {
                json(res, 403, { error: 'Access denied' });
                return true;
            }
            return false;
        }
        if (req.method !== 'POST') {
            // Host exports and third-party GETs need an explicit policy for ordinary users.
            if (who.role !== 'admin') {
                json(res, 403, { error: 'Access denied' });
                return true;
            }
            return false;
        }
        const endpoint = pathname.slice('/api/'.length);
        let decoded;
        try {
            decoded = await bodyOf(req);
        }
        catch {
            json(res, 400, { error: 'Invalid request' });
            return true;
        }
        const { envelope, body } = decoded;
        if (envelope?.type !== 'client-request' || envelope.method !== endpoint || !nonempty(envelope.rpcId)) {
            json(res, 400, { error: 'Invalid request' });
            return true;
        }
        let allowed;
        for (const rules of policies.values()) {
            const remote = rules.remote;
            if (remote?.matches(endpoint) === true && !(await remote.authorize(who, envelope.payload))) {
                json(res, 403, { error: 'Access denied' });
                return true;
            }
        }
        if (endpoint === '$events/result') {
            const args = remoteArgs(envelope.payload);
            // 严格属主绑定：只有**本登录确实被投递过该事件**时才允许应答。相关性由 mux 代理在转发
            // waterfall 帧时填充（`policy.frame` 记录 eventId），因此这里不再有"看不到帧"的档位。
            // 历史教训：旧实现的 `correlation.clientId === args.clientId` 永远不可能成立（相关性对象里
            // 只有 `{login, events}`），于是审批/提问应答必然 403，界面陷入「点击 → 重连 → 再点击」（Issue #2）；
            // 随后的修法一度**放宽为"形状非空即放行"**，那给了任意已登录调用者一个跨会话应答注入面
            // （不需要任何被投递的事件，只要填两个字符串）。现在帧观察是必然存在的（升级被本插件代理），
            // 所以退档已删除：拿不出被投递过的 eventId 就拒绝，fail-closed。
            const mine = [...correlations].filter(correlation => correlation.login === auth.loginKey(req));
            allowed = object(args)
                && nonempty(args.eventId)
                && mine.some(correlation => correlation.events.has(args.eventId));
        }
        else {
            const rule = extension('rpc', endpoint);
            allowed = rule ? await rule.authorize(who, envelope.payload) : await policy.authorize(who, endpoint, envelope.payload);
        }
        if (!allowed) {
            json(res, 403, { error: 'Access denied' });
            return true;
        }
        // The response is parsed and re-serialized for ownership projection, so the upstream
        // half must hand back identity bytes: a compressed body cannot be projected.
        req.headers['accept-encoding'] = 'identity';
        const request = replay(req, body);
        principalByRequest.set(request, who);
        try {
            await forwardJson(forward, request, res, async (value) => {
                const rule = endpoint === '$events/result' ? undefined : extension('rpc', endpoint);
                const projected = rule ? await rule.project(who, value) : await policy.result(who, endpoint, value);
                const current = principal(req);
                if (current?.role !== who.role || current.username !== who.username)
                    throw denial();
                return projected;
            });
        }
        catch (error) {
            // Never inherit framing/encoding headers captured from the attempt that failed.
            for (const header of ['content-length', 'Content-Length', 'content-encoding', 'Content-Encoding', 'transfer-encoding', 'Transfer-Encoding']) {
                delete (res.getHeaders?.())[header];
                res.removeHeader?.(header);
            }
            console.error('[dsh-ui-auth] modern gateway projection failed: ' + errorMessage(error));
            if (!res.headersSent)
                json(res, 502, { error: 'Could not persist or project response' });
            else
                res.destroy();
        }
        return true;
    }
    function handleUpgrade(req, socket, head, forward) {
        const admitted = prepare(req);
        const reject = (status) => { socket.end(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
        if (admitted.status !== undefined) {
            reject(admitted.status);
            return;
        }
        const who = admitted.who;
        const pathname = new URL(req.url, 'http://local').pathname;
        if (pathname === MUX_PATH) {
            // mux 主通道：默认由本插件透明代理（Issue #6 的逐帧归属过滤）。
            // 例外两条都必须直通宿主：① 我们自己的上游连接（带 nonce 头，否则自我递归）；
            // ② `DSH_AUTH_MUX_PROXY=0` 的排障退避（退避后跨用户泄漏会重现）。
            if (process.env.DSH_AUTH_MUX_PROXY === '0' || isOwnMuxProxyRequest(req)) {
                forward(req, socket, head);
                return;
            }
            proxyMuxUpgrade(req, socket, head, { host: req.headers.host ?? '', cookie: req.headers.cookie, who });
            return;
        }
        const rule = extension('upgrade', { pathname });
        const pass = () => {
            downstreamSockets.add(socket);
            const timer = setInterval(() => {
                const current = principal(req);
                if (current?.username !== who.username || current.role !== who.role)
                    socket.destroy();
            }, 1000);
            timer.unref();
            socket.once('close', () => { clearInterval(timer); downstreamSockets.delete(socket); });
            forward(req, socket, head);
        };
        if (rule === undefined) {
            if (who.role === 'admin')
                pass();
            else
                reject(403);
            return;
        }
        Promise.resolve(rule.authorize(who, req)).then(granted => {
            if (granted && principal(req) !== undefined)
                pass();
            else
                reject(403);
        }, () => reject(403));
    }
    ctx.effect(() => () => {
        for (const socket of downstreamSockets)
            socket.destroy();
        policies.clear();
        correlations.clear();
    }, 'dsh-ui-auth: modern gateway');
    // ===== mux 透明代理（Issue #6 根因修复）=====
    // 接住客户端的 mux 升级，再以 WS 客户端连宿主的 mux，两个方向都按登录归属把关：
    //   **上行**：记录 `open` 的 streamId → endpoint，并先 `policy.authorize(...)`；未授权不转发（宿主是单用户语义，
    //            会照单服务任何 sessionId，只过滤下行不够）。上游未连上时上行帧排队，不丢首帧。
    //   **下行**：逐帧 `policy.frame()`（丢弃/裁剪/投影，未知流 fail-closed），并记录已投递的 waterfall eventId —— 
    //            让 `$events/result` 保持严格属主绑定（Issue #2 的正解）。
    // 之所以用代理而不自己实现 mux：旧实现要重放 mux 语义，与 0.2.0 客户端协议不兼容（界面会无限「重新连接中」）；
    // 代理**不碰语义**，只按 JSON 里的归属字段与策略层裁决，协议无关。
    // 递归防护：代理自己的上游连接会再次经过本闸门，必须能被识别并直通，否则无限自我连接（进程耗尽静默退出）。
    const MUX_PROXY_HEADER = 'x-dsh-ui-auth-mux-proxy';
    const muxProxyNonce = randomUUID();
    const muxSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
    // ws 服务器自身也要有 error 监听：否则一次握手异常就能以未处理事件的形式终止宿主进程。
    muxSockets.on('error', () => { });
    const parseFrame = (raw) => {
        try {
            const value = JSON.parse(raw);
            return object(value) ? value : undefined;
        }
        catch (error) {
            return undefined;
        }
    };
    /**
     * 在帧里找字符串字段：顶层、`value`、`payload`、`result` 各看一层。
     * `value` 必须在内——宿主实际发的帧是 `{type:'item', streamId, value:{…}}`，
     * 会话/事件标识都在 `value` 里（漏掉它会让 `$events/result` 的严格属主绑定永远匹配不到，
     * 实测踩过：`eventId` 落在 `value.eventId`）。
     */
    const fieldOf = (frame, name) => {
        const scopes = [frame, frame.value, frame.payload, frame.result];
        for (const scope of scopes) {
            if (object(scope) && typeof scope[name] === 'string' && scope[name] !== '') {
                return scope[name];
            }
        }
        return undefined;
    };
    const debugStream = (message) => {
        if (process.env.DSH_AUTH_DEBUG_STREAM === '1')
            console.error('[dsh-ui-auth] 代理：' + message);
    };
    /**
     * 被**隐藏**的 waterfall 接收方必须代替自己释放投递，否则属主的 `next` 会永远挂住
     * （宿主按扇出收齐应答）。这是旧自研 mux 路径的语义，代理路径同样需要，故在此保活。
     */
    const releaseWaterfall = async (clientId, eventId) => {
        if (clientId === undefined || clientId === '' || eventId === '')
            return;
        const connection = ctx.get('connection');
        if (connection?.createSharedFetchHandler === undefined)
            return;
        try {
            const response = await connection.createSharedFetchHandler('/api').fetch(new Request('http://dsh.internal/api/$events/result', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'client-request', rpcId: eventId, method: '$events/result', payload: { args: {
                            clientId, eventId, outcome: { kind: 'next' },
                        } } }),
            }));
            const settled = await response.json();
            if (settled.result?.ok !== true)
                console.error('[dsh-ui-auth] 释放被隐藏的 waterfall 投递未被宿主确认');
        }
        catch (error) {
            console.error('[dsh-ui-auth] 释放被隐藏的 waterfall 投递异常: ' + errorMessage(error));
        }
    };
    /**
     * 代理一次 mux 升级。握手交给 `ws`（因此客户端看到的仍是标准 WS 握手），
     * `host`/`cookie` 用于连回宿主自己的 mux（与改动前直通宿主的行为保持一致）。
     */
    function proxyMuxUpgrade(req, socket, head, info) {
        try {
            muxSockets.handleUpgrade(req, socket, head, (client) => {
                const correlation = { login: auth.loginKey(req), events: new Set() };
                correlations.add(correlation);
                let upstream;
                try {
                    upstream = new WebSocket(`ws://${info.host}/api/remote.mux`, {
                        maxPayload: MAX_BODY,
                        headers: { ...(info.cookie === undefined ? {} : { cookie: info.cookie }), [MUX_PROXY_HEADER]: muxProxyNonce },
                    });
                }
                catch (error) {
                    correlations.delete(correlation);
                    try {
                        client.close(1011, 'upstream unavailable');
                    }
                    catch (inner) { /* ignore */ }
                    return;
                }
                let closed = false;
                const shutdown = () => {
                    if (closed)
                        return;
                    closed = true;
                    correlations.delete(correlation);
                    try {
                        client.close();
                    }
                    catch (error) { /* ignore */ }
                    try {
                        upstream.close();
                    }
                    catch (error) { /* ignore */ }
                };
                // streamId → endpoint：客户端 `open` 帧给出端点，逐帧策略需要它才能裁决。
                const endpoints = new Map();
                // 被拒的流：不转发其 open，也记住它以便丢弃迟到帧（fail-closed）。
                const denied = new Set();
                const pendingUplink = [];
                let uplinkQueue = Promise.resolve();
                /**
                 * 上行帧（客户端 → 宿主）。两件事必须在这里做：
                 * ① **打开流也要按登录归属授权**——宿主把自己当单用户，会按请求里的 sessionId 服务任何连接，
                 *    只过滤下行帧是不够的（普通用户能直接订阅他人会话内容，这是 #6 的另一半）；
                 * ② 上游尚未连上时**排队而不是丢弃**（浏览器握手完成即发 open，上游多半还在 CONNECTING，
                 *    丢弃会静默丢掉首帧，正是"连上了却没数据"的成因）。
                 */
                const deliverUplink = async (data, isBinary) => {
                    const frame = isBinary ? undefined : parseFrame(data.toString());
                    const streamId = frame === undefined ? undefined : fieldOf(frame, 'streamId');
                    if (frame !== undefined && streamId !== undefined) {
                        if (frame.type === 'open' && typeof frame.endpoint === 'string') {
                            const endpoint = frame.endpoint;
                            let granted = false;
                            try {
                                // 部署方可用 `uiAuth.registerPolicy({stream})` 覆盖内置判定（与原自研 mux 路径的语义一致）。
                                const rule = extension('stream', endpoint);
                                granted = rule
                                    ? await rule.authorize(info.who, frame.payload)
                                    : await policy.authorize(info.who, endpoint, frame.payload, true);
                            }
                            catch (error) {
                                console.error('[dsh-ui-auth] 流授权判定异常（endpoint=' + endpoint + '）：' + errorMessage(error));
                            }
                            if (!granted) {
                                denied.add(streamId);
                                debugStream(`拒绝打开 endpoint=${endpoint} who=${info.who.username}/${info.who.role}`);
                                try {
                                    client.send(JSON.stringify({ type: 'error', streamId, error: { code: 'auth/forbidden', message: 'Stream unavailable or access denied', details: {} } }));
                                }
                                catch (error) { /* ignore */ }
                                return;
                            }
                            endpoints.set(streamId, endpoint);
                        }
                        else if (frame.type === 'cancel') {
                            endpoints.delete(streamId);
                            denied.delete(streamId);
                        }
                    }
                    if (upstream.readyState !== WebSocket.OPEN) {
                        pendingUplink.push({ data, isBinary });
                        return;
                    }
                    await new Promise((resolve) => {
                        try {
                            upstream.send(data, { binary: isBinary }, () => resolve());
                        }
                        catch (error) {
                            resolve();
                        }
                    });
                };
                const submitUplink = (data, isBinary) => {
                    uplinkQueue = uplinkQueue
                        .then(() => deliverUplink(data, isBinary))
                        .catch((error) => { console.error('[dsh-ui-auth] 上行帧处理异常: ' + errorMessage(error)); });
                };
                upstream.on('open', () => {
                    for (const item of pendingUplink.splice(0))
                        submitUplink(item.data, item.isBinary);
                });
                let downQueue = Promise.resolve();
                /**
                 * 下行帧（宿主 → 客户端）。逐帧裁决走**策略层** `frame()`（唯一事实来源：会话/工作区/事件归属
                 * 与投影都在那里，且有单测）；若部署方登记了 `uiAuth.registerPolicy({stream})`，则**由它接管**
                 * （与原自研 mux 路径一致）。`project` 可能是异步的，因此整条下行链按序串行，避免帧乱序。
                 */
                const deliverDown = async (data, isBinary) => {
                    if (isBinary) {
                        try {
                            client.send(data, { binary: true });
                        }
                        catch (error) { /* ignore */ }
                        ;
                        return;
                    }
                    const raw = data.toString();
                    const frame = parseFrame(raw);
                    if (frame === undefined) {
                        try {
                            client.send(raw);
                        }
                        catch (error) { /* ignore */ }
                        ;
                        return;
                    }
                    const streamId = fieldOf(frame, 'streamId');
                    // `item` 帧带 streamId（端点从客户端 open 记录里查）；连接级帧（ready/emit）属于 `$events`。
                    const wrapped = frame.type === 'item' && streamId !== undefined;
                    const endpoint = streamId === undefined ? '$events' : endpoints.get(streamId);
                    if (endpoint === undefined) {
                        // 不认识的流一律丢弃（fail-closed）：绝不转发未经裁决的数据。
                        debugStream(`丢弃未知流的帧 streamId=${String(streamId)}`);
                        return;
                    }
                    const value = wrapped ? frame.value : frame;
                    let output;
                    try {
                        const rule = extension('stream', endpoint);
                        output = rule ? await rule.project(info.who, value) : policy.frame(info.who, endpoint, value, correlation);
                    }
                    catch (error) {
                        console.error('[dsh-ui-auth] 帧策略异常（endpoint=' + endpoint + '）：' + errorMessage(error));
                        return;
                    }
                    if (output === null) {
                        if (endpoint === '$events' && object(value) && value.type === 'waterfall') {
                            const eventId = value.eventId;
                            void releaseWaterfall(correlation.clientId, typeof eventId === 'string' ? eventId : '');
                        }
                        debugStream(`丢弃帧 who=${info.who.username}/${info.who.role} endpoint=${endpoint} frame=${raw.slice(0, 160)}`);
                        return;
                    }
                    const text = output === value
                        ? raw
                        : JSON.stringify(wrapped ? { ...frame, value: output } : output);
                    if (text !== raw)
                        debugStream(`改写帧 who=${info.who.username}/${info.who.role} endpoint=${endpoint} 原=${raw.slice(0, 140)} 改=${text.slice(0, 140)}`);
                    try {
                        client.send(text);
                    }
                    catch (error) { /* ignore */ }
                };
                upstream.on('message', (data, isBinary) => {
                    downQueue = downQueue
                        .then(() => deliverDown(data, isBinary))
                        .catch((error) => { console.error('[dsh-ui-auth] 下行帧处理异常: ' + errorMessage(error)); });
                });
                client.on('message', (data, isBinary) => {
                    submitUplink(data, isBinary);
                });
                client.on('close', shutdown);
                client.on('error', shutdown);
                upstream.on('close', shutdown);
                upstream.on('error', shutdown);
            });
        }
        catch (error) {
            try {
                socket.destroy();
            }
            catch (inner) { /* ignore */ }
        }
    }
    /** 该请求是否来自我们自己的 mux 代理上游连接（用于避免递归代理）。 */
    function isOwnMuxProxyRequest(req) {
        return req.headers[MUX_PROXY_HEADER] === muxProxyNonce;
    }
    return { handleHttp, handleUpgrade, proxyMuxUpgrade, isOwnMuxProxyRequest, publicApi };
}
