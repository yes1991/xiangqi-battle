/**
 * 房间系统 — 挂载到 BoardRenderer.prototype
 * 支持：创建房间（AI观战 / PvP对战）、链接分享、轮询同步、战绩统计
 */

// ---- URL 检测与自动加入 ----
BoardRenderer.prototype._initRoomFromURL = function () {
  this.loadBattleStats();
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  if (roomCode) {
    this.joinRoom(roomCode.toUpperCase());
  }
};

// ---- 按钮事件绑定 ----
BoardRenderer.prototype._setupRoomButtons = function () {
  const btnCreateRoom = document.getElementById('btnCreateRoom');
  if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
      const gameType = document.getElementById('roomGameType')?.value || 'ai';
      const aiLevel = parseInt(document.getElementById('aiLevelSelect')?.value || '1', 10);
      this.createRoom(gameType, aiLevel);
    });
  }

  const btnCopyLink = document.getElementById('btnCopyLink');
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', () => this._copyShareLink());
  }

  const btnLeaveRoom = document.getElementById('btnLeaveRoom');
  if (btnLeaveRoom) {
    btnLeaveRoom.addEventListener('click', () => this._leaveRoom());
  }

  // 模式切换：人人对战 ↔ AI对战 动态变更下方等级选择器
  const roomGameType = document.getElementById('roomGameType');
  const aiLevelSelect = document.getElementById('aiLevelSelect');
  if (roomGameType && aiLevelSelect) {
    roomGameType.addEventListener('change', () => {
      if (roomGameType.value === 'pvp') {
        // 替换为"人类棋局"标签
        aiLevelSelect.style.display = 'none';
        let label = document.getElementById('pvpLabel');
        if (!label) {
          label = document.createElement('span');
          label.id = 'pvpLabel';
          label.className = 'pvp-label';
          label.textContent = '👥 人类棋局';
          aiLevelSelect.parentNode.insertBefore(label, aiLevelSelect.nextSibling);
        }
        label.style.display = '';
      } else {
        // 恢复AI等级选择
        aiLevelSelect.style.display = '';
        const label = document.getElementById('pvpLabel');
        if (label) label.style.display = 'none';
      }
    });
  }
};

// ---- 创建房间 ----
BoardRenderer.prototype.createRoom = async function (gameType, aiLevel) {
  try {
    const res = await api.createRoom(gameType, aiLevel);
    this.roomCode = res.room_code;
    this.roomGameType = gameType;
    this.roomPlayerSide = 'w';
    this.isSpectator = false;
    this.lastSeenMoveNumber = 0;
    this._roomServerStatus = (gameType === 'pvp') ? 'waiting' : 'playing';
    // 重启棋盘，确保干净初始状态
    this.restart();
    this._startRoomPolling();
    this._updateRoomUI();
    this.updatePanel();
  } catch (e) {
    console.error('创建房间失败:', e);
    alert('创建房间失败: ' + (e.message || '网络错误'));
  }
};

// ---- 加入房间 ----
BoardRenderer.prototype.joinRoom = async function (code) {
  try {
    const res = await api.joinRoom(code);
    this.roomCode = res.room_code;
    this.roomGameType = res.game_type || 'ai';  // ← 从服务器获取房间类型
    this.roomPlayerSide = res.player_side;
    this.isSpectator = res.is_spectator || false;
    this.lastSeenMoveNumber = 0;
    this._roomServerStatus = 'playing';  // 加入后即开打

    // 重启棋盘到初始状态
    this.restart();

    if (this.isSpectator) {
      // 观战模式：获取当前FEN并同步
      const state = await api.get('/api/room/' + this.roomCode + '/state');
      if (state.current_fen && state.move_count > 0) {
        this._applyFEN(state.current_fen);
      }
    }

    this._startRoomPolling();
    this._updateRoomUI();
    this.updatePanel();
  } catch (e) {
    console.error('加入房间失败:', e);
    alert('加入房间失败: ' + (e.message || '房间不存在或已结束'));
  }
};

// ---- 上报走法到服务器 ----
BoardRenderer.prototype._syncMoveToRoom = function (fromR, fromC, toR, toC) {
  if (!this.roomCode) return;
  const fen = this.game.getFEN();
  api.roomMove(this.roomCode, fromR, fromC, toR, toC, fen).then(res => {
    if (res.move_number) {
      this.lastSeenMoveNumber = res.move_number;
    }
  }).catch(err => {
    console.error('上报走法失败:', err);
  });
};

// ---- 应用远程FEN（观战初始化） ----
BoardRenderer.prototype._applyFEN = function (fen) {
  try {
    const fenData = (typeof Rules !== 'undefined' ? Rules : window.Rules).parseFEN(fen);
    this.game.state.board = fenData.board;
    this.game.state.activeColor = fenData.activeColor;
    this.game.state.halfmove = fenData.halfmove;
    this.game.state.fullmove = fenData.fullmove;
    this.game.history = [];
    this.game.moveList = [];
    this.game.result = null;
    this.game.inCheck = false;
    this.render();
    this.updatePanel();
  } catch (e) {
    console.error('应用FEN失败:', e);
  }
};

// ---- 应用远程走法 ----
BoardRenderer.prototype._applyRemoteMove = function (fromR, fromC, toR, toC) {
  const success = this.game.makeMove(fromR, fromC, toR, toC);
  if (success) {
    this.playMoveSound();
    this.lastMove = { fromR, fromC, toR, toC };
    this.stepTimer[this.game.state.activeColor] = this._stepTime();
    this.render();
    this.updatePanel();
    if (!this.timerInterval && !this.game.result) this._startTimer();
    if (this.game.result) {
      this._handleGameEnd();
    }
  }
};

// ---- 轮询对手走法 ----
BoardRenderer.prototype._startRoomPolling = function () {
  this._stopRoomPolling();
  this.roomPollTimer = setInterval(async () => {
    if (!this.roomCode) return;
    try {
      const res = await api.roomPoll(this.roomCode, this.lastSeenMoveNumber);
      const newMoves = res.moves || [];
      this._roomServerStatus = res.status;  // 保存服务器状态

      for (const m of newMoves) {
        if (this.isSpectator) {
          // 观战：应用所有走法
          this._applyRemoteMove(m.fromR, m.fromC, m.toR, m.toC);
        } else if (m.side !== this.roomPlayerSide) {
          // 对战：只应用对手走法
          this._applyRemoteMove(m.fromR, m.fromC, m.toR, m.toC);
        }
        this.lastSeenMoveNumber = Math.max(this.lastSeenMoveNumber, m.moveNumber);
      }

      // 如果当前轮到我了且是PvP模式，清除AI等待状态
      if (!this.isSpectator && this.game.state.activeColor === this.roomPlayerSide && !this.game.result) {
        // PvP中轮到我走，无需特殊处理（棋盘已可点击）
      }

      // 检查游戏是否结束
      if (res.status === 'finished' && !this.game.result && res.result) {
        this.game.result = res.result;
        this._handleGameEnd();
      }

      this._updateRoomUI();
    } catch (e) {
      // 静默忽略轮询错误
    }
  }, 1500);
};

BoardRenderer.prototype._stopRoomPolling = function () {
  if (this.roomPollTimer) {
    clearInterval(this.roomPollTimer);
    this.roomPollTimer = null;
  }
};

// ---- 房间UI更新 ----
BoardRenderer.prototype._updateRoomUI = function () {
  const roomInfo = document.getElementById('roomInfo');
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const roomStatusText = document.getElementById('roomStatusText');
  const spectatorBadge = document.getElementById('spectatorBadge');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const btnCreateRoom = document.getElementById('btnCreateRoom');
  const roomGameType = document.getElementById('roomGameType');

  if (!this.roomCode) {
    // 无房间
    if (roomInfo) roomInfo.style.display = 'none';
    if (spectatorBadge) spectatorBadge.style.display = 'none';
    if (btnCreateRoom) btnCreateRoom.style.display = 'inline-block';
    if (roomGameType) roomGameType.style.display = 'inline-block';
    return;
  }

  // 有房间
  if (roomInfo) roomInfo.style.display = 'flex';
  if (btnCreateRoom) btnCreateRoom.style.display = 'none';
  if (roomGameType) roomGameType.style.display = 'none';

  if (roomCodeDisplay) {
    roomCodeDisplay.textContent = this.roomCode;
  }

  if (spectatorBadge) {
    spectatorBadge.style.display = this.isSpectator ? 'inline-block' : 'none';
  }

  if (roomStatusText) {
    if (this.game.result) {
      roomStatusText.textContent = '对局已结束';
    } else if (this.isSpectator) {
      roomStatusText.textContent = '观战中';
    } else if (this._roomServerStatus === 'waiting') {
      roomStatusText.textContent = '等待对手加入...';
    } else if (this.roomGameType === 'pvp' && this.game.state.activeColor !== this.roomPlayerSide) {
      roomStatusText.textContent = '等待对手走棋...';
    } else {
      roomStatusText.textContent = '轮到你走棋';
    }
  }

  // 更新分享链接
  if (btnCopyLink && this.roomCode) {
    const shareUrl = window.location.origin + window.location.pathname + '?room=' + this.roomCode;
    btnCopyLink.setAttribute('data-url', shareUrl);
  }
};

// ---- 复制分享链接 ----
BoardRenderer.prototype._copyShareLink = function () {
  const url = window.location.origin + window.location.pathname + '?room=' + this.roomCode;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      this._showCopyToast('链接已复制！发给朋友吧');
    }).catch(() => {
      prompt('复制此链接分享给朋友:', url);
    });
  } else {
    prompt('复制此链接分享给朋友:', url);
  }
};

BoardRenderer.prototype._showCopyToast = function (msg) {
  const toast = document.getElementById('voiceToast');
  const icon = document.getElementById('voiceToastIcon');
  const text = document.getElementById('voiceToastText');
  if (toast && text) {
    icon.textContent = '🔗';
    text.textContent = msg;
    toast.classList.remove('ai-win');
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2500);
  }
};

// ---- 离开房间 ----
BoardRenderer.prototype._leaveRoom = function () {
  this._stopRoomPolling();
  this.roomCode = null;
  this.isSpectator = false;
  this.roomGameType = 'ai';
  this._roomServerStatus = '';
  // 恢复AI等级选择器
  const aiLevelSelect = document.getElementById('aiLevelSelect');
  if (aiLevelSelect) aiLevelSelect.style.display = '';
  const pvpLabel = document.getElementById('pvpLabel');
  if (pvpLabel) pvpLabel.style.display = 'none';
  this._updateRoomUI();
  this.restart();
};

// ---- 加载战绩统计 ----
BoardRenderer.prototype.loadBattleStats = async function () {
  try {
    const stats = await api.getBattleStats();
    const el = document.getElementById('battleStatsContent');
    if (el) {
      el.innerHTML =
        `<span>今日: ${stats.daily_wins}胜 ${stats.daily_losses}负 ${stats.daily_draws}和</span>` +
        `<span style="margin-left:12px">总计: ${stats.total_wins}胜 ${stats.total_losses}负 ${stats.total_draws}和</span>`;
    }
  } catch (e) {
    // 静默
  }
};
