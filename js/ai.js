/**
 * 中国象棋 AI 引擎
 * 1-3级：Minimax + Alpha-Beta + 综合局面评估（手写JS）
 * 4-10级：Pikafish WASM（Web Worker + UCI）
 */

const AI_TITLES = {
  1: '学徒初段', 2: '学徒中段', 3: '学徒高段',
  4: '业余初段', 5: '业余中段', 6: '业余高段',
  7: '地方大师', 8: '棋协大师', 9: '特级大师', 10: '天元/棋神',
};

// JS AI 配置（1-3级）——1级即具备原4级实力，避免主动送子
const JS_CONFIG = {
  1: { depth: 2, mistakeRate: 0.03, randomTopN: 3 },
  2: { depth: 2, mistakeRate: 0.01, randomTopN: 2 },
  3: { depth: 2, mistakeRate: 0.00, randomTopN: 1 },
};

// Pikafish 配置（4-10级）——改用 movetime（毫秒）控制思考时间
// wasm-single 在浏览器中性能约为原生 1/10~1/20，需要给足时间才能体现 NNUE 实力
const PIKA_CONFIG = {
  4: { depth: 8,  movetime: 1500 },  // 业余初段
  5: { depth: 10, movetime: 2000 },  // 业余中段
  6: { depth: 12, movetime: 2500 },  // 业余高段
  7: { depth: 14, movetime: 3000 },  // 地方大师
  8: { depth: 16, movetime: 3000 },  // 棋协大师 (3秒)
  9: { depth: 18, movetime: 5000 },  // 特级大师 (5秒)
  10:{ depth: 22, movetime: 7000 },  // 天元/棋神 (7秒)
};

const PIECE_VALUE = {
  K: 100000, A: 25, E: 25, R: 100, H: 45, C: 50, P: 15,
  k: 100000, a: 25, e: 25, r: 100, h: 45, c: 50, p: 10,
};

const POSITION_TABLE = {
  'P': [
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [10,10,15,20,20,20,15,10,10],
    [20,20,25,30,30,30,25,20,20],
    [30,30,35,40,40,40,35,30,30],
    [40,40,45,50,50,50,45,40,40],
    [50,50,55,60,60,60,55,50,50],
    [60,60,65,70,70,70,65,60,60],
    [70,70,75,80,80,80,75,70,70],
  ],
  'R': [
    [10,10,10,15,15,15,10,10,10],
    [10,15,15,20,20,20,15,15,10],
    [10,15,15,20,20,20,15,15,10],
    [15,20,20,25,25,25,20,20,15],
    [15,20,20,25,25,25,20,20,15],
    [15,20,20,25,25,25,20,20,15],
    [10,15,15,20,20,20,15,15,10],
    [10,15,15,20,20,20,15,15,10],
    [10,10,10,15,15,15,10,10,10],
    [5,5,5,10,10,10,5,5,5],
  ],
  'H': [
    [5,10,10,15,15,15,10,10,5],
    [10,15,20,25,25,25,20,15,10],
    [10,20,30,35,35,35,30,20,10],
    [15,25,35,40,40,40,35,25,15],
    [15,25,35,40,40,40,35,25,15],
    [15,25,35,40,40,40,35,25,15],
    [10,20,30,35,35,35,30,20,10],
    [10,15,20,25,25,25,20,15,10],
    [5,10,10,15,15,15,10,10,5],
    [5,5,5,10,10,10,5,5,5],
  ],
  'C': [
    [5,5,5,10,10,10,5,5,5],
    [5,10,10,15,15,15,10,10,5],
    [10,15,15,20,20,20,15,15,10],
    [10,20,20,25,25,25,20,20,10],
    [10,20,20,25,25,25,20,20,10],
    [10,20,20,25,25,25,20,20,10],
    [10,15,15,20,20,20,15,15,10],
    [10,15,15,20,20,20,15,15,10],
    [5,10,10,15,15,15,10,10,5],
    [5,5,5,10,10,10,5,5,5],
  ],
  'A': [
    [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,10,10,10,0,0,0],[0,0,0,10,15,10,0,0,0],[0,0,0,10,15,10,0,0,0],
  ],
  'E': [
    [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,5,10,10,10,5,0,0],[0,0,5,10,15,10,5,0,0],[0,0,5,10,10,10,5,0,0],
  ],
  'K': [
    [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0,0,5,5,5,0,0,0],[0,0,0,5,10,5,0,0,0],[0,0,0,5,10,5,0,0,0],
  ],
};

function getPosScore(piece, r, c) {
  const isRedPiece = Rules.isRed(piece);
  const upper = piece.toUpperCase();
  const table = POSITION_TABLE[upper];
  if (!table) return 0;
  const row = isRedPiece ? r : (9 - r);
  return table[row] ? (table[row][c] || 0) : 0;
}

class SimpleAI {
  constructor(side, level = 1) {
    this.side = side;
    this.level = level;
    this.thinking = false;
    this._timer = null;
    this._usingPikafish = level >= 4;
  }

  setLevel(level) {
    this.level = level;
    this._usingPikafish = level >= 4;
  }

  getTitle() {
    return AI_TITLES[this.level] || '未知段位';
  }

  getThinkTime() {
    if (this._usingPikafish) {
      const cfg = PIKA_CONFIG[this.level];
      return cfg.movetime || 3000;
    }
    const cfg = JS_CONFIG[this.level] || JS_CONFIG[1];
    const base = 300 + cfg.depth * 350;
    const jitter = Math.random() * base * 0.5;
    return Math.min(base + jitter, 4000);
  }

  cancelThink() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.thinking = false;
  }

  async think(game) {
    this.cancelThink();
    if (this._usingPikafish) {
      return this._thinkPikafish(game);
    }
    return this._thinkJS(game);
  }

  // -------------------- Pikafish WASM 模式 --------------------
  async _thinkPikafish(game) {
    return new Promise((resolve, reject) => {
      this.thinking = true;
      const fen = game.getFEN();
      const cfg = PIKA_CONFIG[this.level];

      // 动态加时：如果当前局面已经重复出现过，增加思考时间以避免被迫和棋
      let movetime = cfg.movetime;
      try {
        const posKey = game._getPositionKey(game.state);
        const repeatCount = (game.positionHistory && game.positionHistory[posKey]) || 0;
        if (repeatCount >= 2) {
          movetime = Math.max(movetime, 5000) * 2;
          console.log(`[AI] Detected repeating position (count=${repeatCount}), extending think time to ${movetime}ms`);
        }
      } catch (e) {}

      this._timer = setTimeout(() => {
        this._timer = null;
      }, movetime + 3000); // 备用超时

      // 预加载 Pikafish bridge
      const bridge = (typeof pikafishBridge !== 'undefined') ? pikafishBridge : null;
      if (!bridge) {
        this.thinking = false;
        reject(new Error('Pikafish bridge not available'));
        return;
      }

      bridge.go(fen, movetime).then((move) => {
        this.thinking = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        resolve(move);
      }).catch((err) => {
        this.thinking = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        // 若 Pikafish 失败，回退到最强 JS AI（depth 2）
        console.warn('Pikafish failed, fallback to JS AI:', err);
        const fallbackMoves = game.getAllLegalMoves(this.side);
        const originalLevel = this.level;
        this.level = 3; // 使用 JS 最强配置
        const fallback = this._selectMove(game, fallbackMoves);
        this.level = originalLevel;
        resolve(fallback);
      });
    });
  }

  // -------------------- JS 引擎模式（1-6级） --------------------
  async _thinkJS(game) {
    return new Promise((resolve) => {
      this.thinking = true;
      const snapshot = game.getSnapshot();
      const moves = snapshot.legalMoves || [];
      const thinkTime = this.getThinkTime();

      this._timer = setTimeout(() => {
        this._timer = null;
        this.thinking = false;
        if (moves.length === 0 || snapshot.result) {
          resolve(null);
          return;
        }
        const move = this._selectMove(game, moves);
        resolve(move);
      }, thinkTime);
    });
  }

  _selectMove(game, moves) {
    const cfg = JS_CONFIG[this.level] || JS_CONFIG[1];
    const board = game.state.board;
    const side = game.state.activeColor;

    if (cfg.depth <= 1) {
      // 1-2级：做完整安全检测，避免主动送子
      const scored = moves.map(m => ({ move: m, score: this._evaluateMove(board, m, side, true) }));
      scored.sort((a, b) => b.score - a.score);

      if (Math.random() < cfg.mistakeRate) {
        const safeMoves = scored.filter(s => s.score > -500);
        if (safeMoves.length > 0) {
          const idx = Math.floor(Math.random() * Math.min(cfg.randomTopN, safeMoves.length));
          return safeMoves[idx].move;
        }
      }
      const topN = Math.min(cfg.randomTopN, scored.length);
      return scored[Math.floor(Math.random() * topN)].move;
    }

    // 深度 >= 2：Minimax + Alpha-Beta
    let bestMove = moves[0];
    let bestScore = -Infinity;

    // 根节点用完整安全检测排序，内部节点用快速评估
    const orderedMoves = moves.map(m => {
      return { move: m, quick: this._evaluateMove(board, m, side, true) };
    }).sort((a, b) => b.quick - a.quick);

    for (const item of orderedMoves) {
      const sim = Rules.cloneBoard(board);
      sim[item.move.toR][item.move.toC] = sim[item.move.fromR][item.move.fromC];
      sim[item.move.fromR][item.move.fromC] = '';
      const score = -this._minimax(sim, cfg.depth - 1, -Infinity, Infinity, side === 'w' ? 'b' : 'w');
      if (score > bestScore) {
        bestScore = score;
        bestMove = item.move;
      }
    }

    if (Math.random() < cfg.mistakeRate) {
      const safeMoves = orderedMoves.filter(o => o.quick > -500);
      if (safeMoves.length > 0) {
        return safeMoves[Math.floor(Math.random() * safeMoves.length)].move;
      }
    }

    return bestMove;
  }

  _minimax(board, depth, alpha, beta, side) {
    const inCheck = Rules.isCheck(board, side);
    const moves = Rules.getAllLegalMoves({ board, activeColor: side }, side);

    if (moves.length === 0) {
      if (inCheck) return -100000 - depth;
      return -50000 - depth;
    }

    if (depth === 0) {
      return this._quiescence(board, side, alpha, beta, 0);
    }

    const ordered = moves.map(m => {
      const sim = Rules.cloneBoard(board);
      sim[m.toR][m.toC] = sim[m.fromR][m.fromC];
      sim[m.fromR][m.fromC] = '';
      const quick = this._evaluateMove(sim, m, side, false);
      return { move: m, sim, quick };
    }).sort((a, b) => b.quick - a.quick);

    // 根据级别限制每节点分支数，保证深度2的响应速度
    const maxBranch = this.level >= 6 ? 14 : (this.level >= 4 ? 20 : 999);
    const limited = ordered.slice(0, maxBranch);

    let best = -Infinity;
    for (const item of limited) {
      const score = -this._minimax(item.sim, depth - 1, -beta, -alpha, side === 'w' ? 'b' : 'w');
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  _quiescence(board, side, alpha, beta, qDepth) {
    const standPat = this._evaluateBoard(board, side);
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;
    // 静态搜索对JS AI性能压力极大，仅在高等级且qDepth=0时做一层极浅的吃子搜索
    if (qDepth >= (this.level >= 5 ? 1 : 0)) return standPat;

    const moves = Rules.getAllLegalMoves({ board, activeColor: side }, side);
    const tacticalMoves = moves.filter(m => {
      const target = board[m.toR][m.toC];
      if (target) return true;
      const sim = Rules.cloneBoard(board);
      sim[m.toR][m.toC] = sim[m.fromR][m.fromC];
      sim[m.fromR][m.fromC] = '';
      const enemy = side === 'w' ? 'b' : 'w';
      if (Rules.isCheck(sim, enemy)) return true;
      return false;
    });

    tacticalMoves.sort((a, b) => {
      const va = PIECE_VALUE[board[a.toR][a.toC]] || 0;
      const vb = PIECE_VALUE[board[b.toR][b.toC]] || 0;
      return vb - va;
    });

    const limited = tacticalMoves.slice(0, 8);
    for (const m of limited) {
      const sim = Rules.cloneBoard(board);
      sim[m.toR][m.toC] = sim[m.fromR][m.fromC];
      sim[m.fromR][m.fromC] = '';
      const score = -this._quiescence(sim, side === 'w' ? 'b' : 'w', -beta, -alpha, qDepth + 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  _evaluateMove(board, move, side, checkSafety = false) {
    const target = board[move.toR][move.toC];
    let score = 0;
    if (target) score += PIECE_VALUE[target] * 2;

    const sim = Rules.cloneBoard(board);
    sim[move.toR][move.toC] = sim[move.fromR][move.fromC];
    sim[move.fromR][move.fromC] = '';

    const piece = sim[move.toR][move.toC];
    const enemy = side === 'w' ? 'b' : 'w';
    const enemyKing = Rules.findKing(sim, enemy);

    if (Rules.isCheck(sim, enemy)) score += 80;
    if (Rules.isCheck(sim, side)) score -= 200;

    // 1级也不要主动送子：检测走到目标位置后是否会被对方白吃
    const myVal = PIECE_VALUE[piece] || 0;
    if (checkSafety) {
      let canBeCapturedFreely = false;
      // 获取敌方所有合法走法，检查是否有目标点为 (toR, toC) 的吃子着法
      const enemyMoves = Rules.getAllLegalMoves({ board: sim, activeColor: enemy }, enemy);
      for (const em of enemyMoves) {
        if (em.toR === move.toR && em.toC === move.toC) {
          const attacker = sim[em.fromR][em.fromC];
          const enemyVal = PIECE_VALUE[attacker] || 0;
          if (enemyVal <= myVal * 1.3) {
            canBeCapturedFreely = true;
            break;
          }
        }
      }
      if (canBeCapturedFreely) {
        score -= myVal * 2.5; // 严厉惩罚送子
      }
    }

    // 高级位置奖励
    if (this.level >= 4 && enemyKing) {
      const er = enemyKing.r, ec = enemyKing.c;
      const pr = move.toR, pc = move.toC;
      if (piece.toLowerCase() === 'h') {
        if ((Math.abs(pr - er) === 2 && Math.abs(pc - ec) === 1) ||
            (Math.abs(pr - er) === 1 && Math.abs(pc - ec) === 2)) {
          score += 25;
        }
      }
      if (['r', 'c'].includes(piece.toLowerCase())) {
        const myBaseline = side === 'w' ? 9 : 0;
        if (pr === myBaseline) score += 12;
        if (pc === ec) score += 18;
      }
      if (piece.toLowerCase() === 'p') {
        const distToKing = Math.abs(pr - er) + Math.abs(pc - ec);
        if (distToKing <= 2) score += 25;
      }
    }

    return score;
  }

  _evaluateBoard(board, side) {
    let score = 0;
    let redMaterial = 0, blackMaterial = 0;
    let redPos = 0, blackPos = 0;
    let redAttack = 0, blackAttack = 0;
    let redKingSafety = 0, blackKingSafety = 0;

    const redKing = Rules.findKing(board, 'w');
    const blackKing = Rules.findKing(board, 'b');

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) continue;
        const val = PIECE_VALUE[p] || 0;
        const pos = getPosScore(p, r, c);
        if (Rules.isRed(p)) {
          redMaterial += val;
          redPos += pos;
          if (blackKing) {
            const dist = Math.abs(r - blackKing.r) + Math.abs(c - blackKing.c);
            if (dist < 4) redAttack += (4 - dist) * (val / 40);
          }
          if (['R', 'H', 'C'].includes(p) && r >= 5) redAttack += 6;
        } else {
          blackMaterial += val;
          blackPos += pos;
          if (redKing) {
            const dist = Math.abs(r - redKing.r) + Math.abs(c - redKing.c);
            if (dist < 4) blackAttack += (4 - dist) * (val / 40);
          }
          if (['r', 'h', 'c'].includes(p) && r <= 4) blackAttack += 6;
        }
      }
    }

    if (redKing) {
      const advisors = this._countPieces(board, 'A');
      const elephants = this._countPieces(board, 'E');
      redKingSafety += advisors * 12 + elephants * 8;
      if (advisors === 0 && elephants === 0) redKingSafety -= 50;
    }
    if (blackKing) {
      const advisors = this._countPieces(board, 'a');
      const elephants = this._countPieces(board, 'e');
      blackKingSafety += advisors * 12 + elephants * 8;
      if (advisors === 0 && elephants === 0) blackKingSafety -= 50;
    }

    score += (redMaterial - blackMaterial);
    score += (redPos - blackPos) * 0.7;
    score += (redAttack - blackAttack) * 1.5;
    score += (redKingSafety - blackKingSafety) * 0.4;

    if (Rules.isCheck(board, 'b')) score += 50;
    if (Rules.isCheck(board, 'w')) score -= 50;

    // mobility 评估调用 getAllLegalMoves 性能开销极大，已在 _evaluateMove 的战术评分中部分补偿，此处省略
    // try {
    //   const redMoves = Rules.getAllLegalMoves({ board, activeColor: 'w' }, 'w').length;
    //   const blackMoves = Rules.getAllLegalMoves({ board, activeColor: 'b' }, 'b').length;
    //   score += (redMoves - blackMoves) * 1.2;
    // } catch (e) {}

    return side === 'w' ? score : -score;
  }

  _countPieces(board, pieceChar) {
    let count = 0;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === pieceChar) count++;
      }
    }
    return count;
  }
}

if (typeof window !== 'undefined') {
  window.SimpleAI = SimpleAI;
  window.AI_TITLES = AI_TITLES;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimpleAI, AI_TITLES };
}
