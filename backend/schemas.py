from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    username: str
    max_level: int
    wins: int
    draws: int
    losses: int

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class MatchCreate(BaseModel):
    ai_level: int
    result: str
    pgn: str = ""


class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    max_level: int
    wins: int
    draws: int
    losses: int


# ---- PvP / 房间相关 ----
class RoomCreate(BaseModel):
    game_type: str = "ai"  # 'ai' or 'pvp'
    ai_level: int = 1


class RoomCreateResponse(BaseModel):
    room_code: str
    player_side: str  # 'w' or 'b'
    share_url: str


class RoomJoinResponse(BaseModel):
    room_code: str
    player_side: str
    share_url: str
    is_spectator: bool = False


class MoveRequest(BaseModel):
    from_r: int
    from_c: int
    to_r: int
    to_c: int
    fen: str = ""


class MoveResponse(BaseModel):
    success: bool
    move_number: int


class PollResponse(BaseModel):
    moves: list
    status: str
    result: str | None = None
    current_fen: str = ""


class RoomState(BaseModel):
    room_code: str
    game_type: str
    status: str
    result: str | None = None
    current_fen: str = ""
    move_count: int = 0


class BattleStats(BaseModel):
    daily_wins: int = 0
    daily_losses: int = 0
    daily_draws: int = 0
    total_wins: int = 0
    total_losses: int = 0
    total_draws: int = 0
