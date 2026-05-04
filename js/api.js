// 开发时用绝对地址，部署后同源自动适配
const API_BASE = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? 'http://localhost:8001' : '';

const api = {
  token: '',
  async post(path, body) {
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(API_BASE + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '请求失败');
    return data;
  },
  async get(path) {
    const opts = { method: 'GET', headers: {} };
    if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(API_BASE + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '请求失败');
    return data;
  },
  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem('xiangqi-token-v1', t);
    else localStorage.removeItem('xiangqi-token-v1');
  },
  loadToken() {
    this.token = localStorage.getItem('xiangqi-token-v1') || '';
  },

  // ---- 房间 API ----
  async createRoom(gameType, aiLevel) {
    return this.post('/api/room/create', { game_type: gameType, ai_level: aiLevel || 1 });
  },
  async joinRoom(code) {
    return this.post(`/api/room/join/${code}`, {});
  },
  async roomMove(code, fromR, fromC, toR, toC, fen) {
    return this.post(`/api/room/${code}/move`, { from_r: fromR, from_c: fromC, to_r: toR, to_c: toC, fen });
  },
  async roomPoll(code, since) {
    return this.get(`/api/room/${code}/poll?since=${since}`);
  },
  async roomFinish(code, result) {
    return this.post(`/api/room/${code}/finish?result=${result}`, {});
  },
  async getBattleStats() {
    return this.get('/api/battles/stats');
  },
};

if (typeof window !== 'undefined') {
  window.api = api;
  api.loadToken();
}
