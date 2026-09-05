/** Reviewed DSH 0.1.2 Remote surface. Unknown user endpoints fail closed. */
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 256

const SESSION_METHODS = new Set(['page', 'follow', 'rename', 'selectModel', 'prompt', 'attachment', 'updateQueue', 'cancel', 'fork'])
const WORKSPACE_METHODS = new Set(['rename', 'delete', 'insertBefore', 'insertSessionBefore', 'archiveSession'])
const READ_METHODS = new Set(['session/list', 'session/search', 'session/modelCatalog', 'session/canOpenWorkspacePath', 'settings/describe', 'llm/listProviders', 'llm/listConfigurableProviders'])
const SHARED_EVENTS = new Set(['llm/adapters-updated'])
const SESSION_EVENTS = new Set(['api-session/activity', 'api-session/error', 'api-session/removed', 'api-session/status', 'commands/change', 'agent-preset/selected'])

export function remoteArgs(payload) {
  if (!object(payload) || Object.keys(payload).length !== 1 || !object(payload.args)) return undefined
  return payload.args
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

  return {
    session, workspace,
    async authorize(principal, endpoint, payload, stream = false) {
      const args = remoteArgs(payload)
      if (args === undefined) return false
      if (principal.role === 'admin') return true
      const request = object(args.request) ? args.request : args
      if (stream && ['$events', 'session/control', 'workspace/follow'].includes(endpoint)) return true
      if (!stream && READ_METHODS.has(endpoint)) return true
      const [namespace, method, extra] = endpoint.split('/')
      if (extra !== undefined) return false
      if (namespace === 'session' && ['page', 'follow'].includes(method)) {
        const address = request.address
        if (address?.kind === 'session') return session(principal, address.sessionId)
        // The Session Controller verifies the child's durable parent and mode before opening it.
        if (address?.kind === 'subagent') return session(principal, address.parentSessionId) && nonempty(address.childSessionId)
        return false
      }
      if (namespace === 'session' && SESSION_METHODS.has(method)) return session(principal, request.sessionId)
      if (endpoint === 'session/create' && !stream) {
        // Approved Workspace identity owns the location; a client cannot override it with cwd.
        if (!workspace(principal, request.workspaceId) || request.cwd !== undefined) return false
        if (request.sessionId === undefined) return true
        if (!nonempty(request.sessionId)) return false
        return session(principal, request.sessionId) || !(await owners.sessionExists(request.sessionId))
      }
      if (namespace === 'workspace' && WORKSPACE_METHODS.has(method)) {
        if (method === 'archiveSession') return session(principal, request.sessionId)
        if (!workspace(principal, request.workspaceId)) return false
        if (request.beforeWorkspaceId !== undefined && !workspace(principal, request.beforeWorkspaceId)) return false
        return [request.sessionId, request.beforeSessionId].every(id => id === undefined || session(principal, id))
      }
      if (endpoint === 'skills/list') return session(principal, request.sessionId)
      // Commands may change permissions, filesystem access or plugins; deployments must explicitly opt in.
      return false
    },
    async result(principal, endpoint, value) {
      if (['session/create', 'session/fork'].includes(endpoint) && nonempty(value?.sessionId)) {
        await owners.claimSession(value.sessionId, principal.username)
      }
      if (principal.role === 'admin') return value
      if (['session/list', 'session/search'].includes(endpoint)) {
        const items = (value?.items ?? []).filter(item => session(principal, item.sessionId))
        return { ...value, items, ...(items.length < value.items.length && 'hasMore' in value ? { hasMore: false } : {}) }
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
          if (!session(principal, value.agentId)) return null
          if (correlation.events.size >= 512) throw new Error('Too many pending Remote events')
          correlation.events.add(value.eventId)
          return value
        }
        if (value?.type === 'cancel') return correlation.events.delete(value.eventId) ? value : null
        if (principal.role === 'admin') return value
        if (value?.type !== 'emit') return null
        if (SHARED_EVENTS.has(value.event)) return value
        const id = value.event === 'api-session/added' ? value.args?.[0]?.sessionId : value.args?.[0]
        if ((value.event === 'api-session/added' || SESSION_EVENTS.has(value.event)) && session(principal, id)) return value
        return null
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
        if (value?.type === 'order') return { ...value, workspaceIds: value.workspaceIds.filter(id => workspace(principal, id)) }
        if (value?.type === 'archived') return { ...value, archivedSessionIds: value.archivedSessionIds.filter(id => session(principal, id)) }
        if (value?.type === 'upsert') return workspace(principal, value.workspace?.workspaceId) ? { ...value, workspace: workspaceValue(principal, value.workspace) } : null
        if (value?.type === 'remove') return workspace(principal, value.workspaceId) ? value : null
        return null
      }
      return value
    },
  }
}
