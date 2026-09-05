# DSH 0.1.2 transport compatibility (unreleased)

This adapter targets the `0.1.2-rc.1` Connection/Typert protocol. It does not modify Harness files. The original dotted-RPC / `apiProxy` adapter remains selected on older hosts without `connection.authorizeIndex`.

## What changed

The newer Host uses `/api/<namespace>/<method>` with `payload: { args: ... }`, a bidirectional `/api/remote.mux`, and `$events` / `$events/result` for forwarded events and interactive replies. `session/page` and `session/follow` use a durable `request.address`, not a top-level `sessionId`.

The modern gateway:

- validates the dsh-ui-auth login before dispatch;
- uses Connection's public token exchange internally so a successful plugin login can open the native UI without distributing a second bearer credential;
- retains the native Host/Origin fence on HTTP and WebSocket requests;
- checks Session/Workspace ownership before unary calls and each stream delivery;
- filters all Session control baseline maps, Workspace baseline/membership/order/archive frames, and reviewed Host events;
- binds event replies to the login session, active event client and delivered event ID; hidden recipients release their delivery with `next` so they cannot strand an owner's interaction;
- waits for ownership persistence before returning a newly created Session;
- closes stream sockets after logout, account removal or role change, with a one-second revocation check;
- uses native lifecycle-owned timers rather than the removed `timer` service;
- encodes newly created usernames that are not valid CredentialKey segments while retaining existing lowercase record keys.

This is a transport/ownership compatibility contribution, not a claim of process, filesystem, arbitrary-tool or tenant isolation. The default broad-version compatibility declaration is unchanged: verify your complete plugin composition and browser flows before marking another version compatible.

## Ordinary-user policy on modern hosts

Unknown API endpoints and unknown WebSocket upgrades are denied for ordinary users. Administrators retain Host administration access. A third-party route must register an explicit policy before ordinary users can use it.

The built-in ordinary-user surface covers own Session create/fork/page/follow/prompt/attachment/model selection/queue/cancel, Session lists/search/control, owned Workspace mutations/follow, Skill catalog, and shared read-only model/settings metadata. The Host remains responsible for schema validation and validating a subagent's durable parent address.

Workspace provisioning is deployment-owned. An ordinary user can create a Session only in an assigned Workspace, without a `cwd` override. Workspace creation, native filesystem opening, commands (which may alter permissions), plugin management, credentials, global settings writes and unreviewed capabilities require an administrator or a reviewed deployment policy. This restriction is intentional: response filtering alone must not authorize arbitrary Host directories.

Existing records without an owner remain administrator-only. A trusted Host provisioner must assign the intended Workspace to a user; the adapter does not guess ownership from a directory name, browser field or shared default Workspace. Session IDs minted by background jobs similarly need explicit attribution by their owning plugin.

## Downstream integration API

On a modern Host the plugin provides `ctx.get('uiAuth')`. Only trusted Host plugins can register these policies; they are not exposed as browser or model tools.

| Method | Contract |
| --- | --- |
| `ready` | Promise resolving after account and ownership state has loaded. Await it in Host provisioning code. |
| `principal(request)` | Immutable `{ username, role }` for this admitted IncomingMessage, or undefined. Never derive identity from user-supplied headers or a body field. |
| `ownerOfSession(id)` / `ownerOfWorkspace(id)` | Current recorded owner; unclaimed objects resolve to admin. |
| `claimSession(id, username)` / `claimWorkspace(id, username)` | Wait for readiness and persist attribution before publishing an object. Unknown users, invalid IDs and conflicting existing owners are rejected. The trusted caller must validate the authoritative object. |
| `registerPolicy(id, rules)` | Register a unique policy, returning its disposer. Ambiguous matches fail closed. |

The owner of a business module must still partition its own state, authorize IDs, attribute background work and filter events. A successful login or a registered route does not isolate a plugin's global maps, database, files or memory service.

Example for an already scoped read endpoint:

```js
const auth = ctx.get('uiAuth')
if (auth === undefined) throw new Error('dsh-ui-auth modern gateway is required')
ctx.effect(() => auth.registerPolicy('reports', {
  http: {
    matches: ({ pathname, method }) => method === 'GET' && pathname === '/api/reports/mine',
    authorize: principal => principal.role === 'user' || principal.role === 'admin',
  },
}), 'reports: access policy')

// Inside the separately registered route handler:
// const principal = auth.principal(request)
// const reports = await store.listByOwner(principal.username)
```

`http.authorize(principal, request)` must return a boolean/Promise<boolean> and must not consume the request body. For mutations, the route owner uses the trusted principal to validate body object IDs before performing the operation. A route policy may admit the endpoint, while the handler remains responsible for per-object authorization.

Custom logical streams use:

```js
{
  stream: {
    matches: endpoint => endpoint === 'reports/follow',
    authorize: (principal, payload) => store.canObserve(principal.username, payload.args.request.reportId),
    project: (principal, value) => value.owner === principal.username ? value : null,
  },
}
```

Stream authorization is checked before opening and on each delivery; `null` suppresses a frame. Removing a stream policy prevents further delivery. An `upgrade` policy uses the same `matches({ pathname })` / `authorize(principal, request)` shape for a custom WebSocket transport. Its owner must implement and filter that transport; the gateway checks login revocation but cannot infer its message semantics or resource ownership changes.

Policy code runs with trusted Host privileges. Do not use `authorize: () => true` for an existing global business surface and call it user isolation.

## Validation

Existing checks are still required:

```sh
npm test
npm run store:check
```

`npm test` includes the modern policy regressions. For real transport verification, build an unmodified Harness checkout at `dsh-v0.1.2-rc.1`, then run:

```sh
DSH_COMPAT_SOURCE=/absolute/path/to/deepseek-harness npm run test:compat:0.1.2
```

The test uses that checkout's real Cordis, Credentials, WebServer, Connection and Typert Gateway with fixture domain methods. It creates temporary credentials and random loopback listeners and cleans them up. It does not use an installed production Profile, a model or an external business backend.

Covered behaviors include native-index access after plugin login; nested Session addresses; other-user denial; filtered list/control/Host event frames; durable create attribution; default-closed custom APIs and explicit policy admission; logout revocation; three accounts; approval reply correlation and hidden recipients; current CredentialKey validation.

Full browser acceptance, deployment-specific Workspace provisioning, background object ownership, downstream state partitioning and arbitrary third-party plugins remain separate integration gates. `147/147` in the existing security suite is that suite's result, not a universal security certification.
