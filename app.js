/* app.js
   Single-file frontend for 2-player online Ludo (cartoon) + Chess (wooden)
   - Room system (create/join)
   - Secrets (save)
   - Start game
   - Ludo: realistic turn rules (2 players only), roll control, move, capture, safe
   - Chess: piece highlight + send moves to server
   - Winner reveals secret in floating-hearts modal (only for winner)
*/

const socket = io();

// UI refs
const nameInput = document.getElementById('nameInput');
const gameSelect = document.getElementById('gameSelect');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const joinCode = document.getElementById('joinCode');
const secretInput = document.getElementById('secretInput');
const saveSecretBtn = document.getElementById('saveSecretBtn');

const roomBox = document.getElementById('roomBox');
const roomCodeSpan = document.getElementById('roomCodeSpan');
const playersList = document.getElementById('playersList');
const startBtn = document.getElementById('startBtn');
const leaveBtn = document.getElementById('leaveBtn');
const readyHint = document.getElementById('readyHint');

const lobby = document.getElementById('lobby');
const gameArea = document.getElementById('gameArea');
const roomCodeTop = document.getElementById('roomCodeTop');
const playerA = document.getElementById('playerA');
const playerB = document.getElementById('playerB');
const backLobbyBtn = document.getElementById('backLobbyBtn');

const gameContainer = document.getElementById('gameContainer');
const diceArea = document.getElementById('diceArea');
const rollBtn = document.getElementById('rollBtn');
const diceVal = document.getElementById('diceVal');
const chessControls = document.getElementById('chessControls');
const resignBtn = document.getElementById('resignBtn');

let mySid = null;
let room = null;
let gameType = null;
let amHost = false;
let meSetSecret = false;
let opponentSetSecret = false;
let myColor = null;

// small hidden fallback name (Palak obf)
const hiddenB64 = 'UGFsYWsgUGFuZGV5';
function decodeHidden(){ try{ return atob(hiddenB64); } catch(e){ return 'Friend'; } }

function showLobby(){ lobby.style.display='block'; gameArea.style.display='none'; }
function showGame(){ lobby.style.display='none'; gameArea.style.display='block'; }

// Lobby actions
createBtn.onclick = () => {
  const name = nameInput.value.trim() || decodeHidden();
  gameType = gameSelect.value;
  socket.emit('create_room',{name,game:gameType});
};
joinBtn.onclick = () => {
  const name = nameInput.value.trim() || decodeHidden();
  const code = joinCode.value.trim().toUpperCase();
  if(!code){ alert('Enter room code'); return; }
  socket.emit('join_room',{name,code});
};
saveSecretBtn.onclick = () => {
  const s = (secretInput.value||'').trim();
  if(!s) return alert('Type a secret then click Save');
  socket.emit('set_secret',{room,secret:s});
  meSetSecret = true;
  readyHint.textContent = 'Secret saved.';
};
startBtn.onclick = () => {
  const s = (secretInput.value||'').trim();
  if(s && !meSetSecret) socket.emit('set_secret',{room,secret:s});
  socket.emit('start_game',{room});
};
leaveBtn.onclick = () => {
  socket.emit('leave_room',{room});
  resetLobby();
};
backLobbyBtn.onclick = () => {
  socket.emit('leave_room',{room});
  resetLobby();
};
rollBtn.onclick = () => {
  socket.emit('roll_dice',{room});
};
resignBtn.onclick = () => {
  if(confirm('Resign?')) socket.emit('resign',{room});
};

// socket events
socket.on('connect', ()=>{ mySid = socket.id; console.log('connected', mySid); });
socket.on('room_created', data => {
  room = data.code; amHost = true; gameType = data.game;
  roomCodeSpan.textContent = room;
  roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display = 'block';
  setPlayersDisplay(data.players);
  showLobby();
});
socket.on('room_joined', data => {
  room = data.code; amHost = false; gameType = data.game;
  roomCodeSpan.textContent = room;
  roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display = 'block';
  setPlayersDisplay(data.players);
  showLobby();
});
socket.on('players_update', data => {
  setPlayersDisplay(data.players);
  opponentSetSecret = data.players.some(p => p.sid !== mySid && p.secretSet);
  meSetSecret = data.players.some(p => p.sid === mySid && p.secretSet);
  readyHint.textContent = !meSetSecret ? 'Set your secret message' : (!opponentSetSecret ? 'Waiting for other player' : 'Both set - host can start');
  startBtn.disabled = !(amHost && data.players.length===2 && data.players.every(p => p.secretSet));
});
socket.on('start_ack', data => {
  gameType = data.game || gameType;
  if(gameType === 'chess' && data.state && data.state.color_of){
    myColor = data.state.color_of[mySid] || null;
  }
  buildGameUI(gameType, data.state, data.players);
  showGame();
});
socket.on('state_update', data => {
  if(!data) return;
  if(gameType === 'ludo') renderLudoState(data.state);
  else renderChessState(data.state);
});
socket.on('dice_result', data => {
  diceVal.textContent = data.val;
});
socket.on('not_your_turn', d => { alert(d.msg || 'Not your turn'); });
socket.on('no_dice', d => { alert(d.msg || 'Roll the dice first'); });
socket.on('invalid_move', d => { alert(d.msg || 'Invalid move'); });
socket.on('illegal_move', d => { alert(d.msg || 'Illegal move'); });
socket.on('game_over', d => { handleGameOver(d); });
socket.on('reveal_secret', d => { showSecretReveal(d.secret); });
socket.on('left_room', ()=>{ resetLobby(); });

// helpers
function setPlayersDisplay(players){
  playersList.textContent = players.map(p => p.name + (p.secretSet ? ' ✅' : '')).join(' | ');
  playerA.textContent = players[0] ? players[0].name : '—';
  playerB.textContent = players[1] ? players[1].name : '—';
}
function resetLobby(){
  room = null; amHost = false; meSetSecret = false; opponentSetSecret = false; myColor = null;
  roomBox.style.display = 'none'; startBtn.disabled = true;
  showLobby();
  gameContainer.innerHTML = ''; diceArea.style.display = 'none'; chessControls.style.display = 'none';
}

// Build game UI
function buildGameUI(type, state, players){
  gameContainer.innerHTML = ''; diceArea.style.display='none'; chessControls.style.display='none';
  if(type === 'ludo'){
    diceArea.style.display='block';
    buildLudoBoard();
    renderLudoState(state);
  } else {
    chessControls.style.display='block';
    buildChessBoard();
    renderChessState(state);
  }
}

/* ---------------- LUDO UI & interactions ---------------- */
const START_IDX = [0,13,26,39];
const SAFE_SQUARES = new Set([0,8,13,21,26,34,39,47]);

function buildLudoBoard(){
  const wrap = document.createElement('div');
  wrap.className = 'ludo-board';
  wrap.id = 'ludoBoard';
  gameContainer.appendChild(wrap);

  const board = document.getElementById('ludoBoard');
  const size = 520, center = size/2, r = 190;
  const centerBox = document.createElement('div');
  centerBox.style.position='absolute'; centerBox.style.left=`${center-60}px`; centerBox.style.top=`${center-60}px`;
  centerBox.style.width='120px'; centerBox.style.height='120px'; centerBox.style.borderRadius='8px';
  centerBox.style.background='linear-gradient(180deg,#fff9f9,#fffafc)'; centerBox.style.boxShadow='inset 0 2px 6px rgba(0,0,0,0.03)';
  board.appendChild(centerBox);

  for(let i=0;i<52;i++){
    const angle = (i/52)*Math.PI*2;
    const x = center + Math.cos(angle)*r - 20;
    const y = center + Math.sin(angle)*r - 20;
    const cell = document.createElement('div');
    cell.className = 'ludo-cell';
    cell.style.left = `${x}px`; cell.style.top = `${y}px`;
    cell.dataset.index = i;
    cell.style.width = '40px'; cell.style.height='40px';
    cell.style.border = '1px solid rgba(0,0,0,0.04)';
    cell.style.background = SAFE_SQUARES.has(i) ? '#fff3f6' : '#ffffff';
    board.appendChild(cell);
  }

  const redCorner = document.createElement('div'); redCorner.className='ludo-cell corner-red';
  redCorner.style.left='12px'; redCorner.style.top='12px'; redCorner.style.width='160px'; redCorner.style.height='160px';
  board.appendChild(redCorner);
  const greenCorner = document.createElement('div'); greenCorner.className='ludo-cell corner-green';
  greenCorner.style.right='12px'; greenCorner.style.top='12px'; greenCorner.style.width='160px'; greenCorner.style.height='160px';
  greenCorner.style.position='absolute';
  board.appendChild(greenCorner);
  const yellowCorner = document.createElement('div'); yellowCorner.className='ludo-cell corner-yellow';
  yellowCorner.style.right='12px'; yellowCorner.style.bottom='12px'; yellowCorner.style.width='160px'; yellowCorner.style.height='160px';
  yellowCorner.style.position='absolute';
  board.appendChild(yellowCorner);
  const blueCorner = document.createElement('div'); blueCorner.className='ludo-cell corner-blue';
  blueCorner.style.left='12px'; blueCorner.style.bottom='12px'; blueCorner.style.width='160px'; blueCorner.style.height='160px';
  blueCorner.style.position='absolute';
  board.appendChild(blueCorner);
}

function renderLudoState(state){
  const board = document.getElementById('ludoBoard');
  if(!board) return;
  [...board.querySelectorAll('.ludo-token')].forEach(t=>t.remove());
  const order = state.order || [];
  const size = 520, center = size/2;
  const tokenColors = ['#ff4d6d','#44d1a7','#ffd24d','#63b9ff'];
  order.forEach((sid, pidx) => {
    const tokens = state.tokens[sid] || [];
    tokens.forEach((tok, ti) => {
      const tokenEl = document.createElement('div');
      tokenEl.className = 'ludo-token';
      tokenEl.style.background = tokenColors[pidx % tokenColors.length];
      tokenEl.textContent = (ti+1);
      tokenEl.dataset.sid = sid; tokenEl.dataset.ti = ti;
      if(tok.steps === -1){
        let left, top;
        if(pidx === 0){ left = 20 + ti*34; top = 20; }
        else if(pidx === 1){ left = 520-20-34 - ti*34; top = 20; }
        else if(pidx === 2){ left = 520-20-34 - ti*34; top = 520-20-34; }
        else { left = 20 + ti*34; top = 520-20-34; }
        tokenEl.style.position='absolute'; tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`;
      } else if(tok.steps === 999){
        const left = center - 60 + (pidx*30) + (ti*8);
        const top = center - 16;
        tokenEl.style.position='absolute'; tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`;
      } else {
        let start = START_IDX[pidx % 4];
        if(tok.steps < 52){
          const boardIdx = (start + tok.steps) % 52;
          const cell = board.querySelector(`.ludo-cell[data-index="${boardIdx}"]`);
          if(cell){
            tokenEl.style.position='absolute';
            const left = parseFloat(cell.style.left || cell.offsetLeft) + 6;
            const top = parseFloat(cell.style.top || cell.offsetTop) + 6;
            tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`;
          } else {
            tokenEl.style.position='absolute'; tokenEl.style.left = `${center}px`; tokenEl.style.top = `${center}px`;
          }
        } else {
          const left = center + (pidx-1.5)*28 + ti*6;
          const top = center;
          tokenEl.style.position='absolute'; tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`;
        }
      }

      const curSid = state.order[state.turnIndex];
      if(sid === curSid && sid === mySid){
        tokenEl.style.cursor = 'pointer';
        tokenEl.addEventListener('click', ()=> {
          socket.emit('move_token',{room,tokenIndex:ti});
        });
      } else {
        tokenEl.style.cursor = 'default';
      }
      board.appendChild(tokenEl);
    });
  });

  const curSid = state.order[state.turnIndex];
  const curIdx = state.order.indexOf(curSid);
  const existingLabel = board.querySelector('.turn-label');
  if(existingLabel) existingLabel.remove();
  const lbl = document.createElement('div');
  lbl.className = 'turn-label';
  lbl.style.position='absolute'; lbl.style.right='12px'; lbl.style.bottom='12px';
  lbl.style.background='#fff'; lbl.style.padding='6px 10px'; lbl.style.borderRadius='8px';
  lbl.style.boxShadow='0 6px 18px rgba(0,0,0,0.06)';
  lbl.textContent = `Turn: Player ${curIdx+1}${curSid === mySid ? ' (You)' : ''}`;
  board.appendChild(lbl);

  rollBtn.disabled = (curSid !== mySid);
  if(state.last_dice !== null && state.last_dice !== undefined) diceVal.textContent = state.last_dice; else diceVal.textContent = '—';
}

/* ---------------- CHESS UI & highlighting ---------------- */

function buildChessBoard(){
  const wrap = document.createElement('div');
  wrap.className = 'chess-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Chess — Classic Wood</h3>
      <div id="chessBoard" style="width:520px;height:520px;margin:0 auto;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border-radius:8px;overflow:hidden"></div>
    </div>`;
  gameContainer.appendChild(wrap);
}
let selectedSquare = null;
function renderChessState(state){
  const board = document.getElementById('chessBoard');
  if(!board) return;
  board.innerHTML = '';
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const sq = document.createElement('div');
      const isLight = (r+c)%2===0;
      sq.style.background = isLight? '#f7ecd6':'#b88856';
      sq.style.width='100%'; sq.style.height='100%'; sq.style.display='flex';
      sq.style.alignItems='center'; sq.style.justifyContent='center';
      sq.style.fontSize='22px'; sq.style.cursor='pointer'; sq.style.userSelect='none';
      sq.dataset.r = r; sq.dataset.c = c;
      const piece = state.board?.[r]?.[c] || '';
      sq.textContent = piece ? prettyPiece(piece) : '';
      sq.addEventListener('click', ()=> {
        if(!selectedSquare){
          if(!piece) return;
          if(piece[0] !== (state.color_of ? state.color_of[mySid] : myColor)) return;
          const moves = computePossibleMoves(state, r, c);
          highlightMoves(moves);
          sq.style.boxShadow = '0 0 0 4px rgba(255,77,145,0.12)';
          selectedSquare = {r,c};
        } else {
          socket.emit('chess_move',{room,from:selectedSquare,to:{r,c}});
          clearChessSelection();
        }
      });
      board.appendChild(sq);
    }
  }
}
function clearChessSelection(){
  selectedSquare = null;
  const board = document.getElementById('chessBoard'); if(!board) return;
  [...board.children].forEach(ch=>{ ch.style.boxShadow='none'; ch.style.outline=''; });
}
function highlightMoves(moves){
  const board = document.getElementById('chessBoard'); if(!board) return;
  moves.forEach(m=>{
    const idx = m.r*8 + m.c; const cell = board.children[idx];
    if(cell) cell.style.outline = '3px solid rgba(255,77,145,0.22)';
  });
}
function prettyPiece(p){
  const map = {P:'♟',R:'♜',N:'♞',B:'♝',Q:'♛',K:'♚'};
  return map[p[1]] || '?';
}
function computePossibleMoves(state,r1,c1){
  const brd = state.board; const piece = brd[r1][c1]; if(!piece) return [];
  const color = piece[0], ptype = piece[1];
  const moves = [];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const dr = r-r1, dc = c-c1; const target = brd[r][c];
      if(target && target[0] === color) continue;
      let legal = false;
      if(ptype === 'P'){
        const dir = color === 'w' ? -1 : 1;
        if(dc === 0 && dr === dir && !target) legal = true;
        if(Math.abs(dc)===1 && dr === dir && target && target[0] !== color) legal = true;
      } else if(ptype === 'N'){
        if((Math.abs(dr)==2 && Math.abs(dc)==1) || (Math.abs(dr)==1 && Math.abs(dc)==2)) legal=true;
      } else if(ptype === 'B'){
        if(Math.abs(dr)==Math.abs(dc) && client_clear_path(brd,r1,c1,r,c)) legal=true;
      } else if(ptype === 'R'){
        if((dr==0 || dc==0) && client_clear_path(brd,r1,c1,r,c)) legal=true;
      } else if(ptype === 'Q'){
        if((Math.abs(dr)==Math.abs(dc) || dr==0 || dc==0) && client_clear_path(brd,r1,c1,r,c)) legal=true;
      } else if(ptype === 'K'){
        if(Math.max(Math.abs(dr),Math.abs(dc))==1) legal=true;
      }
      if(legal) moves.push({r,c});
    }
  }
  return moves;
}
function client_clear_path(brd,r1,c1,r2,c2){
  const dr=r2-r1, dc=c2-c1, steps = Math.max(Math.abs(dr),Math.abs(dc));
  if(steps===0) return true;
  const step_r = dr/steps, step_c = dc/steps;
  for(let s=1;s<steps;s++){
    const rr = Math.round(r1 + step_r*s), cc = Math.round(c1 + step_c*s);
    if(brd[rr][cc]) return false;
  }
  return true;
}

/* ---------- Winner secret reveal modal (floating hearts) ---------- */
function showSecretReveal(secret){
  const modal = document.createElement('div');
  modal.className = 'reveal-modal';
  modal.innerHTML = `
    <div class="hearts">
      <div class="heart">💖</div><div class="heart">💗</div><div class="heart">💕</div>
    </div>
    <h2>Congratulations 🎉</h2>
    <p style="margin:8px 0 14px">Here's the secret only for the winner:</p>
    <div style="padding:12px 18px;border-radius:10px;background:linear-gradient(90deg,#fff7fb,#fff0f8);font-weight:600">${escapeHtml(secret)}</div>
    <div style="margin-top:14px"><button id="closeReveal" class="btn">Close</button></div>
  `;
  document.body.appendChild(modal);
  document.getElementById('closeReveal').onclick = () => { modal.remove(); };
  setTimeout(()=> { if(modal) modal.remove(); }, 22000);
}

function handleGameOver(d){
  alert((d.winnerName || 'Winner') + ' won!');
}

function escapeHtml(s){
  if(!s) return '';
  return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

// initial
showLobby();
