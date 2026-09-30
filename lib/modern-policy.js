/**
 * DSH 0.1.5 Remote surface policy — reviewed by endpoint, ordinary users fail closed.
 *
 * Source of truth for the reviewed surface: DSH `dsh-v0.1.5-rc.1`
 * (`packages/api/*` `@Remote` descriptors, `packages/api/remotes/src/remote-events.ts`).
 * Unknown endpoints and unknown events are denied; ownership comes from the
 * plugin's own attribution table (`owners`), never from client-supplied fields.
 *
 * Wire conventions this module encodes:
 * - unary args are `payload.args`; most methods nest one `request` object, flat
 *   methods (`settings/*`, `credentials/*`, `workspaceFiles/*`, `llm/*`, `*Id`
 *   scoped verbs) carry their fields directly;
 * - `session/list` is the one method whose wire field is `_request`;
 * - `session/page` / `session/follow` address sessions durably
 *   (`{ kind: 'session' | 'subagent', sessionId, parentSessionId?, childSessionId? }`);
 * - agent-scoped verbs carry `agentId`, a SessionId;
 * - `workspaceFiles/*` carry `workspaceFileScopeId`, also a SessionId.
 *
 * Baseline note: this module is the only policy path. v0.7.0 removed the legacy
 * dotted/`apiProxy` transport, so a host without `connection.authorizeIndex`
 * (DSH 0.1.1-rc.2) is refused at startup instead of falling back.
 */
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const nonempty = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
/** Own-session session methods addressed by `request.sessionId`. */
const SESSION_BY_ID = new Set(['prompt', 'attachment', 'cancel', 'rename', 'selectModel', 'updateQueue', 'fork']);
/** Own-workspace workspace methods addressed by `request.workspaceId`. */
const WORKSPACE_BY_ID = new Set(['rename', 'delete', 'insertBefore', 'insertSessionBefore']);
/** Read-only, owner-filtered session endpoints. */
const SESSION_READ = new Set(['list', 'search', 'modelCatalog', 'canOpenWorkspacePath']);
/** Flat read-only global metadata an ordinary user may see (redacted by the host). */
const SHARED_READ = new Set(['settings/describe', 'llm/listProviders', 'llm/listConfigurableProviders']);
/** Plugin-manager reads the settings page performs on load; its write verbs stay administrator-only. */
const PLUGIN_MANAGER_READ = new Set(['listPlugins', 'listBundles', 'registries', 'inspect']);
/** Interactive question endpoints: agent-scoped or session-scoped, both are ownership proofs. */
const SESSION_INTERACTIVE = new Set(['userQuestions/answer', 'userQuestions/attachWait']);
/** Office-to-PDF carries positional args `(workspaceFileScopeId, path, priority)`. */
const OFFICE_TO_PDF_SCOPE_INDEX = 0;
/** The raw `args` value of a Remote payload (an object, or a positional array). */
function rawArgs(payload) {
    return object(payload) ? payload.args : undefined;
}
/** The single `args` object of a Remote payload, or undefined when malformed. */
export function remoteArgs(payload) {
    if (!object(payload) || Object.keys(payload).length !== 1 || !object(payload.args))
        return undefined;
    return payload.args;
}
/** Normalize one endpoint's args into its request object (nested or flat). */
function requestOf(args) {
    if (object(args.request))
        return args.request;
    return args;
}
/** provider 行/模型行的字段名在不同包里有 `id`/`provider`/`model` 等写法，这里做容错读取。 */
const rowId = (row) => {
    if (!object(row))
        return undefined;
    for (const key of ['id', 'provider', 'providerId', 'name']) {
        const value = row[key];
        if (nonempty(value))
            return value;
    }
    return undefined;
};
const rowModel = (row) => {
    if (!object(row))
        return undefined;
    for (const key of ['id', 'model', 'modelId', 'name']) {
        const value = row[key];
        if (nonempty(value))
            return value;
    }
    return undefined;
};
export function createModernPolicy(owners, options = {}) {
    /** 取当前主体的授权范围（管理员永远不受限）。 */
    const entitlementOf = async (principal) => {
        if (principal.role === 'admin' || options.entitlement === undefined)
            return undefined;
        return await options.entitlement(principal);
    };
    const allowedProvider = (scope, provider) => nonempty(provider) && scope.providers.includes(provider);
    const allowedModel = (scope, provider, model) => nonempty(provider) && nonempty(model)
        && scope.models.some(entry => entry.provider === provider && entry.model === model);
    const arrayOf = (value) => (Array.isArray(value) ? value : []);
    const session = (principal, id) => nonempty(id) && (principal.role === 'admin' || owners.session(id) === principal.username);
    const workspace = (principal, id) => nonempty(id) && (principal.role === 'admin' || owners.workspace(id) === principal.username);
    const ownMap = (principal, value) => Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([id]) => session(principal, id)));
    const workspaceValue = (principal, value) => ({
        ...value,
        sessionIds: arrayOf(value.sessionIds).filter(id => session(principal, id)),
    });
    const workspaceBaseline = (principal, value) => {
        const baseline = object(value) ? value : {};
        return {
            items: arrayOf(baseline.items).filter(item => workspace(principal, object(item) ? item.workspaceId : undefined))
                .map(item => workspaceValue(principal, item)),
            archivedSessionIds: arrayOf(baseline.archivedSessionIds).filter(id => session(principal, id)),
        };
    };
    /** An agent-scoped verb is authorized by the Session that owns the agent. */
    const agent = (principal, args) => session(principal, args.agentId);
    function authorizeSession(args, principal) {
        const request = requestOf(args);
        if (request.address !== undefined) {
            const address = request.address;
            if (!object(address))
                return false;
            if (address.kind === 'session')
                return session(principal, address.sessionId);
            // The Session Controller verifies the child's durable parent and mode before opening it.
            if (address.kind === 'subagent')
                return session(principal, address.parentSessionId) && nonempty(address.childSessionId);
            return false;
        }
        return session(principal, request.sessionId);
    }
    return {
        session,
        workspace,
        async authorize(principal, endpoint, payload, stream = false) {
            // Remote 入参有两种线上形态：命名对象（`{args:{...}}`）与位置数组（如 officeToPdf 的
            // `(workspaceFileScopeId, path, priority)`）。数组形态按空对象继续，由对应规则自行读取位置参数；
            // 其它端点拿到空对象后仍会因缺少归属证据而被拒。
            const raw = rawArgs(payload);
            const args = remoteArgs(payload) ?? (Array.isArray(raw) ? {} : undefined);
            if (args === undefined)
                return false;
            if (principal.role === 'admin')
                return true;
            const request = requestOf(args);
            const [namespace, method, extra] = endpoint.split('/');
            if (extra !== undefined)
                return false;
            if (stream) {
                if (endpoint === '$events')
                    return true;
                if (endpoint === 'session/control')
                    return true;
                if (endpoint === 'session/follow')
                    return authorizeSession(args, principal);
                if (endpoint === 'workspace/follow')
                    return true;
                if (endpoint === 'workspaceFiles/changes')
                    return session(principal, args.workspaceFileScopeId);
                return false;
            }
            if (endpoint === '$events/result') {
                // Correlated by the gateway against delivered waterfall frames; never by payload alone.
                return false;
            }
            if (SHARED_READ.has(endpoint))
                return true;
            // 0.2.0 新增的插件管理器页：普通用户只读（listPlugins/listBundles/registries/inspect）——
            // 与 0.1.5 的 pluginInventory/list 同理，被拒会让整页显示失败；安装/卸载/启停与
            // pluginRegistryProbe/* 是部署方能力，仍未登记 → 默认拒绝。
            if (endpoint.startsWith('pluginManager/')) {
                return PLUGIN_MANAGER_READ.has(endpoint.slice('pluginManager/'.length));
            }
            // 权限预设目录是只读元数据（写入走 settings/mutate，仍限管理员）。
            if (endpoint === 'permissionPresets/catalog')
                return true;
            // 交互式提问（作答 / 等待）本质属于某个会话：agentId 或 sessionId 任一属于请求者即放行。
            if (SESSION_INTERACTIVE.has(endpoint)) {
                return agent(principal, args) || session(principal, request.sessionId ?? args.sessionId);
            }
            // 文档预览（Q8：用户 + 会话 + 工作区三重归属）。宿主以 workspaceFileScope（SessionId）
            // 解析路径，所以该 scope 必须属于请求者；入参若另给 workspaceId，其归属也必须一致。
            // 缺少可证明归属的 scope 时拒绝（fail-closed），不做"仅凭 path 放行"的推断。
            if (endpoint.startsWith('officeToPdf/')) {
                const scope = Array.isArray(raw) ? raw[OFFICE_TO_PDF_SCOPE_INDEX] : args.workspaceFileScopeId;
                if (!session(principal, scope))
                    return false;
                const workspaceId = Array.isArray(raw) ? undefined : args.workspaceId;
                return workspaceId === undefined || workspace(principal, workspaceId);
            }
            // open-in-app 的应用清单按会话归属（等价于按用户）。
            if (endpoint === 'session/workspacePathApplications') {
                return session(principal, request.sessionId ?? args.sessionId);
            }
            // 账户页（DeepSeek 登录 / 余额 / 充值）读的是**部署者**的账号与钱包，普通用户整体不开放
            // （Q7）；余额改由本插件的 balanceQuery 按用户自己的配置提供。此处显式拒绝以便审计。
            if (namespace === 'account')
                return false;
            // Agent 预设：读清单与"为本次会话选择预设"是普通用户的正常能力——设置面板的【Agent 预设】
            // 页在加载时先调 agentPresets/list（被拒会让整页显示「无法加载 Agent 预设」），新建会话的
            // 预设选择器同样依赖它。read/select 是 agent 作用域（wire 名 agentId），按会话属主校验。
            // 只有 copy/deletePreset 会写出新的预设组合（可挂载插件与提示词），仍限管理员。
            if (endpoint === 'agentPresets/list')
                return true;
            if (endpoint === 'agentPresets/read' || endpoint === 'agentPresets/select')
                return agent(principal, args);
            // 插件清单：普通用户可以查看本部署已安装的插件（只读），但安装/卸载/插件设置仍限管理员。
            // 白名单按端点登记，因此宿主后续新增的 pluginInventory/* 写操作默认仍是被拒的。
            if (endpoint === 'pluginInventory/list')
                return true;
            if (namespace === 'session') {
                if (SESSION_READ.has(method))
                    return true;
                if (method === 'page' || method === 'follow')
                    return authorizeSession(args, principal);
                if (method === 'create') {
                    // A deployment-provisioned Workspace owns the location; a client cannot override it with cwd.
                    if (!workspace(principal, request.workspaceId) || request.cwd !== undefined)
                        return false;
                    if (request.sessionId === undefined)
                        return true;
                    if (!nonempty(request.sessionId))
                        return false;
                    return session(principal, request.sessionId) || !(await owners.sessionExists(request.sessionId));
                }
                if (SESSION_BY_ID.has(method)) {
                    if (method === 'selectModel') {
                        // R2：切换模型必须落在该用户被授权的 provider/model 之内（未配置授权时维持原行为）。
                        const scope = await entitlementOf(principal);
                        if (scope !== undefined) {
                            const provider = request.provider ?? args.provider;
                            const model = request.model ?? args.model;
                            if (!allowedProvider(scope, provider) || !allowedModel(scope, provider, model))
                                return false;
                        }
                    }
                    return session(principal, request.sessionId);
                }
                return false;
            }
            if (namespace === 'workspace') {
                if (method === 'archiveSession')
                    return session(principal, request.sessionId);
                if (WORKSPACE_BY_ID.has(method)) {
                    if (!workspace(principal, request.workspaceId))
                        return false;
                    if (request.beforeWorkspaceId !== undefined && !workspace(principal, request.beforeWorkspaceId))
                        return false;
                    return [request.sessionId, request.beforeSessionId].every(id => id === undefined || session(principal, id));
                }
                // Workspace creation stays deployment-owned: a path is a host capability, not a user one.
                return false;
            }
            if (namespace === 'workspaceFiles')
                return session(principal, args.workspaceFileScopeId);
            if (endpoint === 'skills/list')
                return session(principal, request.sessionId);
            if (endpoint === 'fileReferences/list')
                return agent(principal, args);
            if (endpoint === 'sessionReferenceResolver/candidates')
                return agent(principal, args);
            if (endpoint === 'fileUploads/upload')
                return agent(principal, args);
            if (endpoint === 'commands/list')
                return agent(principal, args);
            if (namespace === 'goals')
                return agent(principal, args);
            if (namespace === 'messageFeedback')
                return session(principal, request.sessionId);
            if (endpoint === 'sessionFeedback/record')
                return session(principal, request.sessionId);
            // Commands may change permissions, filesystem access or plugins; deployments opt in per command.
            // Settings/credentials/plugins/presets/directory picking/dynamic Cordis stay administrator-only.
            return false;
        },
        async result(principal, endpoint, value) {
            const record = object(value) ? value : undefined;
            if (record !== undefined && ['session/create', 'session/fork'].includes(endpoint) && nonempty(record.sessionId)) {
                await owners.claimSession(record.sessionId, principal.username);
            }
            if (principal.role === 'admin')
                return value;
            // R2：按登录用户裁剪模型目录与 provider 列表（字段名容错；形状不认识时原样返回）。
            const modelScope = await entitlementOf(principal);
            if (modelScope !== undefined) {
                if (endpoint === 'session/modelCatalog' && record !== undefined && Array.isArray(record.providers)) {
                    const groups = record.providers.flatMap(group => {
                        const provider = rowId(group);
                        if (!allowedProvider(modelScope, provider))
                            return [];
                        const models = object(group) && Array.isArray(group.models) ? group.models : undefined;
                        if (models === undefined)
                            return [group];
                        const kept = models.filter(model => allowedModel(modelScope, provider, rowModel(model)));
                        return kept.length === 0 ? [] : [{ ...group, models: kept }];
                    });
                    return { ...record, providers: groups };
                }
                if ((endpoint === 'llm/listProviders' || endpoint === 'llm/listConfigurableProviders') && Array.isArray(value)) {
                    return value.filter(row => allowedProvider(modelScope, rowId(row)));
                }
            }
            if (['session/list', 'session/search'].includes(endpoint)) {
                const all = arrayOf(record?.items);
                const items = all.filter(item => session(principal, object(item) ? item.sessionId : undefined));
                const filtered = items.length < (record?.items?.length ?? 0);
                return { ...(record ?? {}), items, ...(filtered && record !== undefined && 'hasMore' in record ? { hasMore: false } : {}) };
            }
            if (record !== undefined && Array.isArray(record.workspaceIds)) {
                return { ...record, workspaceIds: record.workspaceIds.filter(id => workspace(principal, id)) };
            }
            if (record !== undefined && Array.isArray(record.archivedSessionIds)) {
                return { ...record, archivedSessionIds: record.archivedSessionIds.filter(id => session(principal, id)) };
            }
            if (record !== undefined && record.workspace !== undefined) {
                return { ...record, workspace: workspaceValue(principal, object(record.workspace) ? record.workspace : {}) };
            }
            return value;
        },
        frame(principal, endpoint, value, correlation) {
            const frame = object(value) ? value : {};
            if (endpoint === '$events') {
                if (frame.type === 'ready') {
                    correlation.clientId = frame.clientId;
                    return value;
                }
                if (frame.type === 'waterfall') {
                    // Only a waterfall whose owning Session belongs to this principal is delivered;
                    // a hidden recipient is released by the gateway with `next` (see modern-gateway).
                    if (!session(principal, frame.agentId))
                        return null;
                    if (correlation.events.size >= 512)
                        throw new Error('Too many pending Remote events');
                    correlation.events.add(frame.eventId);
                    return value;
                }
                if (frame.type === 'cancel')
                    return correlation.events.delete(frame.eventId) ? value : null;
                if (frame.type !== 'emit')
                    return null;
                // Global registries (commands/change, credentials/reference-updated, llm/adapters-updated,
                // settings/document-updated, cordis/*-resolved, cordis/dynamic-*) carry no owner and are
                // therefore not shown to ordinary users.
                const args = arrayOf(frame.args);
                switch (frame.event) {
                    case 'api-session/added': return session(principal, args[0]?.sessionId) ? value : null;
                    case 'api-session/activity':
                    case 'api-session/error':
                    case 'api-session/removed':
                    case 'api-session/status':
                    case 'agent-preset/selected': return session(principal, args[0]) ? value : null;
                    case 'goal/activation-changed': return session(principal, args[0]?.sessionId) ? value : null;
                    case 'cordis/request-run':
                    case 'cordis/inspect-query': return session(principal, args[0]?.agentId) ? value : null;
                    default: return null;
                }
            }
            if (principal.role === 'admin')
                return value;
            if (endpoint === 'session/control') {
                if (frame.type === 'baseline') {
                    const baseline = object(frame.value) ? frame.value : {};
                    return { type: 'baseline', value: {
                            queues: ownMap(principal, baseline.queues),
                            jobs: ownMap(principal, baseline.jobs),
                            projections: ownMap(principal, baseline.projections),
                        } };
                }
                return session(principal, frame.sessionId) ? value : null;
            }
            if (endpoint === 'workspace/follow') {
                if (frame.type === 'baseline')
                    return { type: 'baseline', value: workspaceBaseline(principal, frame.value) };
                if (frame.type === 'order')
                    return { ...frame, workspaceIds: arrayOf(frame.workspaceIds).filter(id => workspace(principal, id)) };
                if (frame.type === 'archived')
                    return { ...frame, archivedSessionIds: arrayOf(frame.archivedSessionIds).filter(id => session(principal, id)) };
                if (frame.type === 'upsert') {
                    const workspaceFrame = object(frame.workspace) ? frame.workspace : undefined;
                    return workspace(principal, workspaceFrame?.workspaceId) && workspaceFrame !== undefined
                        ? { ...frame, workspace: workspaceValue(principal, workspaceFrame) }
                        : null;
                }
                if (frame.type === 'remove')
                    return workspace(principal, frame.workspaceId) ? value : null;
                return null;
            }
            return value;
        },
    };
}
