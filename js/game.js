/**
 * 中国象棋游戏状态机 (Xiangqi Game State)
 * 封装规则引擎，管理对局流程、历史栈、胜负判定
 */

class XiangqiGame {
  constructor() {
    this.reset();
  }

  reset() {
    const fenData = Rules.parseFEN(Rules.INITIAL_FEN);
    this.state = {
      board: fenData.board,
      activeColor: fenData.activeColor,
      halfmove: fenData.halfmove,
      fullmove: fenData.fullmove,
    };
    this.history = []; // { fromR, fromC, toR, toC, captured, prevState, moveText, positionKey, wasCheck }
    this.moveList = [];
    this.result = null; // 'w' = 红胜, 'b' = 黑胜, 'draw' = 和棋
    this.inCheck = false;
    this.drawReason = ''; // 和棋原因描述
    this.positionHistory = {}; // 记录局面出现次数（不含 halfmove/fullmove）
    this.checkHistory = [];    // 记录每步是否形成将军
    // 初始局面计数
    const startKey = this._getPositionKey(this.state);
    this.positionHistory[startKey] = 1;
  }

  _getPositionKey(state) {
    // 重复局面判定使用简化 FEN：不含 halfmove 和 fullmove
    const { board, activeColor } = state;
    const rankStrs = [];
    for (let r = 9; r >= 0; r--) {
      let empty = 0;
      let s = '';
      for (let c = 0; c < 9; c++) {
        if (board[r][c]) {
          if (empty > 0) { s += empty; empty = 0; }
          s += board[r][c];
        } else {
          empty++;
        }
      }
      if (empty > 0) s += empty;
      rankStrs.push(s);
    }
    return `${rankStrs.join('/')} ${activeColor} - -`;
  }

  getFEN() {
    return Rules.generateFEN(this.state);
  }

  getLegalMoves(fromR, fromC) {
    if (this.result) return [];
    return Rules.getLegalMoves(this.state, fromR, fromC);
  }

  getAllLegalMoves(side) {
    return Rules.getAllLegalMoves(this.state, side || this.state.activeColor);
  }

  makeMove(fromR, fromC, toR, toC) {
    if (this.result) return false;
    if (!Rules.isLegalMove(this.state, fromR, fromC, toR, toC)) return false;

    const board = this.state.board;
    const piece = board[fromR][fromC];
    const captured = board[toR][toC];

    const newBoard = Rules.cloneBoard(board);
    newBoard[toR][toC] = piece;
    newBoard[fromR][fromC] = '';

    let halfmove = this.state.halfmove + 1;
    let fullmove = this.state.fullmove;
    if (captured || piece.toLowerCase() === 'p') {
      halfmove = 0;
    }
    if (this.state.activeColor === 'b') {
      fullmove++;
    }

    const prevState = {
      board: Rules.cloneBoard(board),
      activeColor: this.state.activeColor,
      halfmove: this.state.halfmove,
      fullmove: this.state.fullmove,
    };

    this.state = {
      board: newBoard,
      activeColor: this.state.activeColor === 'w' ? 'b' : 'w',
      halfmove,
      fullmove,
    };

    // 更新重复局面历史
    const positionKey = this._getPositionKey(this.state);
    this.positionHistory[positionKey] = (this.positionHistory[positionKey] || 0) + 1;

    // 记录这步是否将军
    const nextSide = this.state.activeColor;
    const wasCheck = Rules.isCheck(this.state.board, nextSide);
    this.checkHistory.push(wasCheck);

    this.history.push({
      fromR,
      fromC,
      toR,
      toC,
      captured,
      prevState,
      moveText: this._formatMove(fromR, fromC, toR, toC, piece, captured),
      positionKey,
      wasCheck,
    });

    this.moveList.push(this.history[this.history.length - 1].moveText);
    this._updateStatus();
    return true;
  }

  undo() {
    if (this.history.length === 0) return false;
    const last = this.history.pop();

    // 回退重复局面计数
    if (last.positionKey && this.positionHistory[last.positionKey]) {
      this.positionHistory[last.positionKey]--;
      if (this.positionHistory[last.positionKey] <= 0) {
        delete this.positionHistory[last.positionKey];
      }
    }
    this.checkHistory.pop();

    this.state = last.prevState;
    this.moveList.pop();
    this.result = null;
    this.drawReason = '';
    this._updateStatus();
    return true;
  }

  _updateStatus() {
    const side = this.state.activeColor;
    this.inCheck = Rules.isCheck(this.state.board, side);

    if (Rules.isCheckmate(this.state, side)) {
      this.result = side === 'w' ? 'b' : 'w';
      return;
    }

    if (Rules.isStalemate(this.state, side)) {
      this.result = side === 'w' ? 'b' : 'w';
      return;
    }

    // 重复局面：同一局面出现 3 次判和；若由单方长将导致则判负
    const currentKey = this._getPositionKey(this.state);
    if ((this.positionHistory[currentKey] || 0) >= 3) {
      // 简单长将判负逻辑：检查最后 3 次重复是否都是将军
      let repeatingChecks = 0;
      const h = this.checkHistory;
      if (h.length >= 3) {
        for (let i = h.length - 1; i >= 0; i--) {
          if (h[i]) repeatingChecks++;
          else break;
        }
      }
      if (repeatingChecks >= 3) {
        // 长将方：最后一步是谁走的？当前 activeColor 的对方
        const offendingSide = side === 'w' ? 'b' : 'w';
        this.result = offendingSide === 'w' ? 'b' : 'w';
        this.drawReason = '长将判负';
      } else {
        this.result = 'draw';
        this.drawReason = '重复局面和棋';
      }
      return;
    }

    // 自然限着：60回合（120步）无吃子/进兵
    if (this.state.halfmove >= 120) {
      this.result = 'draw';
      this.drawReason = '自然限着（60回合无吃子）';
      return;
    }

    // 绝对和棋：2000步（1000回合）
    if (this.state.fullmove > 1000) {
      this.result = 'draw';
      this.drawReason = '2000步自然和棋';
      return;
    }
  }

  _formatMove(fromR, fromC, toR, toC, piece, captured) {
    const names = {
      K: '帅', A: '仕', E: '相', R: '車', H: '馬', C: '炮', P: '兵',
      k: '将', a: '士', e: '象', r: '车', h: '马', c: '炮', p: '卒',
    };
    const redCols = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const blackCols = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];
    const name = names[piece] || piece;
    const isRedPiece = Rules.isRed(piece);

    // 红方用中文数字，黑方用阿拉伯数字
    const fromColName = isRedPiece ? redCols[fromC] : blackCols[fromC];
    const toColName = isRedPiece ? redCols[toC] : blackCols[toC];
    const rowDiff = toR - fromR;

    let action = '';
    let distOrCol = '';

    if (captured) {
      action = '吃';
      distOrCol = toColName;
    } else if (fromC === toC) {
      // 纵向移动
      action = rowDiff > 0 ? '进' : '退';
      const steps = Math.abs(rowDiff);
      distOrCol = isRedPiece ? redCols[steps - 1] || steps : String(steps);
    } else {
      // 横向移动
      action = '平';
      distOrCol = toColName;
    }

    // 特殊：同列有多个相同棋子时，需要区分前/后（简化版暂不做，因初始无重复列）
    return `${name}${fromColName}${action}${distOrCol}`;
  }

  getResultText() {
    if (!this.result) return '';
    if (this.result === 'w') return '红方胜！';
    if (this.result === 'b') return '黑方胜！';
    return `和棋 · ${this.drawReason}`;
  }

  getSnapshot() {
    return {
      fen: this.getFEN(),
      activeColor: this.state.activeColor,
      legalMoves: this.getAllLegalMoves(this.state.activeColor),
      inCheck: this.inCheck,
      result: this.result,
      drawReason: this.drawReason,
    };
  }

  resign(side) {
    if (this.result) return false;
    this.result = side === 'w' ? 'b' : 'w';
    return true;
  }
}

if (typeof window !== 'undefined') {
  window.XiangqiGame = XiangqiGame;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { XiangqiGame };
}
