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
 * Baseline note: this module is used only on hosts with `connection.authorizeIndex`
 * (DSH 0.1.2+). DSH 0.1.1-rc.2 keeps the legacy dotted/`apiProxy` path in `index.ts`.
 */

/** One authenticated principal; `role` is `'admin'` for administrators. */
export interface Principal {
  readonly username: string
  readonly role: string
}

/** Ownership queries and attribution used by the policy (supplied by `index.ts`). */
export interface OwnershipLookup {
  session(id: string): string
  workspace(id: string): string
  sessionExists(id: string): Promise<boolean>
  claimSession(id: string, username: string): Promise<void>
}

/** Any decoded JSON object. */
export type JsonObject = Record<string, unknown>

/** Per-stream correlation state: the delivered `clientId` plus pending waterfall ids. */
export interface StreamCorrelation {
  clientId?: string
  /** Login-token hash of the generation that owns this stream (set by the gateway). */
  login?: string
  events: Set<string>
}

export const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256

/** Own-session session methods addressed by `request.sessionId`. */
const SESSION_BY_ID = new Set(['prompt', 'attachment', 'cancel', 'rename', 'selectModel', 'updateQueue', 'fork'])
/** Own-workspace workspace methods addressed by `request.workspaceId`. */
const WORKSPACE_BY_ID = new Set(['rename', 'delete', 'insertBefore', 'insertSessionBefore'])
/** Read-only, owner-filtered session endpoints. */
const SESSION_READ = new Set(['list', 'search', 'modelCatalog', 'canOpenWorkspacePath'])
/** Flat read-only global metadata an ordinary user may see (redacted by the host). */
const SHARED_READ = new Set(['settings/describe', 'llm/listProviders', 'llm/listConfigurableProviders'])

/** The single `args` object of a Remote payload, or undefined when malformed. */
export function remoteArgs(payload: unknown): JsonObject | undefined {
  if (!object(payload) || Object.keys(payload).length !== 1 || !object(payload.args)) return undefined
  return payload.args
}

/** Normalize one endpoint's args into its request object (nested or flat). */
function requestOf(args: JsonObject): JsonObject {
  if (object(args.request)) return args.request
  return args
}

export interface ModernPolicy {
  session(principal: Principal, id: unknown): boolean
  workspace(principal: Principal, id: unknown): boolean
  authorize(principal: Principal, endpoint: string, payload: unknown, stream?: boolean): Promise<boolean>
  result(principal: Principal, endpoint: string, value: unknown): Promise<unknown>
  frame(principal: Principal, endpoint: string, value: unknown, correlation: StreamCorrelation): unknown
}

export function createModernPolicy(owners: OwnershipLookup): ModernPolicy {
  const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
  const session = (principal: Principal, id: unknown): boolean =>
    nonempty(id) && (principal.role === 'admin' || owners.session(id) === principal.username)
  const workspace = (principal: Principal, id: unknown): boolean =>
    nonempty(id) && (principal.role === 'admin' || owners.workspace(id) === principal.username)
  const ownMap = (principal: Principal, value: unknown): JsonObject =>
    Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([id]) => session(principal, id)))
  const workspaceValue = (principal: Principal, value: JsonObject): JsonObject => ({
    ...value,
    sessionIds: arrayOf(value.sessionIds).filter(id => session(principal, id)),
  })
  const workspaceBaseline = (principal: Principal, value: unknown): JsonObject => {
    const baseline = object(value) ? value : {}
    return {
      items: arrayOf(baseline.items).filter(item => workspace(principal, object(item) ? item.workspaceId : undefined))
        .map(item => workspaceValue(principal, item as JsonObject)),
      archivedSessionIds: arrayOf(baseline.archivedSessionIds).filter(id => session(principal, id)),
    }
  }
  /** An agent-scoped verb is authorized by the Session that owns the agent. */
  const agent = (principal: Principal, args: JsonObject): boolean => session(principal, args.agentId)

  function authorizeSession(args: JsonObject, principal: Principal): boolean {
    const request = requestOf(args)
    if (request.address !== undefined) {
      const address = request.address
      if (!object(address)) return false
      if (address.kind === 'session') return session(principal, address.sessionId)
      // The Session Controller verifies the child's durable parent and mode before opening it.
      if (address.kind === 'subagent') return session(principal, address.parentSessionId) && nonempty(address.childSessionId)
      return false
    }
    return session(principal, request.sessionId)
  }

  return {
    session,
    workspace,
    async authorize(principal, endpoint, payload, stream = false) {
      const args = remoteArgs(payload)
      if (args === undefined) return false
      if (principal.role === 'admin') return true
      const request = requestOf(args)
      const [namespace, method, extra] = endpoint.split('/')
      if (extra !== undefined) return false
      if (stream) {
        if (endpoint === '$events') return true
        if (endpoint === 'session/control') return true
        if (endpoint === 'session/follow') return authorizeSession(args, principal)
        if (endpoint === 'workspace/follow') return true
        if (endpoint === 'workspaceFiles/changes') return session(principal, args.workspaceFileScopeId)
        return false
      }
      if (endpoint === '$events/result') {
        // Correlated by the gateway against delivered waterfall frames; never by payload alone.
        return false
      }
      if (SHARED_READ.has(endpoint)) return true
      // Agent 预设：读清单与"为本次会话选择预设"是普通用户的正常能力——设置面板的【Agent 预设】
      // 页在加载时先调 agentPresets/list（被拒会让整页显示「无法加载 Agent 预设」），新建会话的
      // 预设选择器同样依赖它。read/select 是 agent 作用域（wire 名 agentId），按会话属主校验。
      // 只有 copy/deletePreset 会写出新的预设组合（可挂载插件与提示词），仍限管理员。
      if (endpoint === 'agentPresets/list') return true
      if (endpoint === 'agentPresets/read' || endpoint === 'agentPresets/select') return agent(principal, args)
      // 插件清单：普通用户可以查看本部署已安装的插件（只读），但安装/卸载/插件设置仍限管理员。
      // 白名单按端点登记，因此宿主后续新增的 pluginInventory/* 写操作默认仍是被拒的。
      if (endpoint === 'pluginInventory/list') return true
      if (namespace === 'session') {
        if (SESSION_READ.has(method as string)) return true
        if (method === 'page' || method === 'follow') return authorizeSession(args, principal)
        if (method === 'create') {
          // A deployment-provisioned Workspace owns the location; a client cannot override it with cwd.
          if (!workspace(principal, request.workspaceId) || request.cwd !== undefined) return false
          if (request.sessionId === undefined) return true
          if (!nonempty(request.sessionId)) return false
          return session(principal, request.sessionId) || !(await owners.sessionExists(request.sessionId))
        }
        if (SESSION_BY_ID.has(method as string)) return session(principal, request.sessionId)
        return false
      }
      if (namespace === 'workspace') {
        if (method === 'archiveSession') return session(principal, request.sessionId)
        if (WORKSPACE_BY_ID.has(method as string)) {
          if (!workspace(principal, request.workspaceId)) return false
          if (request.beforeWorkspaceId !== undefined && !workspace(principal, request.beforeWorkspaceId)) return false
          return [request.sessionId, request.beforeSessionId].every(id => id === undefined || session(principal, id))
        }
        // Workspace creation stays deployment-owned: a path is a host capability, not a user one.
        return false
      }
      if (namespace === 'workspaceFiles') return session(principal, args.workspaceFileScopeId)
      if (endpoint === 'skills/list') return session(principal, request.sessionId)
      if (endpoint === 'fileReferences/list') return agent(principal, args)
      if (endpoint === 'sessionReferenceResolver/candidates') return agent(principal, args)
      if (endpoint === 'fileUploads/upload') return agent(principal, args)
      if (endpoint === 'commands/list') return agent(principal, args)
      if (namespace === 'goals') return agent(principal, args)
      if (namespace === 'messageFeedback') return session(principal, request.sessionId)
      if (endpoint === 'sessionFeedback/record') return session(principal, request.sessionId)
      // Commands may change permissions, filesystem access or plugins; deployments opt in per command.
      // Settings/credentials/plugins/presets/directory picking/dynamic Cordis stay administrator-only.
      return false
    },
    async result(principal, endpoint, value) {
      const record = object(value) ? value : undefined
      if (record !== undefined && ['session/create', 'session/fork'].includes(endpoint) && nonempty(record.sessionId)) {
        await owners.claimSession(record.sessionId, principal.username)
      }
      if (principal.role === 'admin') return value
      if (['session/list', 'session/search'].includes(endpoint)) {
        const all = arrayOf(record?.items)
        const items = all.filter(item => session(principal, object(item) ? item.sessionId : undefined))
        const filtered = items.length < ((record?.items as unknown[] | undefined)?.length ?? 0)
        return { ...(record ?? {}), items, ...(filtered && record !== undefined && 'hasMore' in record ? { hasMore: false } : {}) }
      }
      if (record !== undefined && Array.isArray(record.workspaceIds)) {
        return { ...record, workspaceIds: record.workspaceIds.filter(id => workspace(principal, id)) }
      }
      if (record !== undefined && Array.isArray(record.archivedSessionIds)) {
        return { ...record, archivedSessionIds: record.archivedSessionIds.filter(id => session(principal, id)) }
      }
      if (record !== undefined && record.workspace !== undefined) {
        return { ...record, workspace: workspaceValue(principal, object(record.workspace) ? record.workspace : {}) }
      }
      return value
    },
    frame(principal, endpoint, value, correlation) {
      const frame = object(value) ? value : {}
      if (endpoint === '$events') {
        if (frame.type === 'ready') { correlation.clientId = frame.clientId as string; return value }
        if (frame.type === 'waterfall') {
          // Only a waterfall whose owning Session belongs to this principal is delivered;
          // a hidden recipient is released by the gateway with `next` (see modern-gateway).
          if (!session(principal, frame.agentId)) return null
          if (correlation.events.size >= 512) throw new Error('Too many pending Remote events')
          correlation.events.add(frame.eventId as string)
          return value
        }
        if (frame.type === 'cancel') return correlation.events.delete(frame.eventId as string) ? value : null
        if (frame.type !== 'emit') return null
        // Global registries (commands/change, credentials/reference-updated, llm/adapters-updated,
        // settings/document-updated, cordis/*-resolved, cordis/dynamic-*) carry no owner and are
        // therefore not shown to ordinary users.
        const args = arrayOf(frame.args) as Array<JsonObject | undefined>
        switch (frame.event) {
          case 'api-session/added': return session(principal, args[0]?.sessionId) ? value : null
          case 'api-session/activity':
          case 'api-session/error':
          case 'api-session/removed':
          case 'api-session/status':
          case 'agent-preset/selected': return session(principal, args[0]) ? value : null
          case 'goal/activation-changed': return session(principal, args[0]?.sessionId) ? value : null
          case 'cordis/request-run':
          case 'cordis/inspect-query': return session(principal, args[0]?.agentId) ? value : null
          default: return null
        }
      }
      if (principal.role === 'admin') return value
      if (endpoint === 'session/control') {
        if (frame.type === 'baseline') {
          const baseline = object(frame.value) ? frame.value : {}
          return { type: 'baseline', value: {
            queues: ownMap(principal, baseline.queues),
            jobs: ownMap(principal, baseline.jobs),
            projections: ownMap(principal, baseline.projections),
          } }
        }
        return session(principal, frame.sessionId) ? value : null
      }
      if (endpoint === 'workspace/follow') {
        if (frame.type === 'baseline') return { type: 'baseline', value: workspaceBaseline(principal, frame.value) }
        if (frame.type === 'order') return { ...frame, workspaceIds: arrayOf(frame.workspaceIds).filter(id => workspace(principal, id)) }
        if (frame.type === 'archived') return { ...frame, archivedSessionIds: arrayOf(frame.archivedSessionIds).filter(id => session(principal, id)) }
        if (frame.type === 'upsert') {
          const workspaceFrame = object(frame.workspace) ? frame.workspace : undefined
          return workspace(principal, workspaceFrame?.workspaceId) && workspaceFrame !== undefined
            ? { ...frame, workspace: workspaceValue(principal, workspaceFrame) }
            : null
        }
        if (frame.type === 'remove') return workspace(principal, frame.workspaceId) ? value : null
        return null
      }
      return value
    },
  }
}
