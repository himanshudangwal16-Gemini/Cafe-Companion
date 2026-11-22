"""FastAPI service for Café Companion: VibeCraft & CounterFlow on Cloud Run + Firestore Native."""
from __future__ import annotations

import base64
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    Header,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .firestore_repo import CafeRepository, FirestoreNativeRepo, InMemoryFirestoreRepo, utc_now
from .gemini_service import GeminiCafeEngine
from .models import (
    AmbientReportRequest,
    CreateOrderRequest,
    HealthResponse,
    IcebreakerRequest,
    OrderFeedbackRequest,
    PalateMatchRequest,
    TableConnectOptInRequest,
    UpdateStageRequest,
)

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"severity":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
)
logger = logging.getLogger("cafe_companion")

APP_ENV = os.getenv("APP_ENV", "local")
USE_LOCAL_STORE = os.getenv("USE_LOCAL_STORE", "false").lower() == "true"
ENABLE_WEBSOCKETS = os.getenv("ENABLE_WEBSOCKETS", "true").lower() == "true"
STAFF_ALLOWLIST_EMAILS = {
    email.strip().lower()
    for email in os.getenv("STAFF_ALLOWLIST_EMAILS", "").split(",")
    if email.strip()
}
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://localhost:8080",
    ).split(",")
    if origin.strip() and origin.strip() != "*"
]
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
DIST_DIR = Path(__file__).resolve().parents[2] / "dist"


class RoomConnectionManager:
    """Optional room-based WebSocket fan-out for local dev; disabled in $5/mo Cloud Run prod."""

    def __init__(self) -> None:
        self.rooms: Dict[str, Set[WebSocket]] = {}

    async def connect(self, room: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.rooms.setdefault(room, set()).add(websocket)

    def disconnect(self, room: str, websocket: WebSocket) -> None:
        sockets = self.rooms.get(room)
        if sockets:
            sockets.discard(websocket)
            if not sockets:
                self.rooms.pop(room, None)

    async def broadcast(self, room: str, event: str, payload: Dict[str, Any]) -> None:
        if not ENABLE_WEBSOCKETS:
            return
        sockets = list(self.rooms.get(room, set()))
        if not sockets:
            return
        message = json.dumps({"event": event, "data": payload}, default=str)
        dead: List[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room, ws)


def _init_firebase_admin() -> bool:
    if USE_LOCAL_STORE and os.getenv("LOCAL_DEV_AUTH_BYPASS", "false").lower() == "true":
        return False
    try:
        import firebase_admin

        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        return True
    except Exception as exc:
        logger.warning("Firebase Admin initialization skipped: %s", exc)
        return False


def create_app(
    repo_override: Optional[CafeRepository] = None,
    ai_override: Optional[GeminiCafeEngine] = None,
) -> FastAPI:
    ws_manager = RoomConnectionManager()
    firebase_ready = _init_firebase_admin()

    if repo_override is not None:
        repo: CafeRepository = repo_override
    elif USE_LOCAL_STORE:
        repo = InMemoryFirestoreRepo()
    else:
        repo = FirestoreNativeRepo(
            project_id=os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT_ID"),
            database=os.getenv("FIRESTORE_DATABASE", "(default)"),
        )

    ai_engine = ai_override or GeminiCafeEngine()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if USE_LOCAL_STORE:
            seeded = await repo.seed_sample_data()
            logger.info("Local in-memory store seeded: %s", seeded)
        yield

    app = FastAPI(
        title="Café Companion: VibeCraft & CounterFlow API",
        version="2.0.0",
        lifespan=lifespan,
    )
    app.state.repo = repo
    app.state.ai = ai_engine
    app.state.ws = ws_manager

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Dev-Uid", "X-Dev-Role"],
    )

    def _local_bypass_allowed() -> bool:
        return (
            APP_ENV == "local"
            and os.getenv("LOCAL_DEV_AUTH_BYPASS", "false").lower() == "true"
        )

    async def get_optional_user(
        authorization: Optional[str] = Header(None),
        x_dev_uid: Optional[str] = Header(None),
        x_dev_role: Optional[str] = Header(None),
    ) -> Optional[Dict[str, Any]]:
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
            if firebase_ready:
                try:
                    from firebase_admin import auth as fb_auth

                    decoded = fb_auth.verify_id_token(token)
                    email = (decoded.get("email") or "").lower()
                    role = decoded.get("role") or (
                        "barista" if email in STAFF_ALLOWLIST_EMAILS else "patron"
                    )
                    return {
                        "uid": decoded["uid"],
                        "email": email,
                        "name": decoded.get("name") or email or "Patron",
                        "role": role,
                    }
                except Exception as exc:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid or expired Firebase ID token.",
                    ) from exc

        if _local_bypass_allowed() and x_dev_uid:
            return {
                "uid": x_dev_uid,
                "email": f"{x_dev_uid}@local.cafe",
                "name": x_dev_uid,
                "role": x_dev_role or "patron",
            }
        return None

    async def require_user(
        user: Optional[Dict[str, Any]] = Depends(get_optional_user),
    ) -> Dict[str, Any]:
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required.",
            )
        return user

    async def require_staff(
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        if user.get("role") not in {"barista", "shift_lead", "admin"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Barista or shift-lead role required.",
            )
        return user

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="cafe-companion-api",
            datastore="in-memory-local" if USE_LOCAL_STORE else "firestore-native",
            timestamp=utc_now(),
        )

    @app.get("/api/menu")
    async def list_menu() -> Dict[str, Any]:
        return {"items": await repo.list_menu_items()}

    @app.post("/api/orders", status_code=status.HTTP_201_CREATED)
    async def create_order(
        req: CreateOrderRequest,
        user: Optional[Dict[str, Any]] = Depends(get_optional_user),
    ) -> Dict[str, Any]:
        if not req.confirmed_by_human:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Explicit human confirmation is required before placing an order.",
            )
        if req.channel == "COUNTER_POS":
            if not user or user.get("role") not in {"barista", "shift_lead", "admin"}:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Counter POS ticket registration requires barista authentication.",
                )

        queue_depth = await repo.count_active_queue()
        line_items = [item.model_dump() for item in req.items]

        try:
            prediction = ai_engine.predict_wait_time(
                items=line_items,
                active_queue_depth=queue_depth,
                active_baristas=req.active_baristas,
            )
            est_seconds = prediction.estimated_seconds
            reasoning = prediction.reasoning
            station = prediction.recommended_station
        except Exception as exc:
            logger.warning("CounterFlow Gemini wait estimator fallback triggered: %s", exc)
            est_seconds = min(900, 120 + (queue_depth * 45) // max(1, req.active_baristas))
            reasoning = "Estimated using active bar queue depth and barista staffing."
            station = "Main Espresso Bar"

        try:
            order = await repo.create_order(
                user_uid=user["uid"] if user else None,
                customer_name=req.customer_name,
                channel=req.channel,
                table_code=req.table_code,
                items=line_items,
                estimated_wait_seconds=est_seconds,
                ai_wait_reasoning=reasoning,
                recommended_station=station,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        await ws_manager.broadcast("kds", "order:created", order)
        return {"order": order}

    @app.get("/api/orders")
    async def list_orders(
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        orders = await repo.list_orders()
        if user.get("role") not in {"barista", "shift_lead", "admin"}:
            orders = [o for o in orders if o.get("user_uid") == user["uid"]]
        return {"orders": orders}

    @app.get("/api/orders/handoff/{handoff_token}")
    async def get_order_by_handoff(handoff_token: str) -> Dict[str, Any]:
        """Zero-app QR/NFC read-only handoff lookup scoped to a single order token."""
        order = await repo.get_order_by_handoff_token(handoff_token)
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Order ticket not found for this QR handoff token.",
            )
        return {"order": order}

    @app.patch("/api/orders/{order_id}/stage")
    async def update_order_stage(
        order_id: str,
        req: UpdateStageRequest,
        _staff: Dict[str, Any] = Depends(require_staff),
    ) -> Dict[str, Any]:
        updated = await repo.advance_order_stage(order_id, req.stage, req.barista_note)
        if not updated:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
        await ws_manager.broadcast(f"order:{order_id}", "order:stage_changed", updated)
        await ws_manager.broadcast("kds", "order:stage_changed", updated)
        return {"order": updated}

    @app.post("/api/palate/match")
    async def match_palate(req: PalateMatchRequest) -> Dict[str, Any]:
        if not req.prompt and not req.image_base64:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide a tasting prompt or attach a photo of a receipt, bean bag, or allergen card.",
            )
        if req.image_base64:
            if req.image_mime_type not in ALLOWED_IMAGE_MIMES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unsupported image format. Use JPEG, PNG, or WebP.",
                )
            try:
                base64.b64decode(req.image_base64, validate=True)
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid base64 image payload.",
                ) from exc

        menu_items = await repo.list_menu_items()
        recommendation = ai_engine.match_palate(
            user_prompt=req.prompt,
            in_stock_menu=menu_items,
            image_base64=req.image_base64,
            image_mime_type=req.image_mime_type,
        )
        return {"recommendation": recommendation.model_dump()}

    @app.post("/api/orders/{order_id}/feedback", status_code=status.HTTP_201_CREATED)
    async def submit_feedback(
        order_id: str,
        req: OrderFeedbackRequest,
        user: Optional[Dict[str, Any]] = Depends(get_optional_user),
    ) -> Dict[str, Any]:
        order = await repo.get_order_by_id(order_id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")

        is_token_holder = bool(
            req.handoff_token and req.handoff_token == order.get("handoff_token")
        )
        is_owner = bool(user and order.get("user_uid") and user["uid"] == order.get("user_uid"))
        if not (is_token_holder or is_owner):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Valid QR handoff token or matching patron sign-in is required to rate this order.",
            )

        if order.get("status") not in {"READY_PICKUP", "COMPLETED"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Feedback unlocks once your order reaches READY_PICKUP.",
            )

        try:
            feedback = await repo.submit_order_feedback(
                order_id=order_id,
                customer_name=order["customer_name"],
                order_code=order["order_code"],
                drink_quality_rating=req.drink_quality_rating,
                service_experience_rating=req.service_experience_rating,
                comment=req.comment,
                submitted_by_uid=user["uid"] if user else None,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

        await ws_manager.broadcast("kds", "feedback:submitted", feedback)
        return {"feedback": feedback}

    @app.get("/api/feedback")
    async def list_feedback(
        _staff: Dict[str, Any] = Depends(require_staff),
    ) -> Dict[str, Any]:
        records = await repo.list_order_feedback()
        count = len(records)
        avg_drink = (
            round(sum(r["drink_quality_rating"] for r in records) / count, 2) if count else 0.0
        )
        avg_service = (
            round(sum(r["service_experience_rating"] for r in records) / count, 2)
            if count
            else 0.0
        )
        return {
            "feedback": records,
            "summary": {
                "total_reviews": count,
                "avg_drink_quality": avg_drink,
                "avg_service_experience": avg_service,
            },
        }

    @app.patch("/api/feedback/{order_id}/acknowledge")
    async def acknowledge_feedback(
        order_id: str,
        _staff: Dict[str, Any] = Depends(require_staff),
    ) -> Dict[str, Any]:
        updated = await repo.acknowledge_order_feedback(order_id)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Feedback record not found."
            )
        await ws_manager.broadcast("kds", "feedback:acknowledged", updated)
        return {"feedback": updated}

    @app.post("/api/table-connect/opt-in", status_code=status.HTTP_201_CREATED)
    async def table_connect_opt_in(
        req: TableConnectOptInRequest,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        vibe_text = f"{req.focus_tag}. {req.focus_description} (Zone: {req.table_zone})"
        embedding = ai_engine.embed_vibe(vibe_text)
        vibe = await repo.upsert_community_vibe(
            uid=user["uid"],
            display_name=req.display_name,
            table_zone=req.table_zone,
            focus_tag=req.focus_tag,
            focus_description=req.focus_description,
            open_to_connect=req.open_to_connect,
            embedding=embedding,
        )
        matches = (
            await repo.find_nearest_vibes(exclude_uid=user["uid"], query_embedding=embedding)
            if req.open_to_connect
            else []
        )
        return {"vibe": vibe, "matches": matches}

    @app.get("/api/table-connect/matches")
    async def table_connect_matches(
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        my_vibe = await repo.get_community_vibe(user["uid"])
        if not my_vibe:
            return {"matches": []}
        raw_embedding = my_vibe["embedding"]
        embedding = list(raw_embedding.to_map_value()["value"]) if hasattr(raw_embedding, "to_map_value") else list(raw_embedding)
        matches = await repo.find_nearest_vibes(exclude_uid=user["uid"], query_embedding=embedding)
        return {"matches": matches}

    @app.post("/api/table-connect/icebreaker")
    async def generate_icebreaker(
        req: IcebreakerRequest,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        my_vibe = await repo.get_community_vibe(user["uid"])
        peer_vibe = await repo.get_community_vibe(req.peer_uid)
        if not my_vibe or not peer_vibe or not peer_vibe.get("open_to_connect"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Both patrons must have active, opt-in Table Connect sessions.",
            )
        icebreaker = ai_engine.craft_icebreaker(
            my_tag=my_vibe["focus_tag"],
            my_desc=my_vibe["focus_description"],
            peer_name=peer_vibe["display_name"],
            peer_zone=peer_vibe["table_zone"],
            peer_tag=peer_vibe["focus_tag"],
            peer_desc=peer_vibe["focus_description"],
        )
        return {"icebreaker": icebreaker.model_dump()}

    @app.get("/api/ambient")
    async def list_ambient() -> Dict[str, Any]:
        return {"logs": await repo.list_ambient_logs()}

    @app.post("/api/ambient/report", status_code=status.HTTP_201_CREATED)
    async def report_ambient(req: AmbientReportRequest) -> Dict[str, Any]:
        triage = ai_engine.triage_ambient(
            zone=req.zone,
            decibels=req.decibels,
            feedback_type=req.feedback_type,
            raw_message=req.raw_message,
        )
        record = await repo.insert_ambient_log(
            {
                "zone": req.zone,
                "decibels": req.decibels,
                "feedback_type": req.feedback_type,
                "raw_message": req.raw_message,
                "severity": triage.severity,
                "ai_category": triage.ai_category,
                "ai_corrective_action": triage.ai_corrective_action,
            }
        )
        await ws_manager.broadcast("kds", "ambient:alert", record)
        return {"log": record}

    @app.patch("/api/ambient/{log_id}/resolve")
    async def resolve_ambient(
        log_id: str,
        _staff: Dict[str, Any] = Depends(require_staff),
    ) -> Dict[str, Any]:
        resolved = await repo.resolve_ambient_log(log_id)
        if not resolved:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ambient alert not found.")
        await ws_manager.broadcast("kds", "ambient:resolved", resolved)
        return {"log": resolved}

    @app.websocket("/ws/orders/{order_id}")
    async def ws_order(websocket: WebSocket, order_id: str) -> None:
        if not ENABLE_WEBSOCKETS:
            await websocket.close(code=1008)
            return
        room = f"order:{order_id}"
        await ws_manager.connect(room, websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            ws_manager.disconnect(room, websocket)

    @app.websocket("/ws/kds")
    async def ws_kds(websocket: WebSocket) -> None:
        if not ENABLE_WEBSOCKETS:
            await websocket.close(code=1008)
            return
        await ws_manager.connect("kds", websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            ws_manager.disconnect("kds", websocket)

    # Serve compiled Vite React PWA when dist/ is present (Cloud Run single-service bundle)
    if DIST_DIR.exists():
        assets_dir = DIST_DIR / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @app.get("/{full_path:path}")
        async def spa_fallback(full_path: str):
            if full_path.startswith("api/") or full_path.startswith("ws/"):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
            candidate = (DIST_DIR / full_path).resolve()
            if (
                full_path
                and candidate.is_relative_to(DIST_DIR.resolve())
                and candidate.is_file()
            ):
                return FileResponse(candidate)
            return FileResponse(DIST_DIR / "index.html")

    return app


app = create_app()
