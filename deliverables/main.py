"""
Café Companion: VibeCraft & CounterFlow
Production FastAPI Microservice for Google Cloud Run + Cloud SQL (pgvector) + google-genai SDK
"""
import asyncio
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set
from uuid import UUID

import asyncpg
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration & GenAI Client
# ---------------------------------------------------------------------------
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-4-hydrogen")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "gemini-embedding-2")
CLOUD_SQL_DSN = os.getenv(
    "CLOUD_SQL_DSN",
    "postgresql://app_user:password@/cafe_companion?host=/cloudsql/PROJECT:REGION:INSTANCE",
)

genai_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

app = FastAPI(title="Café Companion: VibeCraft & CounterFlow API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Strict Pydantic Schemas for Gemini Structured Outputs (response_schema)
# ---------------------------------------------------------------------------
class WaitTimePrediction(BaseModel):
    estimated_seconds: int = Field(..., ge=60, le=900)
    complexity_score: float = Field(..., ge=1.0, le=5.0)
    reasoning: str
    recommended_station: str


class PalatePairing(BaseModel):
    menu_item_id: int
    item_name: str
    match_score: int = Field(..., ge=70, le=100)
    flavor_rationale: str
    suggested_modifier: str


class ConversationalPalateResponse(BaseModel):
    inferred_mood: str
    detected_dietary_limits: List[str]
    sommelier_summary: str
    pairings: List[PalatePairing]


class AmbientTriageOutput(BaseModel):
    severity: str = Field(..., pattern="^(LOW|MEDIUM|HIGH|CRITICAL)$")
    ai_category: str
    ai_corrective_action: str


class OrderLineItemIn(BaseModel):
    menu_item_id: int
    quantity: int = Field(1, ge=1, le=20)
    modifiers: str = ""


class PosOrderInjectRequest(BaseModel):
    customer_name: str
    channel: str = "COUNTER_POS"
    table_code: Optional[str] = None
    active_baristas: int = Field(2, ge=1, le=8)
    items: List[OrderLineItemIn]


class PalatePromptRequest(BaseModel):
    prompt: str
    image_base64: Optional[str] = None
    image_mime_type: Optional[str] = None


class TableConnectRequest(BaseModel):
    customer_uid: str
    display_name: str
    table_zone: str
    focus_tag: str
    focus_description: str
    open_to_connect: bool = True


class AmbientReportRequest(BaseModel):
    zone: str
    decibels: Optional[float] = None
    feedback_type: str
    raw_message: str


# ---------------------------------------------------------------------------
# Bidirectional Room-Based WebSocket Manager + Live Countdown Engine
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self) -> None:
        self.order_rooms: Dict[str, Set[WebSocket]] = {}
        self.kds_clients: Set[WebSocket] = set()
        self.active_timers: Dict[str, Dict] = {}

    async def connect_order(self, order_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.order_rooms.setdefault(order_id, set()).add(websocket)

    def disconnect_order(self, order_id: str, websocket: WebSocket) -> None:
        room = self.order_rooms.get(order_id)
        if room:
            room.discard(websocket)
            if not room:
                self.order_rooms.pop(order_id, None)

    async def connect_kds(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.kds_clients.add(websocket)

    def disconnect_kds(self, websocket: WebSocket) -> None:
        self.kds_clients.discard(websocket)

    async def broadcast_order(self, order_id: str, message: dict) -> None:
        dead: List[WebSocket] = []
        for ws in list(self.order_rooms.get(order_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_order(order_id, ws)

    async def broadcast_kds(self, message: dict) -> None:
        dead: List[WebSocket] = []
        for ws in list(self.kds_clients):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_kds(ws)

    async def run_countdown_loop(self) -> None:
        while True:
            await asyncio.sleep(1)
            for order_id, state in list(self.active_timers.items()):
                if state["status"] in ("READY_PICKUP", "COMPLETED"):
                    self.active_timers.pop(order_id, None)
                    continue
                if state["remaining_seconds"] > 0:
                    state["remaining_seconds"] -= 1
                    payload = {
                        "type": "timer:tick",
                        "order_id": order_id,
                        "status": state["status"],
                        "remaining_seconds": state["remaining_seconds"],
                        "estimated_seconds": state["estimated_seconds"],
                    }
                    await self.broadcast_order(order_id, payload)
                    await self.broadcast_kds(payload)


manager = ConnectionManager()
db_pool: Optional[asyncpg.Pool] = None


@app.on_event("startup")
async def startup_event() -> None:
    global db_pool
    db_pool = await asyncpg.create_pool(dsn=CLOUD_SQL_DSN, min_size=2, max_size=10)
    asyncio.create_task(manager.run_countdown_loop())


@app.on_event("shutdown")
async def shutdown_event() -> None:
    if db_pool:
        await db_pool.close()


# ---------------------------------------------------------------------------
# WebSocket Endpoints
# ---------------------------------------------------------------------------
@app.websocket("/ws/orders/{order_id}")
async def order_websocket(websocket: WebSocket, order_id: str) -> None:
    await manager.connect_order(order_id, websocket)
    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_order(order_id, websocket)


@app.websocket("/ws/kds")
async def kds_websocket(websocket: WebSocket) -> None:
    await manager.connect_kds(websocket)
    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_kds(websocket)


# ---------------------------------------------------------------------------
# REST Endpoints: POS Injection, Palate Discovery, Table Connect, Ambient Triage
# ---------------------------------------------------------------------------
@app.post("/api/pos/orders")
async def inject_pos_order(req: PosOrderInjectRequest):
    assert db_pool is not None
    async with db_pool.acquire() as conn:
        queue_depth = await conn.fetchval(
            "SELECT COUNT(*) FROM orders WHERE status IN ('GRINDING_EXTRACTION','STEAMING_POUR','QUALITY_PLATING')"
        )
        menu_rows = await conn.fetch(
            "SELECT id, name, price_cents, prep_complexity, base_prep_seconds FROM menu_items WHERE id = ANY($1::int[])",
            [i.menu_item_id for i in req.items],
        )
        menu_map = {row["id"]: row for row in menu_rows}
        if len(menu_map) != len({i.menu_item_id for i in req.items}):
            raise HTTPException(status_code=400, detail="One or more menu items were not found.")

        ai_resp = genai_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=(
                f"Compute prep wait time in seconds for queue_depth={queue_depth}, "
                f"baristas={req.active_baristas}, items={json.dumps([i.model_dump() for i in req.items])}."
            ),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=WaitTimePrediction,
            ),
        )
        prediction = WaitTimePrediction.model_validate_json(ai_resp.text)

        order_code = f"POS-{secrets.randbelow(9000) + 1000}"
        handoff_token = secrets.token_hex(12)
        total_cents = sum(menu_map[i.menu_item_id]["price_cents"] * i.quantity for i in req.items)

        order_row = await conn.fetchrow(
            """
            INSERT INTO orders (
                order_code, customer_name, channel, table_code, status,
                estimated_seconds, remaining_seconds, complexity_score,
                ai_wait_reasoning, total_cents, handoff_token
            )
            VALUES ($1,$2,$3,$4,'GRINDING_EXTRACTION',$5,$5,$6,$7,$8,$9)
            RETURNING id, order_code, handoff_token, status, estimated_seconds, remaining_seconds
            """,
            order_code,
            req.customer_name,
            req.channel,
            req.table_code,
            prediction.estimated_seconds,
            prediction.complexity_score,
            f"{prediction.recommended_station}: {prediction.reasoning}",
            total_cents,
            handoff_token,
        )

        order_id = str(order_row["id"])
        manager.active_timers[order_id] = {
            "status": "GRINDING_EXTRACTION",
            "estimated_seconds": prediction.estimated_seconds,
            "remaining_seconds": prediction.estimated_seconds,
        }
        await manager.broadcast_kds({"type": "order:created", "order_id": order_id, "order_code": order_code})
        return {"order": dict(order_row), "wait_prediction": prediction.model_dump()}


@app.post("/api/palate/recommend")
async def palate_recommend(req: PalatePromptRequest):
    assert db_pool is not None
    async with db_pool.acquire() as conn:
        inventory = await conn.fetch(
            "SELECT id, name, category, description, caffeine_level, acidity_level, dietary_tags, flavor_notes FROM menu_items WHERE stock_count > 0"
        )
    catalog = [dict(r) for r in inventory]
    response = genai_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=f"Patron request: {req.prompt}\nLive Cloud SQL menu: {json.dumps(catalog, default=str)}",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ConversationalPalateResponse,
        ),
    )
    return ConversationalPalateResponse.model_validate_json(response.text)


@app.post("/api/table-connect/match")
async def table_connect_vector_match(req: TableConnectRequest):
    assert db_pool is not None
    embed_resp = genai_client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=f"{req.focus_tag}: {req.focus_description}",
        config=types.EmbedContentConfig(output_dimensionality=768),
    )
    vector_literal = "[" + ",".join(str(v) for v in embed_resp.embeddings[0].values) + "]"
    expires_at = datetime.now(timezone.utc) + timedelta(hours=2)

    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM community_vibes WHERE customer_uid = $1", req.customer_uid)
        await conn.execute(
            """
            INSERT INTO community_vibes (customer_uid, display_name, table_zone, focus_tag, focus_description, open_to_connect, embedding, expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8)
            """,
            req.customer_uid,
            req.display_name,
            req.table_zone,
            req.focus_tag,
            req.focus_description,
            req.open_to_connect,
            vector_literal,
            expires_at,
        )
        matches = await conn.fetch(
            """
            SELECT id, display_name, table_zone, focus_tag, focus_description, open_to_connect,
                   1 - (embedding <=> $1::vector) AS cosine_similarity
            FROM community_vibes
            WHERE expires_at > NOW() AND customer_uid <> $2
            ORDER BY embedding <=> $1::vector ASC
            LIMIT 8
            """,
            vector_literal,
            req.customer_uid,
        )
    return {"matches": [dict(m) for m in matches]}


@app.post("/api/ambient/triage")
async def ambient_triage(req: AmbientReportRequest):
    assert db_pool is not None
    response = genai_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=f"Zone: {req.zone}, dB: {req.decibels}, Type: {req.feedback_type}, Message: {req.raw_message}",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=AmbientTriageOutput,
        ),
    )
    triaged = AmbientTriageOutput.model_validate_json(response.text)
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO ambient_telemetry_logs (zone, decibels, feedback_type, raw_message, severity, ai_category, ai_corrective_action)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
            """,
            req.zone,
            req.decibels,
            req.feedback_type,
            req.raw_message,
            triaged.severity,
            triaged.ai_category,
            triaged.ai_corrective_action,
        )
    await manager.broadcast_kds({"type": "ambient:alert", "log": dict(row)})
    return {"log": dict(row)}
