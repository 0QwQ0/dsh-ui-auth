/**
 * WP4 / R1-ii：按用户配置注册独立的 LLM provider 路由。
 *
 * 依据官方 `@deepseek-ai/dsh-llm-deepseek-api-key` 的接线方式（同一套 helper）：
 *   registerDeepSeekProvider(ctx, provider, { options, providerName, resolveAuth, discoverModels })
 * 差别只在**认证来源**：
 *   - 官方：`connection.apiKeyEnv`（凭据引用）→ `credentials.resolve(ref)` → `x-api-key` 头；
 *   - 本插件：`resolveAuth()` 在调用瞬间从**我们自己的加密存储**解密该用户的 Key
 *     （分享配置用服务端主密钥；私有配置需该用户会话 KEK，未解锁即抛错 → fail-closed）。
 *
 * 因此：用户私有 Key **不写入**宿主明文凭据存储（INV-4 保持成立），也不必重写协议实现。
 * 每个"用户配置"对应一条路由（如 `ui-auth-a1b2c3d4`），路由生命周期跟随配置的增删。
 */
/** 把一个 profileId 映射成宿主可接受的 provider 路由 id（小写+连字符）。 */
export function routeIdOf(profileId, namespace = 'ui-auth') {
    const compact = profileId.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${namespace}-${compact.slice(0, 12)}`;
}
/**
 * profileId → 释放函数的登记表。同一配置重复 ensure 不会重复注册；
 * 更新（模型/标签变化）时先释放再注册，保证路由与配置一致。
 */
export class UserRouteRegistry {
    deps;
    routes = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    /** 确保某条配置的路由存在且与当前签名一致；返回是否发生了（重新）注册。 */
    ensure(spec) {
        const signature = `${spec.routeId}|${spec.model}|${spec.baseUrl ?? ''}|${spec.label}`;
        const current = this.routes.get(spec.profileId);
        if (current !== undefined && current.signature === signature)
            return false;
        if (current !== undefined)
            this.dispose(spec.profileId);
        try {
            const dispose = this.deps.register(spec);
            this.routes.set(spec.profileId, { signature, dispose });
            return true;
        }
        catch (error) {
            this.deps.onError?.(`注册 provider 路由失败（${spec.routeId}）`, error);
            return false;
        }
    }
    /** 释放某条配置的路由（删除配置、撤销分享时调用）。 */
    dispose(profileId) {
        const current = this.routes.get(profileId);
        if (current === undefined)
            return false;
        this.routes.delete(profileId);
        try {
            current.dispose();
        }
        catch (error) {
            this.deps.onError?.(`释放 provider 路由失败（${profileId}）`, error);
        }
        return true;
    }
    /** 释放全部路由（插件卸载时）。 */
    disposeAll() {
        const count = this.routes.size;
        for (const profileId of [...this.routes.keys()])
            this.dispose(profileId);
        return count;
    }
    has(profileId) {
        return this.routes.has(profileId);
    }
    size() {
        return this.routes.size;
    }
    routeIds() {
        return [...this.routes.keys()];
    }
}
/**
 * 真实注册函数：动态导入宿主包（缺失时返回 undefined，由调用方决定 fail-closed 还是降级）。
 *
 * 这里刻意用**变量化的模块名**做动态导入：`@deepseek-ai/dsh-llm-deepseek` 等包由宿主在运行期提供，
 * 不在本插件的依赖里，写成字面量会让 `tsc` 去解析一个我们不安装的包。变量化后类型为 `any`，
 * 我们只按下文实际用到的成员取用，并保留结构校验（缺 `registerDeepSeekProvider` 即视为不可用）。
 */
async function importHostModule(name) {
    try {
        return await import(name);
    }
    catch (error) {
        return undefined;
    }
}
export async function createDeepSeekRegistrar(ctx) {
    const llm = ctx.get('llm');
    if (llm === undefined || typeof llm.registerConfigurableProviders !== 'function') {
        return undefined;
    }
    const deepseek = await importHostModule('@deepseek-ai/dsh-llm-deepseek');
    if (deepseek === undefined)
        return undefined;
    const registerDeepSeekProvider = deepseek.registerDeepSeekProvider;
    const catalogModelInfo = deepseek.catalogModelInfo;
    const deepSeekConfigFields = deepseek.deepSeekConfigFields;
    const plainOptions = deepseek.plainOptions;
    const resolveAdapterOptions = deepseek.resolveAdapterOptions;
    if (typeof registerDeepSeekProvider !== 'function' || typeof plainOptions !== 'function'
        || typeof resolveAdapterOptions !== 'function' || typeof catalogModelInfo !== 'function') {
        return undefined;
    }
    const launch = await importHostModule('@deepseek-ai/dsh-launch-environment');
    const launchEnvironmentOf = launch?.launchEnvironmentOf;
    if (typeof launchEnvironmentOf !== 'function')
        return undefined;
    return (spec) => {
        // 该路由的连接事实：沿用宿主默认的协议配置，仅把模型列表收窄到该配置声明的模型。
        const baseFields = plainOptions(deepSeekConfigFields);
        const declared = Array.isArray(baseFields.models) ? baseFields.models : [];
        const matched = declared.filter(model => model.id === spec.model);
        const config = {
            ...baseFields,
            ...(spec.baseUrl === undefined ? {} : { baseURL: spec.baseUrl }),
            models: matched.length > 0 ? matched : [{ id: spec.model }],
        };
        const options = () => resolveAdapterOptions(config, launchEnvironmentOf(ctx));
        const registered = registerDeepSeekProvider(ctx, spec.routeId, {
            options,
            providerName: spec.label,
            // 注入点：调用瞬间用我们自己的存储解密该用户的 Key（官方这里读凭据引用）。
            resolveAuth: async () => ({ headers: { 'x-api-key': await spec.resolveKey() } }),
            discoverModels: (provider) => {
                const connection = options();
                return Promise.resolve(connection.models.map(model => catalogModelInfo(provider, model)));
            },
        });
        return typeof registered === 'function' ? registered : () => { };
    };
}
