# 中国象棋 Web 游戏 - 开发文档

> 文档生成时间：2026-04-17  
> 本文件记录项目架构、关键技术决策与运行方式。

---

## 一、项目架构

纯前端网页游戏 + 轻量级 Python FastAPI 后端（可选）。核心对弈逻辑全部在浏览器中运行，后端仅负责用户持久化、排行榜和对局流水。

```
.
├── index.html              # 主页面（登录、棋盘、UI）
├── css/style.css           # 全部样式
├── js/
│   ├── rules.js            # 规则引擎：FEN、合法性、将军/将死/困毙
│   ├── game.js             # 状态机：走子、历史栈、胜负判定、重复局面
│   ├── ai.js               # AI 引擎：1-3级 JS Minimax，4-10级 Pikafish WASM
│   ├── board.js            # 渲染器：Canvas + DOM 事件、计时器、用户系统
│   ├── api.js              # 前端 HTTP 客户端（JWT）
│   └── pikafish/           # Pikafish WASM 引擎文件
│       ├── pikafish.wasm   # simd128 编译产物（590KB）
│       ├── pikafish.js     # Emscripten 胶水代码（174KB）
│       ├── pikafish.data   # NNUE 权重（18MB）
│       └── pikafish.worker.js  # Web Worker + UCI 适配器
├── backend/                # Python FastAPI + SQLite 后端
│   ├── main.py             # 5 个 API 路由
│   ├── auth.py             # bcrypt + JWT
│   ├── models.py           # SQLAlchemy 模型
│   ├── schemas.py          # Pydantic 校验
│   ├── database.py         # SQLite 引擎
│   └── requirements.txt
└── test-engine.html        # Pikafish 诊断页面（调试用）
```

---

## 二、规则引擎（`js/rules.js`）

### 2.1 坐标系
- `board[row][col]`，其中 `row 0` 是红方底线（屏幕下方），`row 9` 是黑方底线（屏幕上方）。
- FEN 生成从第 9 行写到第 0 行。

### 2.2 核心函数
- `parseFEN(fen)` / `generateFEN(state)` — WXF 标准 FEN
- `isLegalMove(state, fromR, fromC, toR, toC)` — 几何路径 + 将军检测 + 将帅照面
- `getAllLegalMoves(state, side)` — 生成某方全部合法着法
- `isCheckmate(state, side)` / `isStalemate(state, side)` — 将死/困毙

### 2.3 性能优化
- `isLegalMove` 使用**就地模拟走子**（先修改 board，检测后恢复），避免频繁 `cloneBoard`，AI 搜索性能提升约 3~5 倍。

---

## 三、AI 引擎（`js/ai.js`）

### 3.1 等级映射

| 等级 | 引擎 | 正常思考时间 | 重复局面加时 |
|------|------|--------------|--------------|
| 1 | JS AI | ~1s | 无 |
| 2 | JS AI | ~1s | 无 |
| 3 | JS AI | ~1s | 无 |
| 4 | Pikafish | 1.5s | 10s |
| 5 | Pikafish | 2.0s | 10s |
| 6 | Pikafish | 2.5s | 10s |
| 7 | Pikafish | 3.0s | 10s |
| 8 | Pikafish | 3.0s | 10s |
| 9 | Pikafish | 5.0s | 10s |
| 10 | Pikafish | 7.0s | 14s |

### 3.2 JS AI（1-3 级）
- Minimax + Alpha-Beta
- 1 级已具备原 4 级实力（depth 2 + 安全检测），避免主动送子

### 3.3 Pikafish WASM（4-10 级）
- 使用 `wasm-single-simd128` 构建，浏览器中性能较普通 wasm 提升 2~3 倍
- Web Worker 加载，避免阻塞 UI 主线程
- 采用 `go movetime` 而非 `go depth`，确保每步时间可控
- 使用单例 `pikafishBridge`，全局共享一个 Worker
- 动态加时：当检测到当前局面已重复 2 次时，思考时间翻倍，促使 AI 主动变招

---

## 四、胜负与和棋判定（`js/game.js`）

### 4.1 标准胜负
- 将死（Checkmate）→ 被将死方负
- 困毙（Stalemate）→ 无子可走方负
- 认输 → 直接判负

### 4.2 和棋规则
1. **自然限着**：120 半回合（60 回合）无吃子/进兵 → 和棋
2. **绝对步数**：1000 回合（2000 步）→ 和棋
3. **重复局面**：同一简化 FEN（不含 halfmove/fullmove）出现 3 次 → 和棋
4. **长将判负**：如果触发重复局面的同时，最近连续 3 步及以上都是将军 → **长将方判负**

### 4.3 重复局面实现
- `positionHistory`：Map<简化FEN, 出现次数>
- `checkHistory`：记录每步是否形成将军
- `undo()` 时会正确回退计数

---

## 五、后端服务（`backend/`）

### 5.1 接口列表

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/register` | POST | 注册，返回 access_token + 用户数据 |
| `/api/login` | POST | 登录，返回 access_token + 用户数据 |
| `/api/me` | GET | Token 鉴权，返回当前用户 |
| `/api/leaderboard` | GET | 战绩前 5 名 |
| `/api/match` | POST | 记录对局结果，自动更新用户等级/战绩 |

### 5.2 数据模型
- **User**：username, hashed_password, max_level, wins, draws, losses
- **Match**：username, ai_level, result, pgn, created_at

### 5.3 启动方式
```bash
cd backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001
```

### 5.4 前端对接
- `js/api.js` 封装了 `get/post`、Token 本地持久化
- 未登录用户使用 `localStorage` 保存游客进度
- 登录用户所有进度走后端数据库

---

## 六、UI 与交互（`js/board.js`）

### 6.1 计时器
- **步时**：60 秒/步，超时自动判负
- **局时**：20 分钟/方
- 支持"保存并暂离"：点击后**暂停计时**，关闭/刷新页面后可恢复对局

### 6.2 恢复对局弹窗
- 页面加载时若检测到未完成存档，弹出模态框：
  - **继续对局** → 恢复完整棋盘、计时器、历史记录
  - **开始新局** → 丢弃存档

### 6.3 排行榜
- 移动端：棋盘下方显示
- 桌面端（≥920px）：右侧固定悬浮面板显示前 5 名

### 6.4 语音 Toast
- 玩家胜利："老翁看好你哦"（翠绿 Toast + 语音朗读）
- AI 胜利："老翁和你一块再接再厉哦"（蓝色 Toast + 语音朗读）

---

## 七、FEN 兼容说明

项目使用的 FEN 棋子符号（WXF 标准）：
- 红方：`K` 帅, `A` 仕, `E` 相, `R` 车, `H` 马, `C` 炮, `P` 兵
- 黑方：`k` 将, `a` 士, `e` 象, `r` 车, `h` 马, `c` 炮, `p` 卒

Pikafish 官方使用 `N` 代表马、`B` 代表相，因此 `PikafishBridge.convertFEN()` 会在发送前自动替换：
- `H/h` → `N/n`
- `E/e` → `B/b`

---

## 八、调试工具

### 8.1 引擎诊断页面
打开 `http://localhost:8088/test-engine.html`，可：
- 独立启动 Pikafish Worker
- 发送自定义 UCI 命令
- 观察 `info depth / nodes / nps` 输出，验证 NNUE 是否正常加载

### 8.2 浏览器控制台
Pikafish 的思考过程会实时输出到 Console：
```
[Pikafish] info depth 12 score cp 45 nodes 456789 nps 31241 ...
```
若 `depth < 6` 或 `nodes < 10k`，说明 NNUE 可能未正确加载，棋力会大幅下降。

---

## 九、已知限制

1. **WASM 单线程性能天花板**
   - 浏览器中 7 秒思考时间通常只能搜到 depth 12~14
   - 无法达到需求文档中写的"25 Ply / 3200+ Elo"的桌面级水准

2. **长捉未完全实现**
   - 当前仅实现了"长将判负"和"重复局面和棋"
   - "长捉"（一子连续追吃对方同一子）未单独检测

3. **PGN 导出**
   - 目前只有中文记谱列表，没有标准 PGN 导出功能

4. **纯前端存档**
   - "保存并暂离"依赖浏览器 `localStorage`，换设备后无法恢复

---

## 十、快速启动（完整流程）

```bash
# 终端 1：启动后端
cd /Users/shengchanli/xiangqikaifa20206041601/backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001

# 终端 2：启动前端静态服务器
cd /Users/shengchanli/xiangqikaifa20206041601
python3 -m http.server 8088

# 浏览器打开
open http://localhost:8088
```

---

## 十一、修改历史摘要

- **2026-04-17**
  - 集成 Pikafish WASM（simd128），4-10 级使用 NNUE 引擎
  - 重写用户系统，接入 FastAPI + JWT + SQLite 后端
  - 新增排行榜、语音 Toast、保存并暂离、重复局面/长将规则
  - 优化 `isLegalMove` 就地模拟，提升 JS AI 性能
  - 1 级复用原 4 级深度，避免主动送子
  - 8/9/10 级改用 `movetime` 限时思考，时间可控
  - 动态加时机制：重复局面时自动延长思考时间
