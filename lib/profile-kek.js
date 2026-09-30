/**
 * WP4：会话密钥生命周期与私有配置的**信封加密**（见 docs/RBAC-MODEL-PROFILES.md 附录 A.5）。
 *
 * 结构：
 *   userKek = PBKDF2-SHA256(登录口令, 用户级 salt, ≥600k)      ← 只存在于该用户会话内存
 *   dek     = 随机 32 字节                                       ← 每条私有配置一个
 *   记录     = { wrappedDek: seal(userKek, aad, dek), sealed: seal(dek, aad, apiKey) }
 *   aad     = `${uid}/${profileId}`（密文不能在别处重放）
 *
 * 因此：存储里没有明文 Key，也没有能解出它的单一服务端密钥；口令变更只需用旧 KEK 解出 DEK
 * 再用新 KEK 重包裹；会话**不持有口令**，登出即丢弃 userKek。
 */
import { DEFAULT_KDF_ITERATIONS, deriveKek, openUnder, randomDek, sealUnder, } from './model-profiles.js';
const keyKdf = (uid) => `dsh-auth/profile-kdf/${uid}`;
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromBase64 = (value) => new Uint8Array(Buffer.from(value, 'base64'));
function randomSalt() {
    const salt = new Uint8Array(16);
    const value = globalThis.crypto;
    if (value?.getRandomValues === undefined)
        throw new Error('安全随机源不可用');
    value.getRandomValues(salt);
    return salt;
}
const aadOf = (uid, profileId) => `${uid}/${profileId}`;
/** 读取（必要时创建）用户级 KDF 参数。每人一份，改密时沿用同一 salt 亦可重新生成。 */
export async function ensureUserKdf(seam, uid, iterations = DEFAULT_KDF_ITERATIONS) {
    const raw = await seam.readRaw(keyKdf(uid));
    if (raw !== undefined) {
        const parsed = JSON.parse(raw);
        if (parsed.v === 1 && typeof parsed.salt === 'string' && typeof parsed.iterations === 'number') {
            return { salt: parsed.salt, iterations: parsed.iterations };
        }
    }
    const salt = toBase64(randomSalt());
    await seam.writeRaw(keyKdf(uid), JSON.stringify({ v: 1, salt, iterations }));
    return { salt, iterations };
}
/** 读取用户级 KDF 参数（不存在则 undefined，用于判断该用户是否已启用私有配置）。 */
export async function readUserKdf(seam, uid) {
    const raw = await seam.readRaw(keyKdf(uid));
    if (raw === undefined)
        return undefined;
    const parsed = JSON.parse(raw);
    return parsed.v === 1 && typeof parsed.salt === 'string' && typeof parsed.iterations === 'number'
        ? { salt: parsed.salt, iterations: parsed.iterations }
        : undefined;
}
/** 写入用户级 KDF 参数（改密时换新 salt）。 */
export async function writeUserKdf(seam, uid, value) {
    await seam.writeRaw(keyKdf(uid), JSON.stringify({ v: 1, salt: value.salt, iterations: value.iterations }));
}
/** 生成一组新的用户级 KDF 参数（不落盘）。 */
export function newUserKdf(iterations = DEFAULT_KDF_ITERATIONS) {
    return { salt: toBase64(randomSalt()), iterations };
}
/** 口令 + 用户级 salt → userKek（会话内存中持有；不保存口令）。 */
export async function deriveUserKek(password, saltB64, iterations) {
    return await deriveKek(password, fromBase64(saltB64), iterations);
}
/** 用 userKek 封存一条私有配置：随机 DEK 包进 wrappedDek，API Key 用 DEK 加密。 */
export async function sealPrivateWithKek(userKek, uid, profileId, apiKey) {
    const dek = randomDek();
    const aad = aadOf(uid, profileId);
    return { wrappedDek: await sealUnder(userKek, aad, Buffer.from(dek).toString('base64')), sealed: await sealUnder(dek, aad, apiKey) };
}
/** 解开一条私有配置的 API Key；userKek 不对、篡改或 AAD 不匹配都会抛错。 */
export async function openPrivateWithKek(userKek, uid, profileId, wrappedDek, sealed) {
    const aad = aadOf(uid, profileId);
    const dek = fromBase64(await openUnder(userKek, aad, wrappedDek));
    return await openUnder(dek, aad, sealed);
}
/** 口令变更：用旧 KEK 解出 DEK、再用新 KEK 重包裹（改密流程持有明文口令那一刻完成）。 */
export async function rewrapWithKek(oldKek, newKek, uid, profileId, wrappedDek) {
    const aad = aadOf(uid, profileId);
    const dek = fromBase64(await openUnder(oldKek, aad, wrappedDek));
    return await sealUnder(newKek, aad, Buffer.from(dek).toString('base64'));
}
/** 登录会话持有的 userKek（token → uid + KEK）。登出/过期/改密即丢弃。 */
export class KekRegistry {
    byToken = new Map();
    set(token, uid, kek) {
        this.byToken.set(token, { uid, kek });
    }
    get(token) {
        return this.byToken.get(token);
    }
    /** 解锁某条配置所需的 KEK（仅当会话 uid 与配置所有者一致）。 */
    kekFor(token, ownerUid) {
        const entry = this.byToken.get(token);
        if (entry === undefined || entry.uid !== ownerUid)
            return undefined;
        return entry.kek;
    }
    /** 丢弃单个会话（登出、会话失效）。 */
    drop(token) {
        this.byToken.delete(token);
    }
    /** 丢弃某个用户的全部会话（用户被删除、口令被重置、角色变更）。 */
    dropByUid(uid) {
        let dropped = 0;
        for (const [token, entry] of [...this.byToken.entries()]) {
            if (entry.uid !== uid)
                continue;
            this.byToken.delete(token);
            dropped += 1;
        }
        return dropped;
    }
    size() {
        return this.byToken.size;
    }
}
