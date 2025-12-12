/* app.js - frontend for classic online Ludo + Chess
   - Single-file: lobby, ludo, chess, socket events
   - Real-ludo visuals, turn enforcement, safe squares, capture, finish
*/

const socket = io();

// UI elements
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

// small helper for hidden Palak name if input empty
const hiddenB64 = 'UGFsYWsgUGFuZGV5';
function decodeHidden(){ try{ return atob(hiddenB64); }catch(e){return 'Friend';} }

// show/hide
function showLobby(){ lobby.style.display='block'; gameArea.style.display='none'; }
function showGame(){ lobby.style.display='none'; gameArea.style.display='block'; }

// Lobby actions
createBtn.addEventListener('click', ()=>{
  const name = nameInput.value.trim() || decodeHidden();
  gameType = gameSelect.value;
  socket.emit('create_room',{name,game:gameType});
});
joinBtn.addEventListener('click', ()=>{
  const name = nameInput.value.trim() || decodeHidden();
  const code = joinCode.value.trim().toUpperCase();
  if(!code){ alert('Enter room code'); return; }
  socket.emit('join_room',{name,code});
});
saveSecretBtn.addEventListener('click', ()=>{
  const s = (secretInput.value||'').trim();
  if(!s) return alert('Type a secret then click Save');
  socket.emit('set_secret',{room,secret:s});
  meSetSecret = true;
  readyHint.textContent = 'Secret saved locally (server confirms).';
});
startBtn.addEventListener('click', ()=>{
  const s = (secretInput.value||'').trim();
  if(s && !meSetSecret) socket.emit('set_secret',{room,secret:s});
  socket.emit('start_game',{room});
});
leaveBtn.addEventListener('click', ()=>{
  socket.emit('leave_room',{room});
  resetLobby();
});
backLobbyBtn.addEventListener('click', ()=>{
  socket.emit('leave_room',{room});
  resetLobby();
});
rollBtn.addEventListener('click', ()=>{
  socket.emit('roll_dice',{room});
  // UI will be updated after dice_result
});
resignBtn.addEventListener('click', ()=>{
  if(confirm('Resign?')) socket.emit('resign',{room});
});

// socket events
socket.on('connect', ()=>{ mySid = socket.id; console.log('connected',mySid); });
socket.on('room_created', data=>{
  room = data.code; amHost=true; gameType=data.game;
  roomCodeSpan.textContent=room; roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display='block';
  setPlayersDisplay(data.players); showLobby();
});
socket.on('room_joined', data=>{
  room = data.code; amHost=false; gameType=data.game;
  roomCodeSpan.textContent=room; roomCodeTop.textContent = `Room: ${room} • ${gameType.toUpperCase()}`;
  roomBox.style.display='block';
  setPlayersDisplay(data.players); showLobby();
});
socket.on('players_update', data=>{
  setPlayersDisplay(data.players);
  opponentSetSecret = data.players.some(p=>p.sid !== mySid && p.secretSet);
  meSetSecret = data.players.some(p=>p.sid === mySid && p.secretSet);
  readyHint.textContent = !meSetSecret ? 'Set your secret message' : (!opponentSetSecret ? 'Waiting for other player' : 'Both set - host can start');
  startBtn.disabled = !(amHost && data.players.length===2 && data.players.every(p=>p.secretSet));
});
socket.on('start_ack', data=>{
  gameType = data.game || gameType;
  // if chess, map color
  if(gameType === 'chess' && data.state && data.state.color_of){
    myColor = data.state.color_of[mySid] || null;
  }
  buildGameUI(gameType, data.state, data.players);
  showGame();
});
socket.on('state_update', data=>{
  if(!data) return;
  if(gameType === 'ludo') renderLudoState(data.state);
  else renderChessState(data.state);
});
socket.on('dice_result', data=>{
  diceVal.textContent = data.val;
});
socket.on('not_your_turn', d=>{ alert(d.msg || 'Not your turn'); });
socket.on('no_dice', d=>{ alert(d.msg || 'Roll the dice first'); });
socket.on('invalid_move', d=>{ alert(d.msg || 'Invalid move'); });
socket.on('illegal_move', d=>{ alert(d.msg || 'Illegal move'); });
socket.on('game_over', d=>{ alert((d.winnerName||'Someone') + ' won!'); });
socket.on('reveal_secret', d=>{ alert('Secret for winner:\n\n' + (d.secret||'')); });
socket.on('left_room', ()=>{ resetLobby(); });

// helpers
function setPlayersDisplay(players){
  playersList.textContent = players.map(p=>p.name + (p.secretSet? ' ✅':'')).join(' | ');
  playerA.textContent = players[0]? players[0].name:'—';
  playerB.textContent = players[1]? players[1].name:'—';
}
function resetLobby(){
  room=null; amHost=false; meSetSecret=false; opponentSetSecret=false; myColor=null;
  roomBox.style.display='none'; startBtn.disabled=true;
  showLobby();
  gameContainer.innerHTML=''; diceArea.style.display='none'; chessControls.style.display='none';
}

// -- Build game UI
function buildGameUI(type, state, players){
  gameContainer.innerHTML=''; diceArea.style.display='none'; chessControls.style.display='none';
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

/* ===================== LUDO UI & Logic (client-side rendering + interactions) ===================== */

const START_IDX = [0,13,26,39]; // same as server
const SAFE_SQUARES = new Set([0,8,13,21,26,34,39,47]);

function buildLudoBoard(){
  const wrap = document.createElement('div');
  wrap.className = 'ludo-board';
  wrap.id = 'ludoBoard';
  gameContainer.appendChild(wrap);

  // We'll create 52 ring cells positioned manually (circle layout)
  const board = document.getElementById('ludoBoard');
  const size = 520, center=size/2, r=190;
  // central cross (home paths) - we'll keep center simple graphic
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
    cell.style.background = SAFE_SQUARES.has(i)? '#fff3f6' : '#ffffff';
    board.appendChild(cell);
  }

  // four corners: home areas (we make visual big squares)
  // Red top-left
  const redCorner = document.createElement('div'); redCorner.className='ludo-cell corner-red';
  redCorner.style.left='12px'; redCorner.style.top='12px'; redCorner.style.width='160px'; redCorner.style.height='160px';
  board.appendChild(redCorner);
  // Green top-right
  const greenCorner = document.createElement('div'); greenCorner.className='ludo-cell corner-green';
  greenCorner.style.right='12px'; greenCorner.style.top='12px'; greenCorner.style.width='160px'; greenCorner.style.height='160px';
  greenCorner.style.position='absolute';
  board.appendChild(greenCorner);
  // Yellow bottom-right
  const yellowCorner = document.createElement('div'); yellowCorner.className='ludo-cell corner-yellow';
  yellowCorner.style.right='12px'; yellowCorner.style.bottom='12px'; yellowCorner.style.width='160px'; yellowCorner.style.height='160px';
  yellowCorner.style.position='absolute';
  board.appendChild(yellowCorner);
  // Blue bottom-left
  const blueCorner = document.createElement('div'); blueCorner.className='ludo-cell corner-blue';
  blueCorner.style.left='12px'; blueCorner.style.bottom='12px'; blueCorner.style.width='160px'; blueCorner.style.height='160px';
  blueCorner.style.position='absolute';
  board.appendChild(blueCorner);
}

function renderLudoState(state){
  const board = document.getElementById('ludoBoard');
  if(!board) return;
  // clear tokens first
  [...board.querySelectorAll('.ludo-token')].forEach(t=>t.remove());
  // draw tokens from state.tokens
  const order = state.order || [];
  const size = 520, center=size/2, r=190;
  const cellEls = Array.from(board.querySelectorAll('.ludo-cell[data-index]'));
  const tokenColors = ['#ff4d6d','#44d1a7','#ffd24d','#63b9ff']; // red, green, yellow (warm), blue
  order.forEach((sid, pidx) => {
    const tokens = state.tokens[sid] || [];
    tokens.forEach((tok, ti)=>{
      const tokenEl = document.createElement('div');
      tokenEl.className = 'ludo-token';
      tokenEl.style.background = tokenColors[pidx % tokenColors.length];
      tokenEl.textContent = (ti+1);
      tokenEl.dataset.sid = sid;
      tokenEl.dataset.ti = ti;
      // position token
      if(tok.steps === -1){
        // home area - place near a corner based on pidx
        let left, top;
        if(pidx === 0){ left = 20 + ti*34; top = 20; }
        else if(pidx === 1){ left = 520-20-34 - ti*34; top = 20; }
        else if(pidx === 2){ left = 520-20-34 - ti*34; top = 520-20-34; }
        else { left = 20 + ti*34; top = 520-20-34; }
        tokenEl.style.position='absolute'; tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`;
      } else if(tok.steps === 999){
        // finished area near center but distinct
        const left = center - 60 + (pidx*30) + (ti*8);
        const top = center - 16;
        tokenEl.style.position='absolute'; tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`; tokenEl.style.opacity='0.9';
      } else {
        // on board: compute board index
        let start = START_IDX[pidx % 4];
        if(tok.steps < 52){
          const boardIdx = (start + tok.steps) % 52;
          const cell = board.querySelector(`.ludo-cell[data-index="${boardIdx}"]`);
          if(cell){
            tokenEl.style.position='absolute';
            // small offset so token is centered inside cell
            const left = parseFloat(cell.style.left || cell.offsetLeft) + 6;
            const top = parseFloat(cell.style.top || cell.offsetTop) + 6;
            tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`;
          } else {
            tokenEl.style.position='absolute'; tokenEl.style.left = `${center}px`; tokenEl.style.top = `${center}px`;
          }
        } else {
          // home-stretch: place near center offset
          const left = center + (pidx-1.5)*28 + ti*6;
          const top = center;
          tokenEl.style.position='absolute'; tokenEl.style.left = `${left}px`; tokenEl.style.top = `${top}px`;
        }
      }

      // clickable only if token belongs to current player AND it's their turn AND last_dice exists
      const curSid = state.order[state.turnIndex];
      if(sid === curSid && sid === mySid){
        tokenEl.style.cursor = 'pointer';
        tokenEl.addEventListener('click', ()=>{
          // send move request
          socket.emit('move_token',{room,tokenIndex:ti});
        });
      } else {
        tokenEl.style.cursor = 'default';
      }

      board.appendChild(tokenEl);
    });
  });

  // indicate current player in UI and control dice button
  const curSid = state.order[state.turnIndex];
  const curIdx = state.order.indexOf(curSid);
  // show small label on board
  const existingLabel = board.querySelector('.turn-label');
  if(existingLabel) existingLabel.remove();
  const lbl = document.createElement('div');
  lbl.className = 'turn-label';
  lbl.style.position='absolute'; lbl.style.right='12px'; lbl.style.bottom='12px';
  lbl.style.background='#fff'; lbl.style.padding='6px 10px'; lbl.style.borderRadius='8px';
  lbl.style.boxShadow='0 6px 18px rgba(0,0,0,0.06)';
  lbl.textContent = `Turn: Player ${curIdx+1}${curSid === mySid ? ' (You)' : ''}`;
  board.appendChild(lbl);

  // enable roll only if it's our turn
  rollBtn.disabled = (curSid !== mySid);
  // show last dice if any
  if(state.last_dice !== null && state.last_dice !== undefined) diceVal.textContent = state.last_dice; else diceVal.textContent = '—';
}

/* ===================== CHESS UI (kept as earlier) ===================== */

function buildChessBoard(){
  const wrap = document.createElement('div');
  wrap.className = 'chess-wrap';
  wrap.innerHTML = `
    <div style="text-align:center">
      <h3 style="font-family:'Great Vibes',cursive">Chess — Turn Based</h3>
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
      sq.style.background = isLight? '#f6eefa':'#bfa9c0';
      sq.style.width='100%'; sq.style.height='100%'; sq.style.display='flex';
      sq.style.alignItems='center'; sq.style.justifyContent='center';
      sq.style.fontSize='22px'; sq.style.cursor='pointer'; sq.style.userSelect='none';
      sq.dataset.r = r; sq.dataset.c = c;
      const piece = state.board?.[r]?.[c] || '';
      sq.textContent = piece ? prettyPiece(piece) : '';
      sq.addEventListener('click', ()=>{
        if(!selectedSquare){
          if(!piece) return;
          if(piece[0] !== (state.color_of ? state.color_of[mySid] : myColor)) return;
          const moves = computePossibleMoves(state, r, c);
          highlightMoves(moves);
          sq.style.boxShadow = '0 0 0 3px rgba(255,105,180,0.15)';
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
    if(cell) cell.style.outline = '3px solid rgba(255,105,180,0.25)';
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

// initial
showLobby();
