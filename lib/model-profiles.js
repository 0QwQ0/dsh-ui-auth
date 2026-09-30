/**
 * WP3：按用户隔离的模型配置存储与密钥托管。
 *
 * 设计要点（见 docs/RBAC-MODEL-PROFILES.md）：
 * - **按稳定 `uid`（uuid）分区**，不用用户名做键（用户名可改、可回收）。
 * - **私有配置**：`KDF(用户登录口令) → KEK → AES-256-GCM(API Key)`，KEK 只在**该用户会话内存**
 *   中存在；落盘的是密文，因此即使拿到存储或声称管理员身份也读不出（INV-1/INV-4）。
 * - **分享配置**：由服务端主密钥（宿主凭据记录 `dsh-auth/profile-master`）托管——分享语义本身
 *   要求"所有者离线时被授权者也能调用"，所以它必须可被服务端解密；这不影响私有配置的不可读性。
 * - **AAD 绑定**：`<uid>/<profileId>`，密文不能在另一个用户或另一个配置下重放。
 * - 所有读取入口都带 `ownerUid`，并用 `assertSameUser` 显式挡住跨用户读取（INV-2 的代码级守卫）。
 */
const KEY_MASTER = 'dsh-auth/profile-master';
const KEY_UIDS = 'dsh-auth/profile-uids';
const keyPrivate = (uid) => `dsh-auth/profile-private/${uid}`;
const keyShared = (uid) => `dsh-auth/profile-shared/${uid}`;
const keyGrants = (uid) => `dsh-auth/profile-grants/${uid}`;
const keyReceived = (uid) => `dsh-auth/profile-received/${uid}`;
/** 默认迭代次数（OWASP 对 PBKDF2-SHA256 的建议量级）；测试可显式传小值。 */
export const DEFAULT_KDF_ITERATIONS = 600_000;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromBase64 = (value) => new Uint8Array(Buffer.from(value, 'base64'));
function subtle() {
    const value = globalThis.crypto;
    if (value?.subtle === undefined)
        throw new Error('WebCrypto 不可用：无法进行配置密钥的加解密');
    return value.subtle;
}
function randomBytes(length) {
    const bytes = new Uint8Array(length);
    const value = globalThis.crypto;
    if (value?.getRandomValues === undefined)
        throw new Error('安全随机源不可用');
    value.getRandomValues(bytes);
    return bytes;
}
/** 跨用户读取的代码级守卫：调用者 uid 必须等于记录所有者 uid。 */
export function assertSameUser(callerUid, ownerUid) {
    if (callerUid !== ownerUid)
        throw new Error('拒绝跨用户读取模型配置（仅本人可读）');
}
/** 口令 → KEK（PBKDF2-SHA256）。 */
export async function deriveKek(password, salt, iterations) {
    const material = await subtle().importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, KEY_BYTES * 8);
    return new Uint8Array(bits);
}
async function encrypt(keyBytes, aad, plaintext) {
    const key = await subtle().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = randomBytes(IV_BYTES);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, encoder.encode(plaintext));
    return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}
async function decrypt(keyBytes, aad, iv, ct) {
    const key = await subtle().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(aad) }, key, fromBase64(ct));
    return decoder.decode(plain);
}
const aadOf = (uid, profileId) => `${uid}/${profileId}`;
/** 仅暴露不可逆提示：尾 4 位（长度为 0 时不显示）。 */
export function keyHint(apiKey) {
    return apiKey.length >= 4 ? `…${apiKey.slice(-4)}` : '…';
}
/** 用用户口令封存私有 API Key。 */
export async function sealPrivate(password, uid, profileId, apiKey, iterations = DEFAULT_KDF_ITERATIONS) {
    const salt = randomBytes(SALT_BYTES);
    const kek = await deriveKek(password, salt, iterations);
    const { iv, ct } = await encrypt(kek, aadOf(uid, profileId), apiKey);
    return { v: 1, alg: 'AES-256-GCM', kdf: { salt: toBase64(salt), iterations }, iv, ct };
}
/** 解开私有 API Key；口令错误或密文被篡改都会抛错（GCM 认证失败）。 */
export async function openPrivate(password, uid, profileId, sealed) {
    if (sealed.kdf === undefined)
        throw new Error('私有配置缺少 KDF 参数');
    const kek = await deriveKek(password, fromBase64(sealed.kdf.salt), sealed.kdf.iterations);
    return await decrypt(kek, aadOf(uid, profileId), sealed.iv, sealed.ct);
}
/** 用服务端主密钥封存分享配置的 API Key（服务端托管，供被授权者无人值守调用）。 */
export async function sealShared(master, ownerUid, profileId, apiKey) {
    const { iv, ct } = await encrypt(master, aadOf(ownerUid, profileId), apiKey);
    return { v: 1, alg: 'AES-256-GCM', iv, ct };
}
export async function openShared(master, ownerUid, profileId, sealed) {
    return await decrypt(master, aadOf(ownerUid, profileId), sealed.iv, sealed.ct);
}
/** 读取（必要时创建）服务端主密钥。 */
export async function loadMasterKey(seam) {
    const existing = await seam.readRaw(KEY_MASTER);
    if (existing !== undefined) {
        const parsed = JSON.parse(existing);
        if (parsed.v === 1 && typeof parsed.key === 'string' && parsed.key.length > 0)
            return fromBase64(parsed.key);
    }
    const created = randomBytes(KEY_BYTES);
    await seam.writeRaw(KEY_MASTER, JSON.stringify({ v: 1, key: toBase64(created) }));
    return created;
}
/** 按 uid 分区的模型配置存储。 */
export class ProfileStore {
    seam;
    constructor(seam) {
        this.seam = seam;
    }
    /** 用户名 → uid 的稳定映射（首次访问时分配）。 */
    async ensureUid(username) {
        const table = await this.readUids();
        const known = table.byName[username];
        if (known !== undefined)
            return known;
        const uid = crypto.randomUUID();
        table.byName[username] = uid;
        await this.write(KEY_UIDS, table);
        return uid;
    }
    async uidOf(username) {
        return (await this.readUids()).byName[username];
    }
    /** 读取某用户自己的私有配置列表（不返回 Key 材料）。 */
    async listPrivate(callerUid, ownerUid) {
        assertSameUser(callerUid, ownerUid);
        return (await this.readPrivateDoc(ownerUid)).profiles.map(({ sealed: _sealed, ...meta }) => meta);
    }
    /** 读取一条私有配置（含密文；仅所有者本人）。 */
    async readPrivate(callerUid, ownerUid, profileId) {
        assertSameUser(callerUid, ownerUid);
        return (await this.readPrivateDoc(ownerUid)).profiles.find(profile => profile.profileId === profileId);
    }
    /** 写入/覆盖一条私有配置。 */
    async writePrivate(ownerUid, profile) {
        const doc = await this.readPrivateDoc(ownerUid);
        const profiles = doc.profiles.filter(item => item.profileId !== profile.profileId);
        profiles.push(profile);
        await this.write(keyPrivate(ownerUid), { v: 1, profiles });
    }
    async removePrivate(ownerUid, profileId) {
        const doc = await this.readPrivateDoc(ownerUid);
        await this.write(keyPrivate(ownerUid), { v: 1, profiles: doc.profiles.filter(item => item.profileId !== profileId) });
    }
    async listShared(ownerUid) {
        return (await this.readSharedDoc(ownerUid)).profiles;
    }
    async writeShared(ownerUid, profile) {
        const doc = await this.readSharedDoc(ownerUid);
        const profiles = doc.profiles.filter(item => item.profileId !== profile.profileId);
        profiles.push(profile);
        await this.write(keyShared(ownerUid), { v: 1, profiles });
    }
    async removeShared(ownerUid, profileId) {
        const doc = await this.readSharedDoc(ownerUid);
        await this.write(keyShared(ownerUid), { v: 1, profiles: doc.profiles.filter(item => item.profileId !== profileId) });
    }
    async readGrants(ownerUid) {
        const raw = await this.seam.readRaw(keyGrants(ownerUid));
        if (raw === undefined)
            return { v: 1, grants: {} };
        const parsed = JSON.parse(raw);
        return parsed.v === 1 && typeof parsed.grants === 'object' && parsed.grants !== null ? parsed : { v: 1, grants: {} };
    }
    async writeGrants(ownerUid, table) {
        await this.write(keyGrants(ownerUid), table);
    }
    /** 被授权者侧收到的分享清单（不含 Key 材料）。 */
    async readReceived(targetUid) {
        const raw = await this.seam.readRaw(keyReceived(targetUid));
        if (raw === undefined)
            return [];
        const parsed = JSON.parse(raw);
        return parsed.v === 1 && Array.isArray(parsed.shares) ? parsed.shares : [];
    }
    async writeReceived(targetUid, shares) {
        await this.write(keyReceived(targetUid), { v: 1, shares });
    }
    async readUids() {
        const raw = await this.seam.readRaw(KEY_UIDS);
        if (raw === undefined)
            return { v: 1, byName: {} };
        const parsed = JSON.parse(raw);
        return parsed.v === 1 && typeof parsed.byName === 'object' && parsed.byName !== null ? { v: 1, byName: parsed.byName } : { v: 1, byName: {} };
    }
    async readPrivateDoc(uid) {
        const raw = await this.seam.readRaw(keyPrivate(uid));
        if (raw === undefined)
            return { v: 1, profiles: [] };
        const parsed = JSON.parse(raw);
        return parsed.v === 1 && Array.isArray(parsed.profiles) ? { v: 1, profiles: parsed.profiles } : { v: 1, profiles: [] };
    }
    async readSharedDoc(uid) {
        const raw = await this.seam.readRaw(keyShared(uid));
        if (raw === undefined)
            return { v: 1, profiles: [] };
        const parsed = JSON.parse(raw);
        return parsed.v === 1 && Array.isArray(parsed.profiles) ? { v: 1, profiles: parsed.profiles } : { v: 1, profiles: [] };
    }
    async write(key, value) {
        await this.seam.writeRaw(key, JSON.stringify(value));
    }
}
