export class SessionManager {
    sessions = new Map();
    getOrCreate(key, channel = "unknown") {
        let session = this.sessions.get(key);
        if (!session) {
            session = {
                key,
                channel,
                history: [],
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            this.sessions.set(key, session);
        }
        return session;
    }
    get(key) {
        return this.sessions.get(key);
    }
    has(key) {
        return this.sessions.has(key);
    }
    delete(key) {
        return this.sessions.delete(key);
    }
    clear(key) {
        const session = this.sessions.get(key);
        if (session) {
            session.history = [];
            session.updatedAt = new Date();
        }
    }
    list() {
        return [...this.sessions.values()];
    }
    get size() {
        return this.sessions.size;
    }
}
