/**
 * Pikafish WASM Web Worker 桥接器
 * 负责加载 Worker、发送 UCI 命令、解析 bestmove
 */

class PikafishBridge {
  constructor(workerPath) {
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.workerPath = workerPath || 'js/pikafish/pikafish.worker.js';
    this._initOk = false;
    this.lastInfo = { depth: 0, nodes: 0, score: 0, nps: 0, time: 0 };
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.workerPath);
        this.worker.onmessage = (e) => {
          if (e.data.type === 'info') {
            const line = e.data.data || '';
            // 解析 info depth ... 用于 UI 显示
            const depthM = line.match(/\bdepth\s+(\d+)/);
            const nodesM = line.match(/\bnodes\s+(\d+)/);
            const scoreM = line.match(/\bscore\s+cp\s+([-\d]+)/);
            const npsM = line.match(/\bnps\s+(\d+)/);
            const timeM = line.match(/\btime\s+(\d+)/);
            if (depthM) this.lastInfo.depth = parseInt(depthM[1], 10);
            if (nodesM) this.lastInfo.nodes = parseInt(nodesM[1], 10);
            if (scoreM) this.lastInfo.score = parseInt(scoreM[1], 10);
            if (npsM) this.lastInfo.nps = parseInt(npsM[1], 10);
            if (timeM) this.lastInfo.time = parseInt(timeM[1], 10);
            // 把 Pikafish 的思考过程输出到控制台，方便调试
            if (/error|failed|string error/i.test(line)) {
              console.error('[Pikafish]', line);
            } else {
              console.log('[Pikafish]', line);
            }
            return;
          }
          if (e.data.type === 'ready') {
            this.worker.postMessage({ cmd: 'init' });
          } else if (e.data.type === 'initok') {
            this._initOk = true;
            this.ready = true;
            console.log('[PikafishBridge] NNUE engine ready');
            resolve(true);
          } else if (e.data.type === 'error') {
            console.error('Pikafish worker error:', e.data.data);
            reject(new Error(e.data.data));
          }
        };
        this.worker.onerror = (err) => {
          console.error('Pikafish worker load error:', err);
          reject(err);
        };
      } catch (err) {
        reject(err);
      }
    });
    return this.initPromise;
  }

  // 转换我们的 FEN 为 Pikafish FEN（H->N, E->B）
  static convertFEN(fen) {
    const parts = fen.split(' ');
    const board = parts[0]
      .replace(/H/g, 'N')
      .replace(/h/g, 'n')
      .replace(/E/g, 'B')
      .replace(/e/g, 'b');
    return [board, ...parts.slice(1)].join(' ');
  }

  // 将 Pikafish UCI move (如 a0a1) 转为内部坐标
  static uciToMove(uci) {
    if (!uci || uci.length < 4 || uci === '(none)') return null;
    const fromC = uci.charCodeAt(0) - 'a'.charCodeAt(0);
    const fromR = parseInt(uci[1], 10);
    const toC = uci.charCodeAt(2) - 'a'.charCodeAt(0);
    const toR = parseInt(uci[3], 10);
    if (
      isNaN(fromR) || isNaN(toR) ||
      fromC < 0 || fromC > 8 || toC < 0 || toC > 8 ||
      fromR < 0 || fromR > 9 || toR < 0 || toR > 9
    ) {
      return null;
    }
    return { fromR, fromC, toR, toC };
  }

  async go(fen, depthOrTime) {
    if (!this.ready) await this.init();
    return new Promise((resolve, reject) => {
      const pikaFEN = PikafishBridge.convertFEN(fen);
      const depth = typeof depthOrTime === 'number' && depthOrTime < 100 ? depthOrTime : 10;
      const movetime = typeof depthOrTime === 'number' && depthOrTime >= 100 ? depthOrTime : 0;

      const handler = (e) => {
        const data = e.data;
        if (data.type === 'bestmove') {
          this.worker.removeEventListener('message', handler);
          console.log('[Pikafish] bestmove:', data.bestmove, 'for FEN:', pikaFEN);
          const move = PikafishBridge.uciToMove(data.bestmove);
          if (move) {
            resolve(move);
          } else {
            reject(new Error('Invalid bestmove: ' + data.bestmove));
          }
        } else if (data.type === 'error') {
          this.worker.removeEventListener('message', handler);
          reject(new Error(data.data));
        }
      };
      this.worker.addEventListener('message', handler);

      if (movetime > 0) {
        this.worker.postMessage({ cmd: 'go', fen: pikaFEN, movetime });
      } else {
        this.worker.postMessage({ cmd: 'go', fen: pikaFEN, depth });
      }
    });
  }

  async ucinewgame() {
    if (!this.ready) await this.init();
    this.worker.postMessage({ cmd: 'newgame' });
  }
}

// 全局单例
const pikafishBridge = new PikafishBridge();

if (typeof window !== 'undefined') {
  window.PikafishBridge = PikafishBridge;
  window.pikafishBridge = pikafishBridge;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PikafishBridge, pikafishBridge };
}
