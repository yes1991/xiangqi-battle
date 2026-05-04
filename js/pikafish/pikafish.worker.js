// Pikafish Web Worker (simd128 build)
importScripts('pikafish.js');

let engineReady = false;
let pikafish = null;
let currentResolve = null;
let outputBuffer = [];

function onStdout(text) {
  outputBuffer.push(text);
  postMessage({ type: 'info', data: text });
  if (currentResolve) {
    currentResolve(text);
    currentResolve = null;
  }
}

Pikafish().then((instance) => {
  pikafish = instance;
  pikafish.read_stdout = onStdout;
  engineReady = true;
  postMessage({ type: 'ready' });
}).catch((err) => {
  postMessage({ type: 'error', data: String(err) });
});

function sendCmd(cmd) {
  if (!engineReady || !pikafish) return;
  pikafish.send_command(cmd);
}

function waitForLine(keyword, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      for (let i = 0; i < outputBuffer.length; i++) {
        if (outputBuffer[i].includes(keyword)) {
          const line = outputBuffer[i];
          outputBuffer.splice(0, i + 1);
          resolve(line);
          return;
        }
      }
      if (Date.now() > deadline) {
        currentResolve = null;
        reject(new Error('Pikafish timeout: ' + keyword));
        return;
      }
      currentResolve = (text) => {
        if (text.includes(keyword)) {
          resolve(text);
        } else {
          setTimeout(check, 10);
        }
      };
    }
    check();
  });
}

onmessage = async function(e) {
  if (!engineReady) {
    postMessage({ type: 'error', data: 'Engine not ready yet' });
    return;
  }

  const data = e.data;
  if (data.cmd === 'init') {
    sendCmd('uci');
    try {
      await waitForLine('uciok', 8000);
      sendCmd('setoption name Threads value 1');
      sendCmd('setoption name Hash value 128');
      sendCmd('isready');
      await waitForLine('readyok', 8000);
      postMessage({ type: 'initok' });
    } catch (err) {
      postMessage({ type: 'error', data: err.message });
    }
    return;
  }

  if (data.cmd === 'go') {
    const fen = data.fen || 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
    const depth = data.depth || 10;
    const movetime = data.movetime || 0;

    outputBuffer = [];
    sendCmd('position fen ' + fen);
    if (movetime > 0) {
      sendCmd('go movetime ' + movetime);
    } else {
      sendCmd('go depth ' + depth);
    }

    try {
      const line = await waitForLine('bestmove', movetime > 0 ? movetime + 5000 : 60000);
      const parts = line.trim().split(/\s+/);
      postMessage({ type: 'bestmove', bestmove: parts[1] || '', ponder: parts[3] || '' });
    } catch (err) {
      postMessage({ type: 'error', data: err.message });
    }
    return;
  }

  if (data.cmd === 'newgame') {
    sendCmd('ucinewgame');
    return;
  }
};
