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
const MAX_STREAMS = 64;
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
/**
 * 按**登录归属**裁决一条「宿主 → 客户端」的 mux 帧（Issue #6 的核心修复，纯函数便于回归测试）：
 * 返回 `undefined` 表示丢弃；返回新对象表示改写后转发；返回原对象表示原样转发。
 *
 * 为什么必须做在这里：宿主把 mux 通道当「单用户」用，`workspace/follow` 会把**全部**工作区推给
 * 每个连接。实测泄漏形态有三种，且都不含顶层 `sessionId`：
 *   - `{type:'baseline', value:{items:[{workspaceId…}]}}`（初始全量，最容易漏掉）
 *   - `{type:'upsert', workspace:{workspaceId…}}`
 *   - `{type:'order', workspaceIds:[…]}`（列表，需要**裁剪**而不是丢弃）
 * 管理员不受限；普通用户只看得到自己拥有的会话/工作区。
 */
export function projectMuxFrame(who, frame, lookup) {
    const entitledSession = (id) => who.role === 'admin' || lookup.session(id) === who.username;
    const entitledWorkspace = (id) => {
        if (who.role === 'admin')
            return true;
        const owner = lookup.workspace(id);
        return typeof owner === 'string' && owner !== '' && owner === who.username;
    };
    const value = object(frame.value) ? frame.value : undefined;
    if (value === undefined)
        return frame;
    const sessionId = typeof value.sessionId === 'string' ? value.sessionId : undefined;
    if (sessionId !== undefined && sessionId !== '' && !entitledSession(sessionId))
        return undefined;
    if (object(value.workspace)) {
        const inner = value.workspace;
        const id = typeof inner.workspaceId === 'string' ? inner.workspaceId : undefined;
        if (id !== undefined && id !== '' && !entitledWorkspace(id))
            return undefined;
    }
    const bare = typeof value.workspaceId === 'string' ? value.workspaceId : undefined;
    if (bare !== undefined && bare !== '' && !entitledWorkspace(bare))
        return undefined;
    if (who.role !== 'admin' && Array.isArray(value.workspaceIds)) {
        const all = value.workspaceIds;
        const kept = all.filter((x) => typeof x === 'string' && entitledWorkspace(x));
        if (kept.length !== all.length)
            return { ...frame, value: { ...value, workspaceIds: kept } };
    }
    if (value.type === 'baseline' && object(value.value)) {
        const body = value.value;
        let changed = false;
        const nextBody = { ...body };
        if (Array.isArray(body.items)) {
            const items = body.items;
            const kept = items.filter((entry) => {
                if (!object(entry))
                    return true;
                const item = entry;
                const wid = typeof item.workspaceId === 'string' ? item.workspaceId : undefined;
                if (wid !== undefined && wid !== '' && !entitledWorkspace(wid))
                    return false;
                const sid = typeof item.sessionId === 'string' ? item.sessionId : undefined;
                return !(sid !== undefined && sid !== '' && !entitledSession(sid));
            });
            if (kept.length !== items.length) {
                changed = true;
                nextBody.items = kept;
            }
        }
        // `projections` 的键语义未知：只在**条目自身**携带未授权 sessionId 时剔除，绝不按未知键名猜测。
        if (object(body.projections)) {
            const projections = body.projections;
            const kept = Object.entries(projections).filter(([, entry]) => {
                if (!object(entry))
                    return true;
                const sid = typeof entry.sessionId === 'string' ? entry.sessionId : undefined;
                return !(sid !== undefined && sid !== '' && !entitledSession(sid));
            });
            if (kept.length !== Object.keys(projections).length) {
                changed = true;
                nextBody.projections = Object.fromEntries(kept);
            }
        }
        if (changed)
            return { ...frame, value: { ...value, value: nextBody } };
    }
    return frame;
}
export function createModernGateway(ctx, auth) {
    const policy = createModernPolicy(auth, {
        ...(auth.entitlement === undefined ? {} : { entitlement: auth.entitlement }),
    });
    const policies = new Map();
    const principalByRequest = new WeakMap();
    const correlations = new Set();
    const downstreamSockets = new Set();
    const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
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
            // 严格绑定：只有当**本登录确实收到过该事件**时才允许应答（correlations 由我们的 mux 观察填充）。
            // 注意：旧实现的 `correlation.clientId === args.clientId` 永远不可能成立——相关性对象里
            // 只有 `{login, events}`，从来没有 clientId（见本文件 StreamCorrelation 的构造处），
            // 所以审批/提问应答必然 403 并导致「点击 → 重连 → 再点击」死循环（Issue #2）。
            // 现在：若本登录尚无可观察的连接（mux 升级直通宿主、我们看不到帧），退回形状校验以免功能不可用；
            // 一旦恢复帧观察（Issue #6 的根因修复），绑定**自动**变回严格属主校验。
            // ⚠️ 残余风险（已记入 docs/SECURITY.md 与 README 已知边界）：在"形状校验"这一档，
            // 已登录用户可提交任意 $events/result（跨用户应答注入）。
            const mine = [...correlations].filter(correlation => correlation.login === auth.loginKey(req));
            allowed = object(args)
                && (mine.length === 0
                    ? nonempty(args.clientId) && nonempty(args.eventId)
                    : mine.some(correlation => correlation.events.has(args.eventId)));
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
        if (pathname !== MUX_PATH) {
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
            return;
        }
        const gateway = ctx.get('typertGateway');
        const wireStream = gateway?.wireStream;
        if (wireStream?.open === undefined) {
            reject(503);
            return;
        }
        sockets.handleUpgrade(req, socket, head, (ws) => {
            const active = new Map();
            const login = auth.loginKey(req);
            const initialRole = who.role;
            let writes = Promise.resolve();
            const alive = () => {
                const current = principal(req);
                return current?.username === who.username && current.role === initialRole && auth.loginKey(req) === login ? current : undefined;
            };
            const send = (value) => {
                writes = writes.then(() => new Promise((resolve, rejectSend) => {
                    if (alive() === undefined || ws.readyState !== WebSocket.OPEN) {
                        rejectSend(denial());
                        return;
                    }
                    const serialized = JSON.stringify(value);
                    if (Buffer.byteLength(serialized) > MAX_BODY || ws.bufferedAmount > MAX_BODY) {
                        ws.close(1009, 'Stream limit exceeded');
                        rejectSend(denial());
                        return;
                    }
                    ws.send(serialized, error => error ? rejectSend(error) : resolve());
                }));
                return writes;
            };
            const timer = setInterval(() => { if (alive() === undefined)
                ws.close(1008, 'Login expired'); }, 1000);
            timer.unref();
            ws.on('error', () => ws.terminate());
            ws.on('close', () => {
                clearInterval(timer);
                for (const work of active.values()) {
                    work.abort.abort();
                    correlations.delete(work.correlation);
                }
            });
            ws.on('message', (bytes, binary) => {
                let message;
                try {
                    message = JSON.parse(bytes.toString());
                }
                catch {
                    ws.close(1008, 'Invalid stream request');
                    return;
                }
                if (binary || alive() === undefined || !nonempty(message?.streamId)) {
                    ws.close(1008, 'Invalid stream request');
                    return;
                }
                if (message.type === 'cancel' && Object.keys(message).length === 2) {
                    active.get(message.streamId)?.abort.abort();
                    return;
                }
                if (message.type !== 'open' || Object.keys(message).length !== 4 || typeof message.endpoint !== 'string'
                    || active.has(message.streamId) || active.size >= MAX_STREAMS) {
                    ws.close(1008, 'Invalid stream request');
                    return;
                }
                const streamId = message.streamId;
                const endpoint = message.endpoint;
                const payload = message.payload;
                const work = { abort: new AbortController(), correlation: { login, events: new Set() } };
                active.set(streamId, work);
                correlations.add(work.correlation);
                void (async () => {
                    try {
                        const current = alive();
                        const rule = extension('stream', endpoint);
                        if (current === undefined || !(rule ? await rule.authorize(current, payload) : await policy.authorize(current, endpoint, payload, true)))
                            throw denial();
                        const source = await wireStream.open(endpoint, payload, undefined, who, work.abort.signal);
                        for await (const value of source) {
                            // 宿主 $events 的首帧是 ready，其 clientId 就是浏览器后续在 $events/result 里回传的标识；
                            // 必须把它记入相关性，绑定才会成立（Issue #2 的行级根因就在这里）。
                            if (object(value) && value.type === 'ready' && typeof value.clientId === 'string') {
                                work.correlation.clientId = value.clientId;
                            }
                            if (work.abort.signal.aborted)
                                break;
                            const watcher = alive();
                            if (watcher === undefined)
                                throw denial();
                            if (rule !== undefined && extension('stream', endpoint) !== rule)
                                throw denial();
                            // Recheck ownership as well as login state throughout a scoped stream.
                            if (!(rule ? await rule.authorize(watcher, payload) : await policy.authorize(watcher, endpoint, payload, true)))
                                throw denial();
                            const output = rule ? await rule.project(watcher, value) : policy.frame(watcher, endpoint, value, work.correlation);
                            // 诊断开关：默认不输出；排查"事件不流动/被过滤"时开启（宿主是否送来、是否被丢弃一目了然）。
                            if (process.env.DSH_AUTH_DEBUG_STREAM === '1' && object(value) && value.type === 'emit') {
                                console.error(`[dsh-ui-auth][stream] emit=${String(value.event)} -> ${output === null ? 'dropped' : 'delivered'}`);
                            }
                            const frame = object(value) ? value : undefined;
                            if (endpoint === '$events' && frame?.type === 'waterfall' && output === null) {
                                // A hidden recipient must release its delivery, otherwise an owner's "next"
                                // waits forever on users who were correctly not shown the interaction.
                                const endpoint = '$events/result';
                                const connection = ctx.get('connection');
                                const response = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://dsh.internal/api/${endpoint}`, {
                                    method: 'POST', headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({ type: 'client-request', rpcId: frame.eventId, method: endpoint, payload: { args: {
                                                clientId: work.correlation.clientId, eventId: frame.eventId, outcome: { kind: 'next' },
                                            } } }),
                                }));
                                const settled = await response.json();
                                if (!settled.result?.ok)
                                    throw denial();
                            }
                            if (output !== null)
                                await send({ type: 'item', streamId, value: output });
                        }
                        if (!work.abort.signal.aborted)
                            await send({ type: 'end', streamId });
                    }
                    catch (error) {
                        // 流失败的**真实原因**必须留下痕迹：否则前端只看到 auth/forbidden，无法定位（本仓库吃过这个亏）。
                        console.error(`[dsh-ui-auth] 流处理失败（endpoint=${String(endpoint)}）：${error instanceof Error ? error.message : String(error)}`);
                        if (!work.abort.signal.aborted) {
                            await send({ type: 'error', streamId, error: { code: 'auth/forbidden', message: 'Stream unavailable or access denied', details: {} } })
                                .catch(() => ws.close(1008));
                        }
                    }
                    finally {
                        correlations.delete(work.correlation);
                        active.delete(streamId);
                    }
                })();
            });
        });
    }
    ctx.effect(() => () => {
        for (const socket of sockets.clients)
            socket.terminate();
        for (const socket of downstreamSockets)
            socket.destroy();
        sockets.close();
        policies.clear();
        correlations.clear();
    }, 'dsh-ui-auth: modern gateway');
    // ===== mux 透明代理（Issue #6 根因修复）=====
    // 接住客户端的 mux 升级，再以 WS 客户端连宿主的 mux，帧**原样转发**，但在「宿主 → 客户端」方向做两件事：
    //   1) 丢弃**非本人会话**的帧 —— 修复跨用户事件实时泄漏（Issue #6）；
    //   2) 记录已投递的事件 id —— 让 $events/result 恢复**严格属主绑定**（Issue #2 的正解）。
    // 之所以用代理而不自己实现 mux：旧实现要解析并重放 mux 语义，与 0.2.0 客户端协议不兼容（界面会无限
    // 「重新连接中」）；代理**不碰语义**，只按 JSON 里的 sessionId/eventId 判断，协议无关。
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
    /** 在帧里找字符串字段：顶层、payload、result 各看一层（mux 帧的两种常见形态）。 */
    const fieldOf = (frame, name) => {
        const scopes = [frame, frame.payload, frame.result];
        for (const scope of scopes) {
            if (object(scope) && typeof scope[name] === 'string' && scope[name] !== '') {
                return scope[name];
            }
        }
        return undefined;
    };
    /** 该登录是否有权看到这个会话的数据（管理员不受限）。 */
    const entitledTo = (who, sessionId) => who.role === 'admin' || auth.session(sessionId) === who.username;
    /** 逐帧归属过滤的纯函数实现在模块级（`projectMuxFrame`），这里只绑定本网关的归属查询。 */
    const projectFrame = (who, frame) => projectMuxFrame(who, frame, auth);
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
                upstream.on('message', (data, isBinary) => {
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
                    if (frame !== undefined) {
                        const sessionId = fieldOf(frame, 'sessionId');
                        // 他人会话的帧**不转发**（这是 #6 的泄漏点）
                        if (sessionId !== undefined && !entitledTo(info.who, sessionId))
                            return;
                        const projected = projectFrame(info.who, frame);
                        if (projected === undefined) {
                            if (process.env.DSH_AUTH_DEBUG_STREAM === '1') {
                                console.error(`[dsh-ui-auth] 代理丢弃帧 who=${info.who.username}/${info.who.role} frame=${raw.slice(0, 200)}`);
                            }
                            return;
                        }
                        const eventId = fieldOf(frame, 'eventId');
                        if (eventId !== undefined)
                            correlation.events.add(eventId);
                        if (projected !== frame) {
                            const text = JSON.stringify(projected);
                            if (process.env.DSH_AUTH_DEBUG_STREAM === '1') {
                                console.error(`[dsh-ui-auth] 代理改写帧 who=${info.who.username}/${info.who.role} 原=${raw.slice(0, 160)} 改=${text.slice(0, 160)}`);
                            }
                            try {
                                client.send(text);
                            }
                            catch (error) { /* ignore */ }
                            return;
                        }
                    }
                    try {
                        client.send(raw);
                    }
                    catch (error) { /* ignore */ }
                });
                client.on('message', (data, isBinary) => {
                    if (upstream.readyState !== WebSocket.OPEN)
                        return;
                    try {
                        upstream.send(data, { binary: isBinary });
                    }
                    catch (error) { /* ignore */ }
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
