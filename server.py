import random
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import string

app = Flask(__name__, static_folder=".", static_url_path="")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Memory storage
rooms = {}  # code → {players:[], secrets:{}, game:"ludo/chess", state:{}}


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


def generate_room_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ---------------------- LOBBY EVENTS --------------------------- #
@socketio.on("create_room")
def create_room(data):
    name = data.get("name")
    game = data.get("game")
    secret = data.get("secret")

    code = generate_room_code()

    rooms[code] = {
        "players": [name],
        "secrets": {name: secret},
        "game": game,
        "state": {"started": False}
    }

    join_room(code)

    emit("room_created", {
        "code": code,
        "players": rooms[code]["players"],
        "game": game
    }, room=code)


@socketio.on("join_room")
def join_room_event(data):
    code = data.get("code")
    name = data.get("name")
    secret = data.get("secret")

    if code not in rooms:
        emit("error", {"msg": "Room doesn't exist"})
        return

    if len(rooms[code]["players"]) >= 2:
        emit("error", {"msg": "Room full"})
        return

    rooms[code]["players"].append(name)
    rooms[code]["secrets"][name] = secret

    join_room(code)

    emit("room_joined", {
        "code": code,
        "players": rooms[code]["players"],
        "game": rooms[code]["game"]
    }, room=code)


@socketio.on("leave_room")
def leave_room_event(data):
    code = data.get("code")
    name = data.get("name")

    if code in rooms:
        if name in rooms[code]["players"]:
            rooms[code]["players"].remove(name)

        if len(rooms[code]["players"]) == 0:
            del rooms[code]

    leave_room(code)

    emit("player_left", {"player": name}, room=code)


# ---------------------- START GAME --------------------------- #
@socketio.on("start_game")
def start_game(data):
    code = data.get("code")

    if code not in rooms:
        return

    if len(rooms[code]["players"]) < 2:
        return

    rooms[code]["state"] = {
        "started": True,
        "turn": rooms[code]["players"][0],   # first player
        "board": {},                         # game board state (chess / ludo)
        "winner": None
    }

    emit("game_started", {
        "turn": rooms[code]["state"]["turn"],
        "game": rooms[code]["game"]
    }, room=code)


# ---------------------- LUDO LOGIC --------------------------- #
@socketio.on("roll_dice")
def roll_dice(data):
    code = data.get("room")
    player = data.get("player")

    if code not in rooms:
        return

    state = rooms[code].get("state")
    if not state:
        return

    if state["turn"] != player:
        return

    value = random.randint(1, 6)

    emit("dice_result", {"value": value, "player": player}, room=code)


@socketio.on("move_token")
def move_token(data):
    code = data.get("room")
    player = data.get("player")
    token = data.get("token")
    steps = data.get("steps")

    if code not in rooms:
        return

    state = rooms[code].get("state")
    if not state:
        return

    if state["turn"] != player:
        return

    # Dummy movement - real movement can be added later
    emit("token_moved", {
        "player": player,
        "token": token,
        "steps": steps
    }, room=code)

    players = rooms[code]["players"]
    idx = players.index(player)
    state["turn"] = players[(idx + 1) % len(players)]

    emit("turn_changed", {"turn": state["turn"]}, room=code)


# ---------------------- CHESS LOGIC --------------------------- #
@socketio.on("chess_move")
def chess_move(data):
    code = data.get("room")
    move = data.get("move")
    player = data.get("player")

    if code not in rooms:
        return

    state = rooms[code].get("state")
    if not state:
        return

    if state["turn"] != player:
        return

    emit("chess_moved", move, room=code)

    players = rooms[code]["players"]
    idx = players.index(player)
    state["turn"] = players[(idx + 1) % len(players)]

    emit("turn_changed", {"turn": state["turn"]}, room=code)


@socketio.on("resign")
def resign(data):
    code = data.get("room")
    player = data.get("player")

    if code not in rooms:
        return

    players = rooms[code]["players"]
    winner = players[1] if players[0] == player else players[0]

    rooms[code]["state"]["winner"] = winner

    emit("game_over", {
        "winner": winner,
        "secret": rooms[code]["secrets"].get(winner, "")
    }, room=code)


# ---------------------- SERVER START --------------------------- #
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)
