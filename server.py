# server.py
import eventlet
eventlet.monkey_patch()

from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import random, string

app = Flask(__name__, static_folder='.', static_url_path='')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

rooms = {}  # code -> {players:[{sid,name,secret,secretSet}], game, state, host}

def gen_code(n=6):
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choice(chars) for _ in range(n))

# --- Ludo config (classic) ---
MAIN_LEN = 52
HOME_LEN = 6   # steps to finish in home column
TOTAL_STEPS = MAIN_LEN + HOME_LEN  # 58

START_IDX = [0, 13, 26, 39]  # starting squares on main ring (classic spacing)
# Safe squares on main board (commonly including start squares and a few others)
SAFE_SQUARES = set([0, 8, 13, 21, 26, 34, 39, 47])

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

# --- helpers for ludo state ---
def init_ludo_state(code):
    players = rooms[code]['players']
    order = [p['sid'] for p in players]
    state = {
        'tokens': {},   # sid -> list of 4 dicts {'steps': -1 (home), 0..MAIN_LEN-1 on main ring, MAIN_LEN..MAIN_LEN+HOME_LEN-1 home stretch, 999 finished}
        'order': order,
        'turnIndex': 0,
        'last_dice': None,
        'last_roller': None
    }
    for p in players:
        state['tokens'][p['sid']] = [{'steps': -1} for _ in range(4)]
    return state

def steps_to_board_index(start_idx, steps):
    # map steps < MAIN_LEN to actual index on ring
    if 0 <= steps < MAIN_LEN:
        return (start_idx + steps) % MAIN_LEN
    return None

def move_token(state, sid, token_index, dice):
    tokens = state['tokens'].get(sid)
    if tokens is None: return False
    t = tokens[token_index]
    if t['steps'] == 999:  # finished
        return False
    if t['steps'] < 0:
        if dice == 6:
            t['steps'] = 0
            return True
        else:
            return False
    else:
        t['steps'] += dice
        if t['steps'] >= TOTAL_STEPS:
            t['steps'] = 999  # finished
        else:
            # capture logic only on main ring part
            player_idx = state['order'].index(sid)
            start = START_IDX[player_idx % 4]
            board_index = steps_to_board_index(start, t['steps'])
            if board_index is not None:
                # send any opponent on same board_index home unless it's a safe square
                if board_index not in SAFE_SQUARES:
                    for other_sid, oth_tokens in state['tokens'].items():
                        if other_sid == sid: continue
                        for ot in oth_tokens:
                            if 0 <= ot['steps'] < MAIN_LEN:
                                other_player_idx = state['order'].index(other_sid)
                                other_start = START_IDX[other_player_idx % 4]
                                other_board = steps_to_board_index(other_start, ot['steps'])
                                if other_board == board_index:
                                    ot['steps'] = -1
        return True

def check_ludo_winner(state):
    for sid, toks in state['tokens'].items():
        if all(t['steps'] == 999 for t in toks):
            return sid
    return None

# --- Chess helpers (simple move validation same as earlier) ---
def init_chess_state(code):
    board = [['' for _ in range(8)] for __ in range(8)]
    for c in range(8):
        board[1][c] = 'bP'
        board[6][c] = 'wP'
    order = ['R','N','B','Q','K','B','N','R']
    for c,p in enumerate(order):
        board[0][c] = 'b'+p
        board[7][c] = 'w'+p
    players = rooms[code]['players']
    color_of = {}
    if len(players)>=1: color_of[players[0]['sid']] = 'w'
    if len(players)>=2: color_of[players[1]['sid']] = 'b'
    return {'board':board, 'turn':'w', 'color_of':color_of}

def clear_path(brd,r1,c1,r2,c2):
    dr=r2-r1; dc=c2-c1
    steps = max(abs(dr),abs(dc))
    if steps==0: return True
    sr = dr//steps; sc = dc//steps
    for s in range(1,steps):
        if brd[r1+sr*s][c1+sc*s]:
            return False
    return True

def apply_chess_move(state, sid, frm, to, players):
    brd = state['board']
    try:
        r1,c1=int(frm['r']),int(frm['c']); r2,c2=int(to['r']),int(to['c'])
    except:
        return False, None, 'invalid'
    if not (0<=r1<8 and 0<=c1<8 and 0<=r2<8 and 0<=c2<8): return False,None,'out'
    piece = brd[r1][c1]
    if not piece: return False,None,'no piece'
    color = piece[0]; mycolor = state['color_of'].get(sid)
    if mycolor != color: return False,None,'not yours'
    if state['turn'] != color: return False,None,'not your turn'
    ptype = piece[1]; target = brd[r2][c2]
    if target and target[0]==color: return False,None,'own capture'
    dr=r2-r1; dc=c2-c1; legal=False
    if ptype=='P':
        dir = -1 if color=='w' else 1
        if dc==0 and dr==dir and not target: legal=True
        if abs(dc)==1 and dr==dir and target and target[0]!=color: legal=True
        if dc==0 and ((r1==6 and color=='w') or (r1==1 and color=='b')) and dr==2*dir and not target:
            mid=r1+dir
            if not brd[mid][c1]: legal=True
    elif ptype=='N':
        if (abs(dr)==2 and abs(dc)==1) or (abs(dr)==1 and abs(dc)==2): legal=True
    elif ptype=='B':
        if abs(dr)==abs(dc) and clear_path(brd,r1,c1,r2,c2): legal=True
    elif ptype=='R':
        if (dr==0 or dc==0) and clear_path(brd,r1,c1,r2,c2): legal=True
    elif ptype=='Q':
        if (abs(dr)==abs(dc) or dr==0 or dc==0) and clear_path(brd,r1,c1,r2,c2): legal=True
    elif ptype=='K':
        if max(abs(dr),abs(dc))==1: legal=True
    if not legal: return False,None,'illegal'
    captured = brd[r2][c2]
    brd[r2][c2] = piece; brd[r1][c1] = ''
    state['turn'] = 'b' if state['turn']=='w' else 'w'
    if captured and captured[1]=='K':
        winner = None
        for p in players:
            if state['color_of'].get(p['sid']) == piece[0]:
                winner = p['sid']
        return True, winner, None
    return True, None, None

# --- socket handlers ---
@socketio.on('create_room')
def on_create(data):
    name = data.get('name','Player'); game = data.get('game','ludo')
    code = gen_code()
    while code in rooms: code = gen_code()
    rooms[code] = {'players': [], 'game': game, 'state': None, 'host': request.sid}
    join_room(code)
    rooms[code]['players'].append({'sid':request.sid,'name':name,'secret':None,'secretSet':False})
    emit('room_created', {'code':code,'players':rooms[code]['players'],'game':game}, room=request.sid)
    emit('players_update', {'players':rooms[code]['players']}, room=code)

@socketio.on('join_room')
def on_join(data):
    code = data.get('code'); name=data.get('name','Player')
    if code not in rooms:
        emit('join_error', {'msg':'Room not found'}, room=request.sid); return
    if len(rooms[code]['players'])>=2:
        emit('join_error', {'msg':'Room full'}, room=request.sid); return
    join_room(code)
    rooms[code]['players'].append({'sid':request.sid,'name':name,'secret':None,'secretSet':False})
    emit('room_joined', {'code':code,'players':rooms[code]['players'],'game':rooms[code]['game']}, room=request.sid)
    emit('players_update', {'players':rooms[code]['players']}, room=code)

@socketio.on('set_secret')
def on_secret(data):
    code = data.get('room'); secret = data.get('secret','')
    if code not in rooms: return
    for p in rooms[code]['players']:
        if p['sid']==request.sid:
            p['secret']=secret; p['secretSet']=True
    emit('players_update', {'players':rooms[code]['players']}, room=code)

@socketio.on('start_game')
def on_start(data):
    code = data.get('room')
    if code not in rooms: emit('start_denied', {'msg':'Room not found'}, room=request.sid); return
    if rooms[code]['host'] != request.sid: emit('start_denied', {'msg':'Only host can start'}, room=request.sid); return
    if len(rooms[code]['players'])<2 or not all(p.get('secretSet') for p in rooms[code]['players']):
        emit('start_denied', {'msg':'Need 2 players and both secrets set'}, room=request.sid); return
    if rooms[code]['game']=='ludo':
        state = init_ludo_state(code)
    else:
        state = init_chess_state(code)
    rooms[code]['state']=state
    emit('start_ack', {'code':code,'state':state,'players':rooms[code]['players'],'game':rooms[code]['game']}, room=code)
    emit('state_update', {'state':state}, room=code)

@socketio.on('roll_dice')
def on_roll(data):
    code = data.get('room')
    if code not in rooms: return
    state = rooms[code].get('state'); if not state: return
    sid = request.sid
    cur_sid = state['order'][state['turnIndex']]
    if sid != cur_sid: emit('not_your_turn', {'msg':'Not your turn to roll'}, room=sid); return
    val = random.randint(1,6)
    state['last_dice'] = val; state['last_roller'] = sid
    emit('dice_result', {'val':val}, room=code)

@socketio.on('move_token')
def on_move_token(data):
    code = data.get('room'); idx = int(data.get('tokenIndex',0))
    if code not in rooms: return
    state = rooms[code].get('state'); if not state: return
    sid = request.sid
    cur_sid = state['order'][state['turnIndex']]
    if sid != cur_sid: emit('not_your_turn', {'msg':'Not your turn to move'}, room=sid); return
    ld = state.get('last_dice', None)
    if ld is None or state.get('last_roller') != sid:
        emit('no_dice', {'msg':'Roll the dice first'}, room=sid); return
    ok = move_token(state, sid, idx, ld)
    if not ok: emit('invalid_move', {'msg':'Invalid move'}, room=sid); return
    # if dice != 6 advance turn
    if ld != 6:
        state['turnIndex'] = (state['turnIndex'] + 1) % len(state['order'])
    # clear dice
    state['last_dice'] = None; state['last_roller'] = None
    rooms[code]['state'] = state
    emit('state_update', {'state':state}, room=code)
    winner = check_ludo_winner(state)
    if winner:
        pname = next((p['name'] for p in rooms[code]['players'] if p['sid']==winner),'Winner')
        emit('game_over', {'winnerSid':winner,'winnerName':pname}, room=code)
        secret = next((p['secret'] for p in rooms[code]['players'] if p['sid']==winner), '')
        emit('reveal_secret', {'secret':secret}, room=winner)

@socketio.on('chess_move')
def on_chess_move(data):
    code = data.get('room'); if code not in rooms: return
    state = rooms[code].get('state'); if not state: return
    frm = data.get('from'); to = data.get('to')
    ok, winner, err = apply_chess_move(state, request.sid, frm, to, rooms[code]['players'])
    if ok:
        rooms[code]['state'] = state
        emit('state_update', {'state':state}, room=code)
        if winner:
            pname = next((p['name'] for p in rooms[code]['players'] if p['sid']==winner),'Winner')
            emit('game_over', {'winnerSid':winner,'winnerName':pname}, room=code)
            secret = next((p['secret'] for p in rooms[code]['players'] if p['sid']==winner), '')
            emit('reveal_secret', {'secret':secret}, room=winner)
    else:
        emit('illegal_move', {'msg': err or 'Illegal move'}, room=request.sid)

@socketio.on('resign')
def on_resign(data):
    code = data.get('room'); if code not in rooms: return
    players = rooms[code]['players']; other = next((p for p in players if p['sid'] != request.sid), None)
    if other:
        emit('game_over', {'winnerSid':other['sid'],'winnerName':other['name']}, room=code)
        emit('reveal_secret', {'secret':other.get('secret','')}, room=other['sid'])

@socketio.on('leave_room')
def on_leave(data):
    code = data.get('room')
    if code and code in rooms:
        leave_room(code)
        rooms[code]['players'] = [p for p in rooms[code]['players'] if p['sid'] != request.sid]
        emit('players_update', {'players': rooms[code]['players']}, room=code)
        if not rooms[code]['players']:
            del rooms[code]
        else:
            if rooms[code].get('host') == request.sid:
                rooms[code]['host'] = rooms[code]['players'][0]['sid']
        emit('left_room', {}, room=request.sid)

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    for code, room in list(rooms.items()):
        if any(p['sid']==sid for p in room['players']):
            room['players'] = [p for p in room['players'] if p['sid'] != sid]
            emit('players_update', {'players': room['players']}, room=code)
            if not room['players']:
                del rooms[code]
            else:
                if room.get('host') == sid:
                    room['host'] = room['players'][0]['sid']

if __name__ == '__main__':
    print("Starting server on 0.0.0.0:5000")
    socketio.run(app, host='0.0.0.0', port=5000)
