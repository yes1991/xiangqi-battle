from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    max_level = Column(Integer, default=1)
    wins = Column(Integer, default=0)
    draws = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Match(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, index=True, nullable=False)
    ai_level = Column(Integer, nullable=False)
    result = Column(String, nullable=False)
    pgn = Column(String, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GameRoom(Base):
    __tablename__ = "game_rooms"

    id = Column(Integer, primary_key=True, index=True)
    room_code = Column(String(6), unique=True, index=True, nullable=False)
    game_type = Column(String(10), default="ai")  # 'ai' or 'pvp'
    ai_level = Column(Integer, default=1)
    player1_id = Column(Integer, nullable=True)   # 创建者（红方）
    player2_id = Column(Integer, nullable=True)   # 加入者（黑方）
    current_fen = Column(String, default="")
    move_count = Column(Integer, default=0)
    status = Column(String(10), default="waiting")  # waiting/playing/finished
    result = Column(String(10), nullable=True)       # w/b/draw
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RoomMove(Base):
    __tablename__ = "room_moves"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("game_rooms.id"), nullable=False)
    side = Column(String(1), nullable=False)       # 'w' or 'b'
    from_r = Column(Integer, nullable=False)
    from_c = Column(Integer, nullable=False)
    to_r = Column(Integer, nullable=False)
    to_c = Column(Integer, nullable=False)
    move_number = Column(Integer, nullable=False)
    fen_after = Column(String, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
