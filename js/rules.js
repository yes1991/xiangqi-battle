/**
 * 中国象棋规则引擎 (Xiangqi Rules Engine)
 * 纯函数实现，负责 FEN 解析/生成、走法合法性校验、将军/将死/困毙判定
 */

const INITIAL_FEN = "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1";

function inBounds(r, c) {
  return r >= 0 && r < 10 && c >= 0 && c < 9;
}

function isRed(p) {
  return p && p === p.toUpperCase();
}

function isBlack(p) {
  return p && p === p.toLowerCase();
}

function isSameSide(p1, p2) {
  if (!p1 || !p2) return false;
  return (isRed(p1) && isRed(p2)) || (isBlack(p1) && isBlack(p2));
}

function parseFEN(fen) {
  const parts = fen.trim().split(/\s+/);
  const rankStrs = parts[0].split('/');
  // rankStrs[0] 是第9行，rankStrs[9] 是第0行
  const board = Array(10)
    .fill(null)
    .map(() => Array(9).fill(''));
  for (let i = 0; i < 10; i++) {
    const row = 9 - i;
    const str = rankStrs[i];
    let col = 0;
    for (const ch of str) {
      if (/\d/.test(ch)) {
        col += parseInt(ch, 10);
      } else {
        board[row][col] = ch;
        col++;
      }
    }
  }
  return {
    board,
    activeColor: parts[1] || 'w',
    halfmove: parseInt(parts[4] || '0', 10),
    fullmove: parseInt(parts[5] || '1', 10),
  };
}

function generateFEN(state) {
  const { board, activeColor, halfmove, fullmove } = state;
  const rankStrs = [];
  for (let r = 9; r >= 0; r--) {
    let empty = 0;
    let s = '';
    for (let c = 0; c < 9; c++) {
      if (board[r][c]) {
        if (empty > 0) {
          s += empty;
          empty = 0;
        }
        s += board[r][c];
      } else {
        empty++;
      }
    }
    if (empty > 0) s += empty;
    rankStrs.push(s);
  }
  return `${rankStrs.join('/')} ${activeColor} - - ${halfmove} ${fullmove}`;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function countBetween(board, r1, c1, r2, c2) {
  // 假设两点在同一直线上，且不包含端点
  let count = 0;
  if (r1 === r2) {
    const step = c1 < c2 ? 1 : -1;
    for (let c = c1 + step; c !== c2; c += step) {
      if (board[r1][c]) count++;
    }
  } else if (c1 === c2) {
    const step = r1 < r2 ? 1 : -1;
    for (let r = r1 + step; r !== r2; r += step) {
      if (board[r][c1]) count++;
    }
  }
  return count;
}

function findKing(board, color) {
  const king = color === 'w' ? 'K' : 'k';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === king) return { r, c };
    }
  }
  return null;
}

function isFaceToFace(board) {
  const redK = findKing(board, 'w');
  const blackK = findKing(board, 'b');
  if (!redK || !blackK) return false;
  if (redK.c !== blackK.c) return false;
  return countBetween(board, redK.r, redK.c, blackK.r, blackK.c) === 0;
}

function canAttack(board, fromR, fromC, toR, toC) {
  // 检测 from 位置的棋子是否能在几何路径上攻击到 to 位置（不考虑将军后的非法）
  if (!inBounds(toR, toC)) return false;
  const p = board[fromR][fromC];
  const target = board[toR][toC];
  if (!p) return false;
  if (target && isSameSide(p, target)) return false;

  const dr = toR - fromR;
  const dc = toC - fromC;
  const ad = Math.abs(dr);
  const ac = Math.abs(dc);

  switch (p.toLowerCase()) {
    case 'k': {
      // 帅/将：九宫一格横竖
      if (ad + ac !== 1) return false;
      const palaceR = isRed(p) ? [0, 1, 2] : [7, 8, 9];
      return palaceR.includes(toR) && toC >= 3 && toC <= 5;
    }
    case 'a': {
      // 仕/士：九宫斜线一格
      if (ad !== 1 || ac !== 1) return false;
      const palaceR = isRed(p) ? [0, 1, 2] : [7, 8, 9];
      return palaceR.includes(toR) && toC >= 3 && toC <= 5;
    }
    case 'e': {
      // 相/象：田字格，不越河，不塞象眼
      // row 0=红底线(下)，row 9=黑底线(上)
      // 红相只能在红方半场(下)：toR <= 4；黑象只能在黑方半场(上)：toR >= 5
      if (ad !== 2 || ac !== 2) return false;
      if (isRed(p) && toR > 4) return false;
      if (isBlack(p) && toR < 5) return false;
      const eyeR = fromR + dr / 2;
      const eyeC = fromC + dc / 2;
      return !board[eyeR][eyeC];
    }
    case 'h': {
      // 马：日字格，不蹩马腿
      if (ad + ac !== 3 || ad === 0 || ac === 0) return false;
      if (ad === 2) {
        return !board[fromR + dr / 2][fromC];
      } else {
        return !board[fromR][fromC + dc / 2];
      }
    }
    case 'r': {
      // 车：横竖直线，无阻挡
      if (fromR !== toR && fromC !== toC) return false;
      return countBetween(board, fromR, fromC, toR, toC) === 0;
    }
    case 'c': {
      // 炮：同一直线。移动时0障碍；吃子时1障碍
      if (fromR !== toR && fromC !== toC) return false;
      const between = countBetween(board, fromR, fromC, toR, toC);
      if (!target) {
        return between === 0;
      } else {
        return between === 1;
      }
    }
    case 'p': {
      // 兵/卒
      // 坐标系：row 0=红底线(下)，row 9=黑底线(上)
      // 红方向前走 = row 增加 (向上)；黑方向前走 = row 减小 (向下)
      if (isRed(p)) {
        if (dr === 1 && ac === 0) return true; // 红兵向前
        if (fromR >= 5 && dr === 0 && ac === 1) return true; // 过河后可左右
        return false;
      } else {
        if (dr === -1 && ac === 0) return true; // 黑卒向前
        if (fromR <= 4 && dr === 0 && ac === 1) return true; // 过河后可左右
        return false;
      }
    }
  }
  return false;
}

function isCheck(board, color) {
  // 检测 color 方的将帅是否被将军
  const kingPos = findKing(board, color);
  if (!kingPos) return false;
  const attacker = color === 'w' ? 'b' : 'w';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && (attacker === 'w' ? isRed(p) : isBlack(p))) {
        if (canAttack(board, r, c, kingPos.r, kingPos.c)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isLegalMove(state, fromR, fromC, toR, toC) {
  const { board, activeColor } = state;
  const p = board[fromR][fromC];
  if (!p) return false;
  if (activeColor === 'w' && !isRed(p)) return false;
  if (activeColor === 'b' && !isBlack(p)) return false;
  if (!canAttack(board, fromR, fromC, toR, toC)) return false;

  // 就地模拟走子，检查是否主动送将 / 将帅照面，然后恢复（避免 clone，提升 AI 性能）
  const savedTarget = board[toR][toC];
  const savedSource = board[fromR][fromC];
  board[toR][toC] = p;
  board[fromR][fromC] = '';

  let legal = true;
  if (isFaceToFace(board)) legal = false;
  else if (isCheck(board, activeColor)) legal = false;

  board[toR][toC] = savedTarget;
  board[fromR][fromC] = savedSource;
  return legal;
}

function getLegalMoves(state, fromR, fromC) {
  const moves = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (isLegalMove(state, fromR, fromC, r, c)) {
        moves.push({ r, c });
      }
    }
  }
  return moves;
}

function getAllLegalMoves(state, side) {
  const moves = [];
  const { board } = state;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (side === 'w' && !isRed(p)) continue;
      if (side === 'b' && !isBlack(p)) continue;
      const pieceMoves = getLegalMoves(state, r, c);
      for (const m of pieceMoves) {
        moves.push({ fromR: r, fromC: c, toR: m.r, toC: m.c });
      }
    }
  }
  return moves;
}

function isCheckmate(state, side) {
  return isCheck(state.board, side) && getAllLegalMoves(state, side).length === 0;
}

function isStalemate(state, side) {
  return !isCheck(state.board, side) && getAllLegalMoves(state, side).length === 0;
}

// 导出（兼容浏览器和简单模块环境）
const Rules = {
  INITIAL_FEN,
  parseFEN,
  generateFEN,
  isLegalMove,
  getLegalMoves,
  getAllLegalMoves,
  isCheck,
  isCheckmate,
  isStalemate,
  isFaceToFace,
  findKing,
  cloneBoard,
  isRed,
  isBlack,
  isSameSide,
  inBounds,
};

if (typeof window !== 'undefined') {
  window.Rules = Rules;
  window.isRed = isRed;
  window.isBlack = isBlack;
  window.isSameSide = isSameSide;
  window.inBounds = inBounds;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Rules;
}
