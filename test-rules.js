/**
 * 规则引擎快速验证脚本
 */

const Rules = require('./js/rules.js');
const { XiangqiGame } = require('./js/game.js');

// 让 game.js 中的全局引用可用
global.Rules = Rules;

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

console.log('=== 测试 FEN 解析与生成 ===');
const fenData = Rules.parseFEN(Rules.INITIAL_FEN);
assert(fenData.board[0][0] === 'R', '红车应在(0,0)');
assert(fenData.board[0][4] === 'K', '红帅应在(0,4)');
assert(fenData.board[9][4] === 'k', '黑将应在(9,4)');
assert(fenData.board[3][0] === 'P', '红兵应在(3,0)');
assert(fenData.board[6][0] === 'p', '黑卒应在(6,0)');
const regenerated = Rules.generateFEN(fenData);
assert(regenerated === Rules.INITIAL_FEN, 'FEN 再生应一致');
console.log('FEN 测试通过');

console.log('\n=== 测试基本走法合法性 ===');
const game = new XiangqiGame();

// 红方先行，马(0,1) 跳到 (2,2) 应合法
assert(Rules.isLegalMove(game.state, 0, 1, 2, 2), '马应可跳到 (2,2)');
// 炮(2,1) 在初始位置可以直走两步到 (4,1)，因为 (3,1) 为空
assert(Rules.isLegalMove(game.state, 2, 1, 4, 1), '炮应可走至 (4,1)');
// 车(0,0) 被兵(3,0) 挡住，无法走到 (4,0)（中间兵挡路且目标为空）
assert(!Rules.isLegalMove(game.state, 0, 0, 4, 0), '车应被兵挡住');
// 兵(3,0) 向前一步到 (4,0) 合法（红方在下方，向前走 row 增加）
assert(Rules.isLegalMove(game.state, 3, 0, 4, 0), '兵应可前进到 (4,0)');
// 兵不能横走
assert(!Rules.isLegalMove(game.state, 3, 0, 3, 1), '兵未过河不应能横走');
// 车(0,0) 被兵挡住不能前进
assert(!Rules.isLegalMove(game.state, 0, 0, 3, 0), '车应被兵挡住');
console.log('基本走法测试通过');

console.log('\n=== 测试将帅移动与照面 ===');
// 构造一个将帅照面的测试局面
// 清空中间，让帅和将面对面
const testFEN = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
const testState = Rules.parseFEN(testFEN);
assert(Rules.isFaceToFace(testState.board), '应将帅照面检测为 true');
// 帅向上移动后仍照面，非法
assert(!Rules.isLegalMove({ ...testState, activeColor: 'w' }, 0, 4, 1, 4), '帅不能主动维持照面');
// 帅平移离开同一列，合法
assert(Rules.isLegalMove({ ...testState, activeColor: 'w' }, 0, 4, 0, 3), '帅应可平移');
console.log('将帅照面测试通过');

console.log('\n=== 测试将军与应将 ===');
// 车将军测试：红车在 (3,4) 横向对准黑将 (9,4)
const checkFEN = '4k4/9/9/9/9/4R4/9/9/9/9 b - - 0 1';
const checkState = Rules.parseFEN(checkFEN);
assert(Rules.isCheck(checkState.board, 'b'), '黑方应被将军');
assert(!Rules.isCheck(checkState.board, 'w'), '红方不应被将军');
// 黑将可以平移至 (9,3) 躲避（(8,4) 仍在车线上，不合法；将帅不能斜走）
assert(Rules.isLegalMove(checkState, 9, 4, 9, 3), '黑将应可躲避至 (9,3)');
assert(!Rules.isLegalMove(checkState, 9, 4, 8, 4), '黑将不应走到仍在将军的位置');
console.log('将军测试通过');

console.log('\n=== 测试将死判定 ===');
// 双车底线将死：黑将(9,0)，红车A(9,1)将军，红车B(8,0)将军，红车C(7,0)控制吃子
const mateFEN = 'k1R7/R8/R8/9/9/9/9/9/9/9 b - - 0 1';
const mateState = Rules.parseFEN(mateFEN);
assert(Rules.isCheck(mateState.board, 'b'), '黑方应被将军');
const blackMoves = Rules.getAllLegalMoves(mateState, 'b');
assert(blackMoves.length === 0, '黑方应无合法走法（将死）');
assert(Rules.isCheckmate(mateState, 'b'), '应将死判定为 true');
console.log('将死测试通过');

console.log('\n=== 测试困毙判定 ===');
// 困毙：黑将(9,4) 被三面包围，未被将军但无路可走
// 红兵(8,3) 控制 (9,3)；红兵(8,5) 控制 (9,5)；红兵(7,4) 控制 (8,4)
const staleFEN = '4k4/3P1P3/4P4/9/9/9/9/9/9/9 b - - 0 1';
const staleState = Rules.parseFEN(staleFEN);
assert(!Rules.isCheck(staleState.board, 'b'), '黑方不应被将军');
const bm = Rules.getAllLegalMoves(staleState, 'b');
assert(bm.length === 0, '黑方应无合法走法（困毙）');
assert(Rules.isStalemate(staleState, 'b'), '应困毙判定为 true');
console.log('困毙测试通过');

console.log('\n=== 测试完整对局流程 ===');
const g = new XiangqiGame();
// 初始局面 row3: P1P1P1P1P -> (3,2)=P（红方三路兵）
assert(g.makeMove(3, 2, 4, 2), '兵三进一应合法'); // 红兵向前（row 增加）
assert(g.state.activeColor === 'b', '应轮到黑方');
assert(g.moveList.length === 1, '记录应为1步');
g.undo();
assert(g.moveList.length === 0, '悔棋后记录应为0');
assert(g.state.activeColor === 'w', '悔棋后应回到红方');
console.log('对局流程测试通过');

console.log('\n✅ 所有规则引擎测试通过！');
