const { createClient } = require('redis');

/**
 * Session Store Interface
 * 
 * methods:
 * - init(): Promise<void>
 * - get(token): Promise<{user, expiresAt} | null>
 * - set(token, data, ttlMs): Promise<void>
 * - delete(token): Promise<void>
 * - clear(): Promise<void>
 * - destroy(): Promise<void>
 */

class MemoryStore {
    constructor() {
        this.sessions = new Map();
        this.userTokens = new Map();
        this.cleanupInterval = null;
    }

    async init() {
        console.log('Session Store: Using (In-Memory) Map');
        // Start proactive cleanup for memory store
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;
            for (const [token, session] of this.sessions.entries()) {
                if (session.expiresAt <= now) {
                    this.sessions.delete(token);
                    cleanedCount++;
                }
            }
            for (const [userId, entry] of this.userTokens.entries()) {
                if (!entry || entry.expiresAt <= now) {
                    this.userTokens.delete(userId);
                }
            }
            if (cleanedCount > 0) {
                console.log(`[MemoryStore] Cleaned ${cleanedCount} expired sessions`);
            }
        }, 60 * 60 * 1000); // Hourly
    }

    async get(token) {
        const session = this.sessions.get(token);
        if (!session) return null;
        if (session.expiresAt <= Date.now()) {
            this.sessions.delete(token);
            return null;
        }
        return session;
    }

    async set(token, user, ttlMs) {
        const expiresAt = Date.now() + ttlMs;
        this.sessions.set(token, { user, expiresAt });
    }

    async getUserToken(userId) {
        const entry = this.userTokens.get(userId);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.userTokens.delete(userId);
            return null;
        }
        return entry.token || null;
    }

    async setUserToken(userId, token, ttlMs) {
        const expiresAt = Date.now() + ttlMs;
        this.userTokens.set(userId, { token, expiresAt });
    }

    async deleteUserToken(userId) {
        this.userTokens.delete(userId);
    }

    async delete(token) {
        this.sessions.delete(token);
    }

    async clear() {
        this.sessions.clear();
        this.userTokens.clear();
    }

    async destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

class RedisStore {
    constructor(url) {
        this.client = createClient({ url });
        this.client.on('error', (err) => console.error('Redis Client Error', err));
        this.client.on('connect', () => console.log('Redis Client Connected'));
    }

    async init() {
        console.log('Session Store: Connecting to Redis...');
        await this.client.connect();
    }

    async get(token) {
        const data = await this.client.get(`sess:${token}`);
        if (!data) return null;
        try {
            const user = JSON.parse(data);
            // Redis manages TTL, so if we get it, it's valid.
            // But we might want to return simulated expiresAt if needed, 
            // though app logic usually just checks existence for validity.
            // We'll return a future expiresAt to satisfy the interface.
            return { user, expiresAt: Date.now() + 1000 * 60 * 60 * 24 }; 
        } catch (e) {
            console.error('Session parse error', e);
            return null;
        }
    }

    async set(token, user, ttlMs) {
        // SET key value PX milliseconds
        await this.client.set(`sess:${token}`, JSON.stringify(user), {
            PX: ttlMs
        });
    }

    async getUserToken(userId) {
        return await this.client.get(`user_sess:${userId}`);
    }

    async setUserToken(userId, token, ttlMs) {
        await this.client.set(`user_sess:${userId}`, token, { PX: ttlMs });
    }

    async deleteUserToken(userId) {
        await this.client.del(`user_sess:${userId}`);
    }

    async delete(token) {
        await this.client.del(`sess:${token}`);
    }

    async clear() {
        // Getting all keys is expensive in production. 
        // For 'switch database' feature which clears sessions:
        // ideally we strictly prefix and flush only those, or use FLUSHDB if dedicated DB.
        // For now, we'll implement a scan-delete which is safer but slower.
        let cursor = 0;
        do {
            const reply = await this.client.scan(cursor, {
                MATCH: 'sess:*',
                COUNT: 100
            });
            cursor = reply.cursor;
            const keys = reply.keys;
            if (keys.length > 0) {
                await this.client.del(keys);
            }
        } while (cursor !== 0);

        cursor = 0;
        do {
            const reply = await this.client.scan(cursor, {
                MATCH: 'user_sess:*',
                COUNT: 100
            });
            cursor = reply.cursor;
            const keys = reply.keys;
            if (keys.length > 0) {
                await this.client.del(keys);
            }
        } while (cursor !== 0);
    }

    async destroy() {
        await this.client.disconnect();
    }
}

// Factory
async function createSessionStore() {
    const useRedis = process.env.USE_REDIS === 'true';
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    let store;
    if (useRedis) {
        store = new RedisStore(redisUrl);
    } else {
        store = new MemoryStore();
    }

    await store.init();
    return store;
}

module.exports = { createSessionStore };
