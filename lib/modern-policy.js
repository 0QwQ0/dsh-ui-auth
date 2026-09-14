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
 * (DSH 0.1.2+). DSH 0.1.1-rc.2 keeps the legacy dotted/`apiProxy` path in `index.js`.
 */

export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 256

/** Own-session session methods addressed by `request.sessionId`. */
const SESSION_BY_ID = new Set(['prompt', 'attachment', 'cancel', 'rename', 'selectModel', 'updateQueue', 'fork'])
/** Own-workspace workspace methods addressed by `request.workspaceId`. */
const WORKSPACE_BY_ID = new Set(['rename', 'delete', 'insertBefore', 'insertSessionBefore'])
/** Read-only, owner-filtered session endpoints. */
const SESSION_READ = new Set(['list', 'search', 'modelCatalog', 'canOpenWorkspacePath'])
/** Flat read-only global metadata an ordinary user may see (redacted by the host). */
const SHARED_READ = new Set(['settings/describe', 'llm/listProviders', 'llm/listConfigurableProviders'])

export function remoteArgs(payload) {
  if (!object(payload) || Object.keys(payload).length !== 1 || !object(payload.args)) return undefined
  return payload.args
}

/** Normalize one endpoint's args into its request object (nested or flat). */
function requestOf(args) {
  if (object(args.request)) return args.request
  return args
}

export function createModernPolicy(owners) {
  const session = (principal, id) => nonempty(id) && (principal.role === 'admin' || owners.session(id) === principal.username)
  const workspace = (principal, id) => nonempty(id) && (principal.role === 'admin' || owners.workspace(id) === principal.username)
  const ownMap = (principal, value) => Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([id]) => session(principal, id)))
  const workspaceValue = (principal, value) => ({
    ...value,
    sessionIds: (value.sessionIds ?? []).filter(id => session(principal, id)),
  })
  const workspaceBaseline = (principal, value) => ({
    items: (value?.items ?? []).filter(item => workspace(principal, item.workspaceId)).map(item => workspaceValue(principal, item)),
    archivedSessionIds: (value?.archivedSessionIds ?? []).filter(id => session(principal, id)),
  })
  /** An agent-scoped verb is authorized by the Session that owns the agent. */
  const agent = (principal, args) => session(principal, args.agentId)

  function authorizeSession(args, principal) {
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
      if (namespace === 'session') {
        if (SESSION_READ.has(method)) return true
        if (method === 'page' || method === 'follow') return authorizeSession(args, principal)
        if (method === 'create') {
          // A deployment-provisioned Workspace owns the location; a client cannot override it with cwd.
          if (!workspace(principal, request.workspaceId) || request.cwd !== undefined) return false
          if (request.sessionId === undefined) return true
          if (!nonempty(request.sessionId)) return false
          return session(principal, request.sessionId) || !(await owners.sessionExists(request.sessionId))
        }
        if (SESSION_BY_ID.has(method)) return session(principal, request.sessionId)
        return false
      }
      if (namespace === 'workspace') {
        if (method === 'archiveSession') return session(principal, request.sessionId)
        if (WORKSPACE_BY_ID.has(method)) {
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
      if (['session/create', 'session/fork'].includes(endpoint) && nonempty(value?.sessionId)) {
        await owners.claimSession(value.sessionId, principal.username)
      }
      if (principal.role === 'admin') return value
      if (['session/list', 'session/search'].includes(endpoint)) {
        const items = (value?.items ?? []).filter(item => session(principal, item.sessionId))
        const filtered = items.length < (value?.items?.length ?? 0)
        return { ...value, items, ...(filtered && 'hasMore' in value ? { hasMore: false } : {}) }
      }
      if (object(value) && Array.isArray(value.workspaceIds)) return { ...value, workspaceIds: value.workspaceIds.filter(id => workspace(principal, id)) }
      if (object(value) && Array.isArray(value.archivedSessionIds)) return { ...value, archivedSessionIds: value.archivedSessionIds.filter(id => session(principal, id)) }
      if (value?.workspace !== undefined) return { ...value, workspace: workspaceValue(principal, value.workspace) }
      return value
    },
    frame(principal, endpoint, value, correlation) {
      if (endpoint === '$events') {
        if (value?.type === 'ready') { correlation.clientId = value.clientId; return value }
        if (value?.type === 'waterfall') {
          // Only a waterfall whose owning Session belongs to this principal is delivered;
          // a hidden recipient is released by the gateway with `next` (see modern-gateway).
          if (!session(principal, value.agentId)) return null
          if (correlation.events.size >= 512) throw new Error('Too many pending Remote events')
          correlation.events.add(value.eventId)
          return value
        }
        if (value?.type === 'cancel') return correlation.events.delete(value.eventId) ? value : null
        if (value?.type !== 'emit') return null
        // Global registries (commands/change, credentials/reference-updated, llm/adapters-updated,
        // settings/document-updated, cordis/*-resolved, cordis/dynamic-*) carry no owner and are
        // therefore not shown to ordinary users.
        switch (value.event) {
          case 'api-session/added': return session(principal, value.args?.[0]?.sessionId) ? value : null
          case 'api-session/activity':
          case 'api-session/error':
          case 'api-session/removed':
          case 'api-session/status':
          case 'agent-preset/selected': return session(principal, value.args?.[0]) ? value : null
          case 'goal/activation-changed': return session(principal, value.args?.[0]?.sessionId) ? value : null
          case 'cordis/request-run':
          case 'cordis/inspect-query': return session(principal, value.args?.[0]?.agentId) ? value : null
          default: return null
        }
      }
      if (principal.role === 'admin') return value
      if (endpoint === 'session/control') {
        if (value?.type === 'baseline') return { type: 'baseline', value: {
          queues: ownMap(principal, value.value?.queues),
          jobs: ownMap(principal, value.value?.jobs),
          projections: ownMap(principal, value.value?.projections),
        } }
        return session(principal, value?.sessionId) ? value : null
      }
      if (endpoint === 'workspace/follow') {
        if (value?.type === 'baseline') return { type: 'baseline', value: workspaceBaseline(principal, value.value) }
        if (value?.type === 'order') return { ...value, workspaceIds: (value.workspaceIds ?? []).filter(id => workspace(principal, id)) }
        if (value?.type === 'archived') return { ...value, archivedSessionIds: (value.archivedSessionIds ?? []).filter(id => session(principal, id)) }
        if (value?.type === 'upsert') return workspace(principal, value.workspace?.workspaceId) ? { ...value, workspace: workspaceValue(principal, value.workspace) } : null
        if (value?.type === 'remove') return workspace(principal, value.workspaceId) ? value : null
        return null
      }
      return value
    },
  }
}
