/**
 * 棋盘渲染与交互控制器
 * 视觉布局：红方在下方，黑方在上方
 */

class BoardRenderer {
  constructor(containerId, game, ai) {
    this.container = document.getElementById(containerId);
    this.game = game;
    this.ai = ai;
    this.playerSide = 'w';
    this.cellSize = 50;
    this.margin = 25;
    this.vMargin = 25;
    this.selected = null;
    this.lastMove = null;
    this.isAiThinking = false;
    this.stepTimer = { w: 60, b: 60 };
    this.totalTimers = { w: 1200, b: 1200 };
    this.timerInterval = null;
    this.currentUser = null; // { username }
    this.progress = this._loadProgress();
    // 房间系统
    this.roomCode = null;
    this.roomGameType = 'ai';      // 'ai' or 'pvp'
    this.roomPlayerSide = 'w';
    this.isSpectator = false;
    this.lastSeenMoveNumber = 0;
    this.roomPollTimer = null;
    this._roomServerStatus = '';  // 服务器端房间状态
    this.init();
  }

  // 用户系统 ----------------------------------------------------
  _guestProgress() {
    try {
      const raw = localStorage.getItem('xiangqi-guest-progress-v1');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { currentLevel: 1, maxLevel: 1, wins: 0, losses: 0, draws: 0 };
  }

  _saveGuestProgress() {
    try {
      localStorage.setItem('xiangqi-guest-progress-v1', JSON.stringify(this.progress));
    } catch (e) {}
  }

  _loadProgress() {
    if (this.currentUser) {
      const u = this.currentUser;
      return {
        currentLevel: u.max_level || 1,
        maxLevel: u.max_level || 1,
        wins: u.wins || 0,
        losses: u.losses || 0,
        draws: u.draws || 0,
      };
    }
    return this._guestProgress();
  }

  _saveProgress() {
    if (!this.currentUser) {
      this._saveGuestProgress();
    }
  }

  async doLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';

    if (!username || !password) {
      errEl.textContent = '请输入用户名和密码';
      return;
    }

    try {
      const data = await api.post('/api/login', { username, password });
      api.setToken(data.access_token);
      this.currentUser = data.user;
      this.progress = this._loadProgress();
      this.ai.setLevel(this.progress.currentLevel);
      document.getElementById('authOverlay').classList.remove('visible');
      this._renderUserArea();
      this.updatePanel();
      this.restart();
    } catch (e) {
      errEl.textContent = e.message || '登录失败';
    }
  }

  async doRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    const errEl = document.getElementById('regError');
    errEl.textContent = '';

    if (!/^[a-zA-Z0-9_]{2,16}$/.test(username)) {
      errEl.textContent = '用户名需为2-16位字母数字或下划线';
      return;
    }
    if (password.length < 6 || password.length > 20) {
      errEl.textContent = '密码长度需为6-20位';
      return;
    }
    if (password !== password2) {
      errEl.textContent = '两次输入的密码不一致';
      return;
    }

    try {
      const data = await api.post('/api/register', { username, password });
      api.setToken(data.access_token);
      this.currentUser = data.user;
      this.progress = this._loadProgress();
      this.ai.setLevel(this.progress.currentLevel);
      document.getElementById('authOverlay').classList.remove('visible');
      this._renderUserArea();
      this.updatePanel();
      this.restart();
    } catch (e) {
      errEl.textContent = e.message || '注册失败';
    }
  }

  logout() {
    this.currentUser = null;
    api.setToken('');
    this.progress = this._loadProgress();
    this.ai.setLevel(this.progress.currentLevel);
    this._renderUserArea();
    this.updatePanel();
    this.restart();
  }

  _renderUserArea() {
    const area = document.getElementById('userArea');
    if (!area) return;
    if (this.currentUser) {
      area.innerHTML = `<div class="user-badge"><span>${this.currentUser.username}</span><button id="btnLogout">退出</button></div>`;
      const btnLogout = document.getElementById('btnLogout');
      if (btnLogout) btnLogout.addEventListener('click', () => this.logout());
    } else {
      area.innerHTML = `<button class="btn btn-sm" id="btnLogin">登录 / 注册</button>`;
      const btnLogin = document.getElementById('btnLogin');
      if (btnLogin) btnLogin.addEventListener('click', () => {
        document.getElementById('authOverlay').classList.add('visible');
      });
    }
  }

  async _tryAutoLogin() {
    api.loadToken();
    if (!api.token) {
      this._renderUserArea();
      return;
    }
    try {
      const user = await api.get('/api/me');
      this.currentUser = user;
      this.progress = this._loadProgress();
      this.ai.setLevel(this.progress.currentLevel);
    } catch (e) {
      api.setToken('');
    }
    this._renderUserArea();
  }

  // 棋盘系统 ----------------------------------------------------
  async init() {
    this.container.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'boardCanvas';
    this.piecesLayer = document.createElement('div');
    this.piecesLayer.id = 'piecesLayer';
    this.container.appendChild(this.canvas);
    this.container.appendChild(this.piecesLayer);

    this._resizeCanvas();
    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this.drawBoard();
      this.render();
    });

    this.container.addEventListener('click', (e) => this.handleClick(e));

    this.drawBoard();
    this.render();
    await this._tryAutoLogin();
    this.updatePanel();

    // 预加载 Pikafish（如果当前级别 >=4）
    if (this.ai.level >= 4 && typeof pikafishBridge !== 'undefined' && !pikafishBridge.ready) {
      pikafishBridge.init().catch((err) => {
        console.warn('Pikafish pre-init failed:', err);
      });
    }

    // 尝试恢复上次保存的棋局；如果需要弹窗，先不启动计时器
    this._tryResumeSnapshot();
    const resumeOverlay = document.getElementById('resumeOverlay');
    if (!resumeOverlay || !resumeOverlay.classList.contains('visible')) {
      this._startTimer();
      if (this.playerSide === 'b' && !this.game.result && this.game.history.length === 0) {
        setTimeout(() => this.triggerAi(), 600);
      }
    }

    // 检测 URL 中的房间码，自动加入
    this._initRoomFromURL();
    this._setupRoomButtons();
  }

  _resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.ctx = this.canvas.getContext('2d');
    const minDim = Math.min(this.canvas.width, this.canvas.height);
    this.cellSize = minDim / 9.5;
    this.margin = (this.canvas.width - 8 * this.cellSize) / 2;
    this.vMargin = (this.canvas.height - 9 * this.cellSize) / 2;
  }

  _visualRow(r) {
    return 9 - r;
  }

  drawBoard() {
    const ctx = this.ctx;
    const m = this.margin;
    const vm = this.vMargin;
    const cs = this.cellSize;
    const w = 8 * cs;
    const h = 9 * cs;

    ctx.fillStyle = '#e8c97a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.strokeStyle = '#5a3d1a';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(m, vm, w, h);

    ctx.lineWidth = 1;
    for (let i = 0; i <= 9; i++) {
      const y = vm + i * cs;
      ctx.beginPath();
      ctx.moveTo(m, y);
      ctx.lineTo(m + w, y);
      ctx.stroke();
    }

    for (let i = 0; i <= 8; i++) {
      const x = m + i * cs;
      ctx.beginPath();
      ctx.moveTo(x, vm);
      ctx.lineTo(x, vm + h);
      ctx.stroke();
    }

    // 楚河汉界
    const riverY = vm + 4 * cs + cs / 2;
    const bannerW = w * 0.55;
    const bannerH = cs * 0.72;
    const bannerX = m + (w - bannerW) / 2;
    const bannerY = riverY - bannerH / 2;

    ctx.save();
    ctx.fillStyle = '#c4a35a';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    this._roundRect(ctx, bannerX, bannerY, bannerW, bannerH, 8);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#8f6d2e';
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, bannerX, bannerY, bannerW, bannerH, 8);
    ctx.stroke();

    ctx.font = `bold ${Math.max(18, cs * 0.5)}px "STKaiti", "KaiTi", "楷体", serif`;
    ctx.fillStyle = '#3e2710';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.4)';
    ctx.shadowBlur = 2;
    ctx.fillText('楚 河', m + w * 0.28, riverY + 1);
    ctx.fillText('汉 界', m + w * 0.72, riverY + 1);
    ctx.restore();

    // 九宫
    ctx.lineWidth = 1.5;
    const palaceW = 2 * cs;
    const palaceH = 2 * cs;
    const px = m + 3 * cs;

    const pyBlack = vm;
    ctx.beginPath(); ctx.moveTo(px, pyBlack); ctx.lineTo(px + palaceW, pyBlack + palaceH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + palaceW, pyBlack); ctx.lineTo(px, pyBlack + palaceH); ctx.stroke();

    const pyRed = vm + 7 * cs;
    ctx.beginPath(); ctx.moveTo(px, pyRed); ctx.lineTo(px + palaceW, pyRed + palaceH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + palaceW, pyRed); ctx.lineTo(px, pyRed + palaceH); ctx.stroke();
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  render() {
    this.piecesLayer.innerHTML = '';
    const board = this.game.state.board;
    const cs = this.cellSize;
    const m = this.margin;
    const vm = this.vMargin;
    const pieceSize = Math.min(44, cs * 0.9);
    const offset = pieceSize / 2;

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) continue;
        const el = document.createElement('div');
        el.className = `piece ${isRed(p) ? 'red' : 'black'}`;
        el.textContent = this.pieceName(p);
        el.style.width = `${pieceSize}px`;
        el.style.height = `${pieceSize}px`;
        el.style.fontSize = `${pieceSize * 0.5}px`;
        const x = m + c * cs - offset;
        const y = vm + this._visualRow(r) * cs - offset;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        if (this.selected && this.selected.r === r && this.selected.c === c) {
          el.classList.add('selected');
        }
        if (this.lastMove) {
          if ((this.lastMove.fromR === r && this.lastMove.fromC === c) ||
              (this.lastMove.toR === r && this.lastMove.toC === c)) {
            el.classList.add('last-move');
          }
        }
        this.piecesLayer.appendChild(el);
      }
    }
  }

  pieceName(p) {
    const map = {
      K: '帅', A: '仕', E: '相', R: '車', H: '馬', C: '炮', P: '兵',
      k: '将', a: '士', e: '象', r: '车', h: '马', c: '炮', p: '卒',
    };
    return map[p] || p;
  }

  handleClick(e) {
    if (this.isSpectator || this.isAiThinking || this.game.result) return;
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.round((x - this.margin) / this.cellSize);
    const visualR = Math.round((y - this.vMargin) / this.cellSize);
    const r = 9 - visualR;
    if (c < 0 || c > 8 || r < 0 || r > 9) return;
    this.onBoardClick(r, c);
  }

  onBoardClick(r, c) {
    const board = this.game.state.board;
    const activeColor = this.game.state.activeColor;
    const p = board[r][c];

    if (activeColor !== this.playerSide) return;

    if (!this.selected) {
      if (p && ((activeColor === 'w' && isRed(p)) || (activeColor === 'b' && isBlack(p)))) {
        this.selected = { r, c };
        this.playSelectSound();
        this.showHints(r, c);
        this.render();
      }
      return;
    }

    if (this.selected.r === r && this.selected.c === c) {
      this.clearSelection();
      return;
    }

    if (p && ((activeColor === 'w' && isRed(p)) || (activeColor === 'b' && isBlack(p)))) {
      this.selected = { r, c };
      this.playSelectSound();
      this.showHints(r, c);
      this.render();
      return;
    }

    const moved = this.game.makeMove(this.selected.r, this.selected.c, r, c);
    if (moved) {
      this.playMoveSound();
      this.lastMove = { fromR: this.selected.r, fromC: this.selected.c, toR: r, toC: c };
      this.clearSelection();
      this.stepTimer[this.game.state.activeColor] = this._stepTime();
      this.render();
      this.updatePanel();
      this._autoSaveSnapshot();
      if (!this.timerInterval && !this.game.result) this._startTimer();

      // 房间同步：上报走法
      this._syncMoveToRoom(this.selected.r, this.selected.c, r, c);

      if (!this.game.result && this.game.state.activeColor === this.ai.side) {
        // AI 模式：触发 AI；PvP 模式：等待对手（轮询自动处理）
        if (this.roomGameType === 'ai' || !this.roomCode) {
          this.triggerAi();
        }
      }
      if (this.game.result) {
        this._handleGameEnd();
      }
    }
  }

  showHints(r, c) {
    this.clearHints();
    const moves = this.game.getLegalMoves(r, c);
    const board = this.game.state.board;
    const cs = this.cellSize;
    const m = this.margin;
    const vm = this.vMargin;
    for (const mv of moves) {
      const dot = document.createElement('div');
      dot.className = 'dot' + (board[mv.r][mv.c] ? ' eat' : '');
      dot.style.width = `${cs * 0.28}px`;
      dot.style.height = `${cs * 0.28}px`;
      const x = m + mv.c * cs;
      const y = vm + this._visualRow(mv.r) * cs;
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      this.piecesLayer.appendChild(dot);
    }
  }

  clearHints() {
    const dots = this.piecesLayer.querySelectorAll('.dot');
    dots.forEach((d) => d.remove());
  }

  clearSelection() {
    this.selected = null;
    this.clearHints();
    this.render();
  }

  playSelectSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      setTimeout(() => ctx.close(), 200);
    } catch (e) {}
  }

  playMoveSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
      setTimeout(() => ctx.close(), 200);
    } catch (e) {}
  }

  async triggerAi() {
    if (this.isAiThinking || this.game.result) return;
    if (this.ai._usingPikafish && typeof pikafishBridge !== 'undefined') {
      pikafishBridge.lastInfo = { depth: 0, nodes: 0, score: 0, nps: 0, time: 0 };
    }
    this.isAiThinking = true;
    this.updatePanel();
    try {
      const move = await this.ai.think(this.game);
      if (move && !this.game.result) {
        const success = this.game.makeMove(move.fromR, move.fromC, move.toR, move.toC);
        if (success) {
          this.playMoveSound();
          this.lastMove = { fromR: move.fromR, fromC: move.fromC, toR: move.toR, toC: move.toC };
          this.stepTimer[this.game.state.activeColor] = this._stepTime();
          this.render();
          this.updatePanel();
          this._autoSaveSnapshot();
          // 房间同步：上报 AI 走法
          this._syncMoveToRoom(move.fromR, move.fromC, move.toR, move.toC);
          if (!this.timerInterval && !this.game.result) this._startTimer();
          if (this.game.result) {
            await this._handleGameEnd();
          }
        }
      }
    } catch (e) {
      console.error('AI think error:', e);
    } finally {
      this.isAiThinking = false;
      this.updatePanel();
    }
  }

  _startTimer() {
    this._stopTimer();
    this.timerInterval = setInterval(() => {
      if (this.game.result) return;
      const side = this.game.state.activeColor;
      this.stepTimer[side] = Math.max(0, this.stepTimer[side] - 1);
      this.totalTimers[side] = Math.max(0, this.totalTimers[side] - 1);
      this.updatePanel();
      if (this.stepTimer[side] <= 0) {
        this.game.result = side === 'w' ? 'b' : 'w';
        this.updatePanel();
        this._handleGameEnd();
      }
    }, 1000);
  }

  _stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  _stepTime() {
    // PvP 模式：2分钟；AI 模式：60秒
    return (this.roomCode && this.roomGameType === 'pvp') ? 120 : 60;
  }

  _fmtTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  updatePanel() {
    const aiBar = document.getElementById('aiBar');
    const userBar = document.getElementById('userBar');
    const aiTimer = document.getElementById('aiTimer');
    const userTimer = document.getElementById('userTimer');
    const aiMeta = document.getElementById('aiMeta');
    const userMeta = document.getElementById('userMeta');
    const userNameDisplay = document.getElementById('userNameDisplay');
    const checkAlert = document.getElementById('checkAlert');

    if (aiBar) {
      const isAiTurn = this.game.state.activeColor === this.ai.side;
      aiBar.classList.toggle('active', isAiTurn);

      const engineStatusEl = document.getElementById('engineStatus');

      // PvP 模式：显示对手信息
      if (this.roomCode && this.roomGameType === 'pvp') {
        const opponentSide = this.roomPlayerSide === 'w' ? 'b' : 'w';
        const isOpponentTurn = this.game.state.activeColor === opponentSide;
        aiBar.classList.toggle('active', isOpponentTurn);
        const opponentName = opponentSide === 'w' ? '红方对手' : '黑方对手';
        const opponentEmoji = opponentSide === 'w' ? '🔴' : '⚫';
        const avatarEl = aiBar.querySelector('.avatar');
        if (avatarEl) avatarEl.textContent = '🙋';
        aiMeta.textContent = opponentName;
        const nameEl = aiBar.querySelector('.name');
        if (nameEl) nameEl.textContent = opponentEmoji + ' ' + opponentName;
        if (engineStatusEl) engineStatusEl.style.display = 'none';
      } else if (this.isSpectator) {
        // 观战模式
        aiMeta.textContent = '红方玩家';
        const nameEl = aiBar.querySelector('.name');
        if (nameEl) nameEl.textContent = '🔴 红方';
        const avatarEl = aiBar.querySelector('.avatar');
        if (avatarEl) avatarEl.textContent = '👤';
        if (engineStatusEl) engineStatusEl.style.display = 'none';
      } else {
        // AI 模式
        const avatarEl = aiBar.querySelector('.avatar');
        if (avatarEl) avatarEl.textContent = '🤖';
        const nameEl = aiBar.querySelector('.name');
        if (nameEl) nameEl.textContent = 'AI 对手';
        if (this.isAiThinking) {
          aiMeta.innerHTML = `第 ${this.ai.level} 级 · ${this.ai.getTitle()}<span class="thinking-dots"><span></span><span></span><span></span></span>`;
        } else {
          aiMeta.textContent = `第 ${this.ai.level} 级 · ${this.ai.getTitle()}`;
        }
      }
    }

    const engineStatus = document.getElementById('engineStatus');
    if (engineStatus && this.ai._usingPikafish) {
      const info = (typeof pikafishBridge !== 'undefined') ? pikafishBridge.lastInfo : null;
      if (this.isAiThinking && info && info.depth > 0) {
        engineStatus.style.display = 'block';
        const depthStr = `depth ${info.depth}`;
        const nodesStr = info.nodes > 0 ? ` · ${(info.nodes / 1000).toFixed(1)}k nodes` : '';
        const npsStr = info.nps > 0 ? ` · ${(info.nps / 1000).toFixed(1)}k nps` : '';
        engineStatus.textContent = `${depthStr}${nodesStr}${npsStr}`;
        // 如果深度太低（<6）或节点数太少（<10k），标红提示
        if (info.depth < 6 || info.nodes < 10000) {
          engineStatus.classList.add('weak');
        } else {
          engineStatus.classList.remove('weak');
        }
      } else if (!this.isAiThinking && info && info.depth > 0) {
        engineStatus.style.display = 'block';
        engineStatus.textContent = `last: depth ${info.depth} · ${(info.nodes / 1000).toFixed(1)}k nodes`;
        engineStatus.classList.remove('weak');
      } else {
        engineStatus.style.display = 'none';
      }
    } else if (engineStatus) {
      engineStatus.style.display = 'none';
    }

    if (userBar) {
      userBar.classList.toggle('active', this.game.state.activeColor === this.playerSide);
    }

    if (aiTimer) {
      aiTimer.textContent = `${this.stepTimer[this.ai.side]}s / ${this._fmtTime(this.totalTimers[this.ai.side])}`;
    }
    if (userTimer) {
      userTimer.textContent = `${this.stepTimer[this.playerSide]}s / ${this._fmtTime(this.totalTimers[this.playerSide])}`;
    }

    if (userMeta) {
      if (this.roomCode && this.roomGameType === 'pvp') {
        userMeta.textContent = '老翁朋友们 对战中';
      } else if (this.isSpectator) {
        userMeta.textContent = '观战中';
      } else {
        userMeta.textContent = this.playerSide === 'w' ? '执红先行' : '执黑后行';
      }
    }
    if (userNameDisplay) {
      userNameDisplay.textContent = this.currentUser ? this.currentUser.username : '游客';
    }

    if (checkAlert) {
      if (this.game.inCheck) {
        const sideName = this.game.state.activeColor === 'w' ? '红方' : '黑方';
        checkAlert.textContent = `${sideName}被将军！`;
        checkAlert.classList.add('visible');
        setTimeout(() => checkAlert.classList.remove('visible'), 1500);
      }
    }

    const statWin = document.getElementById('statWin');
    const statDraw = document.getElementById('statDraw');
    const statLoss = document.getElementById('statLoss');
    const statLevel = document.getElementById('statLevel');
    const statMaxLevel = document.getElementById('statMaxLevel');
    const aiSelect = document.getElementById('aiLevelSelect');
    if (statWin) statWin.textContent = this.progress.wins;
    if (statDraw) statDraw.textContent = this.progress.draws;
    if (statLoss) statLoss.textContent = this.progress.losses;
    if (statLevel) statLevel.textContent = this.progress.currentLevel;
    if (statMaxLevel) statMaxLevel.textContent = this.progress.maxLevel;
    if (aiSelect) {
      aiSelect.value = String(this.progress.currentLevel);
      // PvP/观战模式：隐藏AI等级选择
      if ((this.roomCode && this.roomGameType === 'pvp') || this.isSpectator) {
        aiSelect.style.display = 'none';
      } else {
        aiSelect.style.display = '';
      }
    }

    // 统计面板：PvP模式下隐藏"当前挑战"/"最高通关"（AI进度相关）
    if (statLevel) statLevel.parentElement.style.display = (this.roomCode && this.roomGameType === 'pvp') ? 'none' : '';
    if (statMaxLevel) statMaxLevel.parentElement.style.display = (this.roomCode && this.roomGameType === 'pvp') ? 'none' : '';

    // 控制面板按钮显隐
    const btnRestart = document.getElementById('btnRestart');
    const btnContinue = document.getElementById('btnContinue');
    const btnUndo = document.getElementById('btnUndo');
    const btnResign = document.getElementById('btnResign');
    const btnSave = document.getElementById('btnSave');
    const hasResult = !!this.game.result;
    if (btnRestart) btnRestart.style.display = hasResult ? 'none' : 'inline-block';
    if (btnContinue) btnContinue.style.display = hasResult ? 'inline-block' : 'none';
    if (btnUndo) btnUndo.style.display = hasResult ? 'none' : 'inline-block';
    if (btnResign) btnResign.style.display = hasResult ? 'none' : 'inline-block';
    if (btnSave) btnSave.style.display = hasResult ? 'none' : 'inline-block';

    this._renderLeaderboard();
  }

  async _handleGameEnd() {
    const result = this.game.result;
    const isPlayerWin = result === this.playerSide;
    const isDraw = result === 'draw';

    // 房间：上报结果
    if (this.roomCode) {
      const roomResult = result === 'w' ? 'w' : (result === 'b' ? 'b' : 'draw');
      api.roomFinish(this.roomCode, roomResult).catch(() => {});
    }

    if (this.currentUser) {
      try {
        const matchResult = isPlayerWin ? 'win' : (isDraw ? 'draw' : 'loss');
        const pgn = this.game.moveList.join(' ');
        const res = await api.post('/api/match', {
          ai_level: this.ai.level,
          result: matchResult,
          pgn,
        });
        this.currentUser = res.user;
        this.progress = this._loadProgress();
      } catch (e) {
        console.error('同步对局结果到服务端失败:', e);
        // 降级本地更新
        if (isPlayerWin) {
          this.progress.wins++;
          if (this.progress.currentLevel < 10) this.progress.currentLevel++;
          if (this.progress.currentLevel > this.progress.maxLevel) this.progress.maxLevel = this.progress.currentLevel;
        } else if (isDraw) {
          this.progress.draws++;
        } else {
          this.progress.losses++;
        }
        this._saveProgress();
      }
    } else {
      if (isPlayerWin) {
        this.progress.wins++;
        if (this.progress.currentLevel < 10) {
          this.progress.currentLevel++;
        }
        if (this.progress.currentLevel > this.progress.maxLevel) {
          this.progress.maxLevel = this.progress.currentLevel;
        }
      } else if (isDraw) {
        this.progress.draws++;
      } else {
        this.progress.losses++;
      }
      this._saveProgress();
    }

    this.updatePanel();

    const resultOverlay = document.getElementById('resultOverlay');
    const resultTitle = document.getElementById('resultTitle');
    const resultDetail = document.getElementById('resultDetail');
    const btnNext = document.getElementById('btnNextLevel');
    const btnRetry = document.getElementById('btnRetry');

    if (resultTitle) {
      if (isPlayerWin) {
        resultTitle.textContent = this.progress.currentLevel <= 10 && this.ai.level < 10
          ? `🎉 晋级成功！`
          : '👑 通关全等级！';
      } else if (isDraw) {
        resultTitle.textContent = '握手言和';
      } else {
        resultTitle.textContent = '挑战失败';
      }
    }

    if (resultDetail) {
      if (isPlayerWin) {
        resultDetail.textContent = `恭喜你战胜第 ${this.ai.level} 级 ${this.ai.getTitle()}！\n下一挑战：第 ${Math.min(10, this.ai.level + 1)} 级 ${AI_TITLES[Math.min(10, this.ai.level + 1)]}`;
      } else if (isDraw) {
        resultDetail.textContent = `和棋 · ${this.game.drawReason || '双方势均力敌'}\n可重新挑战第 ${this.ai.level} 级`;
      } else {
        resultDetail.textContent = `未能战胜第 ${this.ai.level} 级 ${this.ai.getTitle()}\n再接再厉，重新挑战！`;
      }
    }

    if (btnNext) btnNext.style.display = isPlayerWin && this.ai.level < 10 ? 'inline-block' : 'none';
    if (btnRetry) btnRetry.style.display = !isPlayerWin || this.ai.level >= 10 ? 'inline-block' : 'none';

    if (resultOverlay) resultOverlay.classList.add('visible');

    if (isPlayerWin) {
      this._showVoiceToast('human');
    } else if (!isDraw) {
      this._showVoiceToast('ai');
    }
  }

  nextLevel() {
    const next = Math.min(10, this.ai.level + 1);
    this.ai.setLevel(next);
    this.progress.currentLevel = next;
    this._saveProgress();
    this.restart();
  }

  retryLevel() {
    this.restart();
  }

  _showVoiceToast(type) {
    const toast = document.getElementById('voiceToast');
    const icon = document.getElementById('voiceToastIcon');
    const text = document.getElementById('voiceToastText');
    if (!toast || !text) return;
    if (type === 'human') {
      icon.textContent = '🌟';
      text.textContent = '老翁看好你哦';
      toast.classList.remove('ai-win');
      this._speak('老翁看好你哦');
    } else {
      icon.textContent = '🤝';
      text.textContent = '老翁和你一块再接再厉哦';
      toast.classList.add('ai-win');
      this._speak('老翁和你一块再接再厉哦');
    }
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  _speak(text) {
    if ('speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = 1;
      window.speechSynthesis.speak(utter);
    } else {
      // 降级：简单蜂鸣
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {}
    }
  }

  async _renderLeaderboard() {
    const list = document.getElementById('leaderboardList');
    const sideList = document.getElementById('leaderboardSideList');
    if (!list) return;
    try {
      const top5 = await api.get('/api/leaderboard');
      const html = top5.map((u, i) => {
        let rankClass = '';
        if (i === 0) rankClass = 'gold';
        else if (i === 1) rankClass = 'silver';
        else if (i === 2) rankClass = 'bronze';
        return `<div class="leaderboard-row">
          <div class="leaderboard-rank ${rankClass}">${u.rank}</div>
          <div class="leaderboard-name" title="${u.username}">${u.username}</div>
          <div class="leaderboard-stat">最高 ${u.max_level} 级 · ${u.wins}胜${u.draws}和${u.losses}负</div>
        </div>`;
      }).join('');
      list.innerHTML = html;
      if (sideList) sideList.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<div class="leaderboard-row" style="justify-content:center;color:#888">排行榜加载失败</div>';
      if (sideList) sideList.innerHTML = '';
    }
  }

  resign() {
    if (this.game.result) return;
    this.game.resign(this.playerSide);
    this.updatePanel();
    this._handleGameEnd();
  }

  flipSide() {
    this.playerSide = this.playerSide === 'w' ? 'b' : 'w';
    this.ai.side = this.ai.side === 'w' ? 'b' : 'w';
    this.restart();
  }

  setAiLevel(level) {
    this.ai.setLevel(level);
    this.progress.currentLevel = level;
    this._saveProgress();
    this.updatePanel();
    // 预加载 Pikafish WASM
    if (level >= 4 && typeof pikafishBridge !== 'undefined' && !pikafishBridge.ready) {
      pikafishBridge.init().catch((err) => {
        console.warn('Pikafish pre-init failed:', err);
      });
    }
  }

  closeResultOverlay() {
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');
    // 不 restart，保留当前棋盘结束状态，等待用户点击"继续下一局"
    this.updatePanel();
  }

  saveSnapshot() {
    this._autoSaveSnapshot();
    this._stopTimer();
    // 简单的 Toast 提示
    const toast = document.getElementById('voiceToast');
    const icon = document.getElementById('voiceToastIcon');
    const text = document.getElementById('voiceToastText');
    if (toast && text) {
      icon.textContent = '💾';
      text.textContent = '已保存，可随时回来继续';
      toast.classList.remove('ai-win');
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 2000);
    }
  }

  _autoSaveSnapshot() {
    try {
      const snapshot = {
        state: this.game.state,
        history: this.game.history,
        moveList: this.game.moveList,
        result: this.game.result,
        inCheck: this.game.inCheck,
        drawReason: this.game.drawReason,
        stepTimer: this.stepTimer,
        totalTimers: this.totalTimers,
        lastMove: this.lastMove,
        playerSide: this.playerSide,
        aiLevel: this.ai.level,
        aiSide: this.ai.side,
        currentUser: this.currentUser,
      };
      localStorage.setItem('xiangqi-snapshot-v1', JSON.stringify(snapshot));
    } catch (e) {}
  }

  _clearSnapshot() {
    try {
      localStorage.removeItem('xiangqi-snapshot-v1');
    } catch (e) {}
  }

  _tryResumeSnapshot() {
    try {
      const raw = localStorage.getItem('xiangqi-snapshot-v1');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !data.state) return;
      // 如果存档的对局已经结束，且当前没有恢复意愿，直接清除（避免 stale）
      // 否则弹出提示
      const resumeOverlay = document.getElementById('resumeOverlay');
      if (resumeOverlay) resumeOverlay.classList.add('visible');
    } catch (e) {
      this._clearSnapshot();
    }
  }

  resumeSnapshot() {
    const resumeOverlay = document.getElementById('resumeOverlay');
    if (resumeOverlay) resumeOverlay.classList.remove('visible');
    try {
      const raw = localStorage.getItem('xiangqi-snapshot-v1');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !data.state) return;

      // 恢复 game
      this.game.state = data.state;
      this.game.history = data.history || [];
      this.game.moveList = data.moveList || [];
      this.game.result = data.result || null;
      this.game.inCheck = data.inCheck || false;
      this.game.drawReason = data.drawReason || '';

      // 恢复 board 状态
      this.stepTimer = data.stepTimer || { w: 60, b: 60 };
      this.totalTimers = data.totalTimers || { w: 1200, b: 1200 };
      this.lastMove = data.lastMove || null;
      this.playerSide = data.playerSide || 'w';
      this.ai.setLevel(data.aiLevel || 1);
      this.ai.side = data.aiSide || 'b';
      this.currentUser = data.currentUser || null;
      this.progress = this._loadProgress();
      this.selected = null;
      this.isAiThinking = false;

      this.clearHints();
      this.drawBoard();
      this.render();
      this.updatePanel();
      this._startTimer();
    } catch (e) {
      console.error('恢复棋局失败:', e);
      this._clearSnapshot();
    }
  }

  discardSnapshot() {
    const resumeOverlay = document.getElementById('resumeOverlay');
    if (resumeOverlay) resumeOverlay.classList.remove('visible');
    this._clearSnapshot();
    // 已经开始新局的话不需要额外操作
    if (this.game.history.length === 0) return;
    this.restart();
  }

  restart() {
    if (typeof pikafishBridge !== 'undefined') {
      pikafishBridge.ucinewgame().catch(() => {});
    }
    this.ai.cancelThink();
    this.game.reset();
    this.selected = null;
    this.lastMove = null;
    this.isAiThinking = false;
    const st = this._stepTime();
    this.stepTimer = { w: st, b: st };
    this.totalTimers = { w: st * 20, b: st * 20 };
    this.clearHints();
    this.drawBoard();
    this.render();
    this.updatePanel();
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');
    this._clearSnapshot();
    this._startTimer();
    // 只有AI模式且玩家执黑时才触发AI先行
    if (this.playerSide === 'b' && !this.game.result && !this.roomCode) {
      setTimeout(() => this.triggerAi(), 600);
    }
  }

  undo() {
    if (this.isAiThinking) return;
    if (this.game.history.length === 0) return;

    const stepsToUndo = this._calcUndoSteps();
    for (let i = 0; i < stepsToUndo; i++) {
      this.game.undo();
    }
    this.stepTimer[this.game.state.activeColor] = this._stepTime();

    this.selected = null;
    this.lastMove = this.game.history.length > 0
      ? {
          fromR: this.game.history[this.game.history.length - 1].fromR,
          fromC: this.game.history[this.game.history.length - 1].fromC,
          toR: this.game.history[this.game.history.length - 1].toR,
          toC: this.game.history[this.game.history.length - 1].toC,
        }
      : null;
    this.clearHints();
    this.render();
    this.updatePanel();
    this._autoSaveSnapshot();
    if (!this.timerInterval && !this.game.result) this._startTimer();
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');
  }

  _calcUndoSteps() {
    if (this.game.state.activeColor === this.playerSide) {
      return 1;
    }
    return 2;
  }
}
