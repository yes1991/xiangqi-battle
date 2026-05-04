from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List
import random
import string
import os
import models
import schemas
import database
import auth

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/register", response_model=schemas.Token)
def register(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="用户名已存在")
    hashed_pw = auth.get_password_hash(user.password)
    new_user = models.User(
        username=user.username,
        hashed_password=hashed_pw,
        max_level=1,
        wins=0,
        draws=0,
        losses=0,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    access_token = auth.create_access_token(data={"sub": new_user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": new_user,
    }


@app.post("/api/login", response_model=schemas.Token)
def login(user: schemas.UserLogin, db: Session = Depends(database.get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if not db_user or not auth.verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="用户名或密码错误")
    access_token = auth.create_access_token(data={"sub": db_user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": db_user,
    }


@app.get("/api/me", response_model=schemas.UserOut)
def read_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@app.get("/api/leaderboard", response_model=List[schemas.LeaderboardEntry])
def leaderboard(db: Session = Depends(database.get_db)):
    users = (
        db.query(models.User)
        .order_by(
            models.User.max_level.desc(),
            models.User.wins.desc(),
            models.User.draws.desc(),
            models.User.losses.asc(),
        )
        .limit(5)
        .all()
    )
    result = []
    for i, u in enumerate(users, start=1):
        result.append(
            schemas.LeaderboardEntry(
                rank=i,
                username=u.username,
                max_level=u.max_level,
                wins=u.wins,
                draws=u.draws,
                losses=u.losses,
            )
        )
    return result


@app.post("/api/match")
def record_match(
    match: schemas.MatchCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(database.get_db),
):
    new_match = models.Match(
        username=current_user.username,
        ai_level=match.ai_level,
        result=match.result,
        pgn=match.pgn,
    )
    db.add(new_match)

    user = current_user
    if match.result == "win":
        user.wins += 1
        if user.max_level < 10:
            user.max_level += 1
    elif match.result == "draw":
        user.draws += 1
    else:
        user.losses += 1

    db.commit()
    db.refresh(user)
    return {"ok": True, "user": user}


# ---- 房间系统（人人对战 + 观战） ----

INITIAL_FEN = "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1"
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8001")


def _gen_room_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _get_user_id(request):
    """尝试获取当前用户ID，失败返回 None（匿名也可用）"""
    try:
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if not token:
            return None
        from jose import jwt as jose_jwt
        payload = jose_jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
        db = next(database.get_db())
        user = db.query(models.User).filter(models.User.username == username).first()
        return user.id if user else None
    except Exception:
        return None


@app.post("/api/room/create", response_model=schemas.RoomCreateResponse)
def create_room(
    req: schemas.RoomCreate,
    db: Session = Depends(database.get_db),
):
    code = _gen_room_code()
    # 确保房间码唯一
    while db.query(models.GameRoom).filter(models.GameRoom.room_code == code).first():
        code = _gen_room_code()

    room = models.GameRoom(
        room_code=code,
        game_type=req.game_type,
        ai_level=req.ai_level,
        current_fen=INITIAL_FEN,
        status="playing" if req.game_type == "ai" else "waiting",
    )
    db.add(room)
    db.commit()
    db.refresh(room)

    return schemas.RoomCreateResponse(
        room_code=code,
        player_side="w",
        share_url=f"{BASE_URL}/?room={code}",
    )


@app.post("/api/room/join/{room_code}", response_model=schemas.RoomJoinResponse)
def join_room(
    room_code: str,
    db: Session = Depends(database.get_db),
):
    room = db.query(models.GameRoom).filter(models.GameRoom.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")

    is_spectator = False

    if room.game_type == "ai":
        # AI房间：任何人都只能观战
        is_spectator = True
    elif room.status == "waiting":
        # PvP 等待中：加入成为黑方
        room.status = "playing"
        db.commit()
    else:
        # PvP 已满或已结束：观战
        is_spectator = True

    return schemas.RoomJoinResponse(
        room_code=room.room_code,
        player_side="b",
        share_url=f"{BASE_URL}/?room={room.room_code}",
        is_spectator=is_spectator,
    )


@app.get("/api/room/{room_code}/state", response_model=schemas.RoomState)
def get_room_state(
    room_code: str,
    db: Session = Depends(database.get_db),
):
    room = db.query(models.GameRoom).filter(models.GameRoom.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")

    return schemas.RoomState(
        room_code=room.room_code,
        game_type=room.game_type,
        status=room.status,
        result=room.result,
        current_fen=room.current_fen,
        move_count=room.move_count,
    )


@app.post("/api/room/{room_code}/move", response_model=schemas.MoveResponse)
def make_room_move(
    room_code: str,
    move: schemas.MoveRequest,
    db: Session = Depends(database.get_db),
):
    room = db.query(models.GameRoom).filter(models.GameRoom.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    if room.status != "playing":
        raise HTTPException(status_code=400, detail="房间不在对局中")

    room.move_count += 1
    room.current_fen = move.fen or room.current_fen

    m = models.RoomMove(
        room_id=room.id,
        side=room.move_count % 2 == 1 and "w" or "b",  # 奇数步红方，偶数步黑方
        from_r=move.from_r,
        from_c=move.from_c,
        to_r=move.to_r,
        to_c=move.to_c,
        move_number=room.move_count,
        fen_after=room.current_fen,
    )
    db.add(m)
    db.commit()

    return schemas.MoveResponse(success=True, move_number=room.move_count)


@app.get("/api/room/{room_code}/poll", response_model=schemas.PollResponse)
def poll_room(
    room_code: str,
    since: int = 0,
    db: Session = Depends(database.get_db),
):
    room = db.query(models.GameRoom).filter(models.GameRoom.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")

    moves = (
        db.query(models.RoomMove)
        .filter(models.RoomMove.room_id == room.id, models.RoomMove.move_number > since)
        .order_by(models.RoomMove.move_number)
        .all()
    )

    return schemas.PollResponse(
        moves=[
            {
                "side": m.side,
                "fromR": m.from_r,
                "fromC": m.from_c,
                "toR": m.to_r,
                "toC": m.to_c,
                "moveNumber": m.move_number,
                "fen": m.fen_after,
            }
            for m in moves
        ],
        status=room.status,
        result=room.result,
        current_fen=room.current_fen,
    )


@app.post("/api/room/{room_code}/finish")
def finish_room(
    room_code: str,
    result: str = "w",
    db: Session = Depends(database.get_db),
):
    """result: 'w'=红胜, 'b'=黑胜, 'draw'=和棋"""
    room = db.query(models.GameRoom).filter(models.GameRoom.room_code == room_code.upper()).first()
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    if room.status == "finished":
        return {"ok": True}

    room.status = "finished"
    room.result = result
    db.commit()
    return {"ok": True}


# ---- 战绩统计 ----

@app.get("/api/battles/stats", response_model=schemas.BattleStats)
def battle_stats(
    username: str | None = None,
    db: Session = Depends(database.get_db),
):
    from datetime import date, datetime
    today = date.today()
    today_start = datetime(today.year, today.month, today.day)

    base_q = db.query(models.GameRoom).filter(models.GameRoom.status == "finished")

    daily_q = base_q.filter(models.GameRoom.created_at >= today_start)
    today_rooms = daily_q.all()
    all_rooms = base_q.all()

    return schemas.BattleStats(
        daily_wins=sum(1 for r in today_rooms if r.result == "w"),
        daily_losses=sum(1 for r in today_rooms if r.result == "b"),
        daily_draws=sum(1 for r in today_rooms if r.result == "draw"),
        total_wins=sum(1 for r in all_rooms if r.result == "w"),
        total_losses=sum(1 for r in all_rooms if r.result == "b"),
        total_draws=sum(1 for r in all_rooms if r.result == "draw"),
    )


# ---- 静态文件托管（前端） ----
from fastapi.responses import FileResponse

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..")

app.mount("/css", StaticFiles(directory=os.path.join(STATIC_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(STATIC_DIR, "js")), name="js")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/test-engine.html")
def serve_test_engine():
    return FileResponse(os.path.join(STATIC_DIR, "test-engine.html"))
