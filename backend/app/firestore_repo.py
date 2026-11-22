"""Cloud Firestore (Native mode) + Vector Search repository with zero-credential local fallback."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Protocol

from .gemini_service import cosine_similarity

SAMPLE_MENU_ITEMS: List[Dict[str, Any]] = [
    {
        "sku": "CB-TONIC-01",
        "name": "Yuzu Espresso Cold Brew Tonic",
        "category": "ICED_BREW",
        "description": "18-hour washed Ethiopian cold brew layered over botanical quinine tonic and bright yuzu peel.",
        "caffeine_level": "MODERATE",
        "acidity_level": "LOW",
        "dietary_tags": ["VEGAN", "GLUTEN_FREE", "DAIRY_FREE"],
        "flavor_notes": ["Yuzu Citrus", "Cacao Nib", "Crisp Quinine"],
        "price_cents": 650,
        "prep_complexity": 2,
        "stock_count": 28,
        "active": True,
    },
    {
        "sku": "OAT-CORT-02",
        "name": "Velvet Oat Milk Cortado",
        "category": "ESPRESSO",
        "description": "Double ristretto pulled from honey-process Colombian beans with micro-foamed barista oat milk.",
        "caffeine_level": "HIGH",
        "acidity_level": "LOW",
        "dietary_tags": ["VEGAN", "DAIRY_FREE"],
        "flavor_notes": ["Toasted Hazelnut", "Panela Sugar", "Silky Oat"],
        "price_cents": 575,
        "prep_complexity": 3,
        "stock_count": 36,
        "active": True,
    },
    {
        "sku": "MATCHA-YUZU-03",
        "name": "Ceremonial Uji Matcha & Yuzu Spritz",
        "category": "TEA_MATCHA",
        "description": "Hand-whisked stone-ground Uji matcha with L-theanine calm focus, chilled over sparkling spring water.",
        "caffeine_level": "LOW",
        "acidity_level": "LOW",
        "dietary_tags": ["VEGAN", "GLUTEN_FREE", "DAIRY_FREE"],
        "flavor_notes": ["Umami Sweet Grass", "Meyer Lemon", "Clean Finish"],
        "price_cents": 675,
        "prep_complexity": 3,
        "stock_count": 24,
        "active": True,
    },
    {
        "sku": "POUR-GEISHA-04",
        "name": "Single-Origin Kalita Wave Pour-Over",
        "category": "POUR_OVER",
        "description": "Hand-poured Panama Boquete lot brewed to order in 3 pulsed pours for crystalline floral clarity.",
        "caffeine_level": "MODERATE",
        "acidity_level": "BRIGHT",
        "dietary_tags": ["VEGAN", "GLUTEN_FREE", "DAIRY_FREE"],
        "flavor_notes": ["Jasmine Blossom", "White Peach", "Bergamot"],
        "price_cents": 825,
        "prep_complexity": 5,
        "stock_count": 14,
        "active": True,
    },
    {
        "sku": "HOJICHA-LAT-05",
        "name": "Roasted Hojicha Maple Oat Latte",
        "category": "TEA_MATCHA",
        "description": "Charcoal-roasted Kyoto green tea stems steamed with oat milk and a trace of dark Vermont maple.",
        "caffeine_level": "DECAF",
        "acidity_level": "LOW",
        "dietary_tags": ["VEGAN", "GLUTEN_FREE", "DAIRY_FREE", "LOW_CAFFEINE"],
        "flavor_notes": ["Roasted Chestnut", "Caramel", "Warm Cocoa"],
        "price_cents": 625,
        "prep_complexity": 2,
        "stock_count": 22,
        "active": True,
    },
    {
        "sku": "NITRO-BATCH-06",
        "name": "Nitrogen-Infused Cascading Cold Brew",
        "category": "ICED_BREW",
        "description": "Velvety draft nitro cold brew on tap with creamy micro-head and naturally low-acid chocolate body.",
        "caffeine_level": "HIGH",
        "acidity_level": "LOW",
        "dietary_tags": ["VEGAN", "GLUTEN_FREE", "DAIRY_FREE"],
        "flavor_notes": ["Dark Chocolate", "Molasses", "Velvet Foam"],
        "price_cents": 600,
        "prep_complexity": 1,
        "stock_count": 40,
        "active": True,
    },
    {
        "sku": "GF-GALETTE-07",
        "name": "Buckwheat & Caramelized Shallot Galette",
        "category": "SAVORY_PASTRY",
        "description": "Flaky 100% buckwheat gluten-free savory pastry folded with thyme-roasted shallots and aged goat cheese.",
        "caffeine_level": "NONE",
        "acidity_level": "LOW",
        "dietary_tags": ["GLUTEN_FREE", "VEGETARIAN", "SAVORY"],
        "flavor_notes": ["Nutty Buckwheat", "Sweet Shallot", "Garden Thyme"],
        "price_cents": 750,
        "prep_complexity": 2,
        "stock_count": 16,
        "active": True,
    },
    {
        "sku": "CARDAMOM-BUN-08",
        "name": "Nordic Swirl Cardamom Knot",
        "category": "SWEET_PASTRY",
        "description": "Laminated sourdough brioche knotted with freshly mortar-ground green cardamom and pearl sugar.",
        "caffeine_level": "NONE",
        "acidity_level": "LOW",
        "dietary_tags": ["VEGETARIAN"],
        "flavor_notes": ["Green Cardamom", "Cultured Butter", "Orange Zest"],
        "price_cents": 550,
        "prep_complexity": 1,
        "stock_count": 20,
        "active": True,
    },
]

SAMPLE_AMBIENT_LOGS: List[Dict[str, Any]] = [
    {
        "zone": "Quiet Library Corner",
        "decibels": 54.2,
        "feedback_type": "ACOUSTIC",
        "raw_message": "Ambient sensor check: comfortable library-level acoustic profile.",
        "severity": "LOW",
        "ai_category": "Acoustics",
        "ai_corrective_action": "No action needed; maintain current speaker EQ.",
        "resolved": True,
    },
    {
        "zone": "Window Bar",
        "decibels": 73.8,
        "feedback_type": "MUSIC",
        "raw_message": "Speaker near window bar is slightly loud for video calls.",
        "severity": "MEDIUM",
        "ai_category": "Audio Level",
        "ai_corrective_action": "Lower Window Bar zone amp by 3 dB during morning work hours.",
        "resolved": False,
    },
]

ACTIVE_ORDER_STAGES = {"GRINDING_EXTRACTION", "STEAMING_POUR", "QUALITY_PLATING"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_dt(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [_serialize_dt(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize_dt(v) for k, v in value.items()}
    return value


class CafeRepository(Protocol):
    async def seed_sample_data(self) -> Dict[str, int]: ...
    async def list_menu_items(self) -> List[Dict[str, Any]]: ...
    async def count_active_queue(self) -> int: ...
    async def create_order(
        self,
        *,
        user_uid: Optional[str],
        customer_name: str,
        channel: str,
        table_code: Optional[str],
        items: List[Dict[str, Any]],
        estimated_wait_seconds: int,
        ai_wait_reasoning: str,
        recommended_station: str,
    ) -> Dict[str, Any]: ...
    async def list_orders(self, limit: int = 40) -> List[Dict[str, Any]]: ...
    async def get_order_by_id(self, order_id: str) -> Optional[Dict[str, Any]]: ...
    async def get_order_by_handoff_token(self, token: str) -> Optional[Dict[str, Any]]: ...
    async def advance_order_stage(
        self, order_id: str, stage: str, barista_note: str
    ) -> Optional[Dict[str, Any]]: ...
    async def submit_order_feedback(
        self,
        *,
        order_id: str,
        customer_name: str,
        order_code: str,
        drink_quality_rating: int,
        service_experience_rating: int,
        comment: str,
        submitted_by_uid: Optional[str],
    ) -> Dict[str, Any]: ...
    async def list_order_feedback(self, limit: int = 40) -> List[Dict[str, Any]]: ...
    async def acknowledge_order_feedback(self, order_id: str) -> Optional[Dict[str, Any]]: ...
    async def upsert_community_vibe(
        self,
        *,
        uid: str,
        display_name: str,
        table_zone: str,
        focus_tag: str,
        focus_description: str,
        open_to_connect: bool,
        embedding: List[float],
    ) -> Dict[str, Any]: ...
    async def get_community_vibe(self, uid: str) -> Optional[Dict[str, Any]]: ...
    async def find_nearest_vibes(
        self, *, exclude_uid: str, query_embedding: List[float], limit: int = 8
    ) -> List[Dict[str, Any]]: ...
    async def insert_ambient_log(self, entry: Dict[str, Any]) -> Dict[str, Any]: ...
    async def list_ambient_logs(self, limit: int = 30) -> List[Dict[str, Any]]: ...
    async def resolve_ambient_log(self, log_id: str) -> Optional[Dict[str, Any]]: ...


class FirestoreNativeRepo:
    """Production Google Cloud Firestore Native repository with 768-dim Vector Search."""

    def __init__(self, project_id: Optional[str] = None, database: str = "(default)") -> None:
        from google.cloud import firestore

        self._firestore = firestore
        self.db = firestore.AsyncClient(project=project_id, database=database)

    async def seed_sample_data(self) -> Dict[str, int]:
        menu_seeded = 0
        for item in SAMPLE_MENU_ITEMS:
            ref = self.db.collection("menu_items").document(item["sku"])
            snap = await ref.get()
            if not snap.exists:
                await ref.set({**item, "updated_at": utc_now()})
                menu_seeded += 1

        ambient_seeded = 0
        existing_ambient = [doc async for doc in self.db.collection("ambient_logs").limit(1).stream()]
        if not existing_ambient:
            for log in SAMPLE_AMBIENT_LOGS:
                doc_id = str(uuid.uuid4())
                await self.db.collection("ambient_logs").document(doc_id).set(
                    {**log, "id": doc_id, "created_at": utc_now()}
                )
                ambient_seeded += 1
        return {"menu_seeded": menu_seeded, "ambient_seeded": ambient_seeded}

    async def list_menu_items(self) -> List[Dict[str, Any]]:
        docs = [doc.to_dict() async for doc in self.db.collection("menu_items").stream()]
        docs.sort(key=lambda d: (d.get("category", ""), d.get("name", "")))
        return [_serialize_dt(d) for d in docs]

    async def count_active_queue(self) -> int:
        query = self.db.collection("orders").where("status", "in", list(ACTIVE_ORDER_STAGES))
        docs = [doc async for doc in query.stream()]
        return len(docs)

    async def create_order(
        self,
        *,
        user_uid: Optional[str],
        customer_name: str,
        channel: str,
        table_code: Optional[str],
        items: List[Dict[str, Any]],
        estimated_wait_seconds: int,
        ai_wait_reasoning: str,
        recommended_station: str,
    ) -> Dict[str, Any]:
        firestore = self._firestore
        transaction = self.db.transaction()
        order_id = str(uuid.uuid4())
        now = utc_now()
        order_code = f"CF-{secrets.randbelow(900) + 100}"
        handoff_token = secrets.token_urlsafe(18)

        @firestore.async_transactional
        async def _tx(txn: Any) -> Dict[str, Any]:
            resolved_items: List[Dict[str, Any]] = []
            total_cents = 0
            menu_updates: List[tuple[Any, int]] = []

            for line in items:
                menu_ref = self.db.collection("menu_items").document(line["sku"])
                menu_snap = await menu_ref.get(transaction=txn)
                if not menu_snap.exists:
                    raise ValueError(f"Unknown menu SKU: {line['sku']}")
                menu_data = menu_snap.to_dict()
                qty = int(line["quantity"])
                if not menu_data.get("active", True) or menu_data.get("stock_count", 0) < qty:
                    raise ValueError(f"Insufficient stock for {menu_data.get('name', line['sku'])}")
                menu_updates.append((menu_ref, menu_data["stock_count"] - qty))
                unit_price = int(menu_data["price_cents"])
                total_cents += unit_price * qty
                resolved_items.append(
                    {
                        "sku": menu_data["sku"],
                        "item_name": menu_data["name"],
                        "quantity": qty,
                        "modifiers": line.get("modifiers", ""),
                        "unit_price_cents": unit_price,
                    }
                )

            for menu_ref, next_stock in menu_updates:
                txn.update(menu_ref, {"stock_count": next_stock, "updated_at": now})

            order_doc = {
                "id": order_id,
                "order_code": order_code,
                "user_uid": user_uid,
                "customer_name": customer_name,
                "channel": channel,
                "table_code": table_code,
                "status": "GRINDING_EXTRACTION",
                "handoff_token": handoff_token,
                "estimated_wait_seconds": estimated_wait_seconds,
                "estimated_ready_at": now + timedelta(seconds=estimated_wait_seconds),
                "ai_wait_reasoning": ai_wait_reasoning,
                "recommended_station": recommended_station,
                "total_cents": total_cents,
                "items": resolved_items,
                "stage_history": [
                    {
                        "stage": "GRINDING_EXTRACTION",
                        "barista_note": f"Queued at {recommended_station}",
                        "entered_at": now,
                    }
                ],
                "feedback_submitted": False,
                "created_at": now,
                "updated_at": now,
            }
            txn.set(self.db.collection("orders").document(order_id), order_doc)
            return order_doc

        created = await _tx(transaction)
        return _serialize_dt(created)

    async def list_orders(self, limit: int = 40) -> List[Dict[str, Any]]:
        query = (
            self.db.collection("orders")
            .order_by("created_at", direction=self._firestore.Query.DESCENDING)
            .limit(limit)
        )
        return [_serialize_dt(doc.to_dict()) async for doc in query.stream()]

    async def get_order_by_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        snap = await self.db.collection("orders").document(order_id).get()
        return _serialize_dt(snap.to_dict()) if snap.exists else None

    async def get_order_by_handoff_token(self, token: str) -> Optional[Dict[str, Any]]:
        query = self.db.collection("orders").where("handoff_token", "==", token).limit(1)
        docs = [doc.to_dict() async for doc in query.stream()]
        return _serialize_dt(docs[0]) if docs else None

    async def advance_order_stage(
        self, order_id: str, stage: str, barista_note: str
    ) -> Optional[Dict[str, Any]]:
        ref = self.db.collection("orders").document(order_id)
        snap = await ref.get()
        if not snap.exists:
            return None
        now = utc_now()
        data = snap.to_dict()
        history = list(data.get("stage_history", []))
        history.append(
            {"stage": stage, "barista_note": barista_note, "entered_at": now}
        )
        updates: Dict[str, Any] = {
            "status": stage,
            "stage_history": history,
            "updated_at": now,
        }
        if stage in {"READY_PICKUP", "COMPLETED"}:
            updates["estimated_ready_at"] = now
            updates["estimated_wait_seconds"] = 0
        await ref.update(updates)
        merged = {**data, **updates}
        return _serialize_dt(merged)

    async def submit_order_feedback(
        self,
        *,
        order_id: str,
        customer_name: str,
        order_code: str,
        drink_quality_rating: int,
        service_experience_rating: int,
        comment: str,
        submitted_by_uid: Optional[str],
    ) -> Dict[str, Any]:
        fb_ref = self.db.collection("order_feedback").document(order_id)
        existing = await fb_ref.get()
        if existing.exists:
            raise ValueError("Feedback already submitted for this order.")
        now = utc_now()
        doc = {
            "order_id": order_id,
            "order_code": order_code,
            "customer_name": customer_name,
            "drink_quality_rating": drink_quality_rating,
            "service_experience_rating": service_experience_rating,
            "comment": comment,
            "submitted_by_uid": submitted_by_uid,
            "acknowledged": False,
            "created_at": now,
        }
        await fb_ref.set(doc)
        await self.db.collection("orders").document(order_id).update(
            {"feedback_submitted": True, "updated_at": now}
        )
        return _serialize_dt(doc)

    async def list_order_feedback(self, limit: int = 40) -> List[Dict[str, Any]]:
        query = (
            self.db.collection("order_feedback")
            .order_by("created_at", direction=self._firestore.Query.DESCENDING)
            .limit(limit)
        )
        return [_serialize_dt(doc.to_dict()) async for doc in query.stream()]

    async def acknowledge_order_feedback(self, order_id: str) -> Optional[Dict[str, Any]]:
        ref = self.db.collection("order_feedback").document(order_id)
        snap = await ref.get()
        if not snap.exists:
            return None
        now = utc_now()
        await ref.update({"acknowledged": True, "acknowledged_at": now})
        data = snap.to_dict()
        data["acknowledged"] = True
        data["acknowledged_at"] = now
        return _serialize_dt(data)

    async def upsert_community_vibe(
        self,
        *,
        uid: str,
        display_name: str,
        table_zone: str,
        focus_tag: str,
        focus_description: str,
        open_to_connect: bool,
        embedding: List[float],
    ) -> Dict[str, Any]:
        from google.cloud.firestore_v1.vector import Vector

        now = utc_now()
        expires_at = now + timedelta(hours=2)
        doc = {
            "uid": uid,
            "display_name": display_name,
            "table_zone": table_zone,
            "focus_tag": focus_tag,
            "focus_description": focus_description,
            "open_to_connect": open_to_connect,
            "embedding": Vector(embedding),
            "created_at": now,
            "expires_at": expires_at,
        }
        await self.db.collection("community_vibes").document(uid).set(doc)
        public_doc = {k: v for k, v in doc.items() if k != "embedding"}
        return _serialize_dt(public_doc)

    async def get_community_vibe(self, uid: str) -> Optional[Dict[str, Any]]:
        snap = await self.db.collection("community_vibes").document(uid).get()
        if not snap.exists:
            return None
        data = snap.to_dict()
        expires_at = data.get("expires_at")
        if isinstance(expires_at, datetime) and expires_at <= utc_now():
            return None
        return data

    async def find_nearest_vibes(
        self, *, exclude_uid: str, query_embedding: List[float], limit: int = 8
    ) -> List[Dict[str, Any]]:
        from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
        from google.cloud.firestore_v1.vector import Vector

        now = utc_now()
        vector_query = (
            self.db.collection("community_vibes")
            .where("open_to_connect", "==", True)
            .find_nearest(
                vector_field="embedding",
                query_vector=Vector(query_embedding),
                distance_measure=DistanceMeasure.COSINE,
                limit=limit + 6,
                distance_result_field="vector_distance",
            )
        )
        matches: List[Dict[str, Any]] = []
        async for doc in vector_query.stream():
            data = doc.to_dict()
            if data.get("uid") == exclude_uid:
                continue
            expires_at = data.get("expires_at")
            if isinstance(expires_at, datetime) and expires_at <= now:
                continue
            distance = float(data.get("vector_distance", 1.0))
            similarity_pct = max(0, min(100, round((1.0 - distance) * 100)))
            matches.append(
                _serialize_dt(
                    {
                        "uid": data["uid"],
                        "display_name": data["display_name"],
                        "table_zone": data["table_zone"],
                        "focus_tag": data["focus_tag"],
                        "focus_description": data["focus_description"],
                        "expires_at": expires_at,
                        "similarity_pct": similarity_pct,
                    }
                )
            )
            if len(matches) >= limit:
                break
        return matches

    async def insert_ambient_log(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        doc_id = str(uuid.uuid4())
        doc = {**entry, "id": doc_id, "resolved": False, "created_at": utc_now()}
        await self.db.collection("ambient_logs").document(doc_id).set(doc)
        return _serialize_dt(doc)

    async def list_ambient_logs(self, limit: int = 30) -> List[Dict[str, Any]]:
        query = (
            self.db.collection("ambient_logs")
            .order_by("created_at", direction=self._firestore.Query.DESCENDING)
            .limit(limit)
        )
        return [_serialize_dt(doc.to_dict()) async for doc in query.stream()]

    async def resolve_ambient_log(self, log_id: str) -> Optional[Dict[str, Any]]:
        ref = self.db.collection("ambient_logs").document(log_id)
        snap = await ref.get()
        if not snap.exists:
            return None
        now = utc_now()
        await ref.update({"resolved": True, "resolved_at": now})
        data = snap.to_dict()
        data["resolved"] = True
        data["resolved_at"] = now
        return _serialize_dt(data)


class InMemoryFirestoreRepo:
    """Zero-credential local Firestore-compatible repository for offline dev and pytest."""

    def __init__(self) -> None:
        self.menu_items: Dict[str, Dict[str, Any]] = {}
        self.orders: Dict[str, Dict[str, Any]] = {}
        self.order_feedback: Dict[str, Dict[str, Any]] = {}
        self.community_vibes: Dict[str, Dict[str, Any]] = {}
        self.ambient_logs: Dict[str, Dict[str, Any]] = {}

    async def seed_sample_data(self) -> Dict[str, int]:
        menu_seeded = 0
        for item in SAMPLE_MENU_ITEMS:
            if item["sku"] not in self.menu_items:
                self.menu_items[item["sku"]] = {**item, "updated_at": utc_now()}
                menu_seeded += 1
        ambient_seeded = 0
        if not self.ambient_logs:
            for log in SAMPLE_AMBIENT_LOGS:
                doc_id = str(uuid.uuid4())
                self.ambient_logs[doc_id] = {**log, "id": doc_id, "created_at": utc_now()}
                ambient_seeded += 1
        return {"menu_seeded": menu_seeded, "ambient_seeded": ambient_seeded}

    async def list_menu_items(self) -> List[Dict[str, Any]]:
        items = list(self.menu_items.values())
        items.sort(key=lambda d: (d.get("category", ""), d.get("name", "")))
        return [_serialize_dt(i) for i in items]

    async def count_active_queue(self) -> int:
        return sum(1 for o in self.orders.values() if o["status"] in ACTIVE_ORDER_STAGES)

    async def create_order(
        self,
        *,
        user_uid: Optional[str],
        customer_name: str,
        channel: str,
        table_code: Optional[str],
        items: List[Dict[str, Any]],
        estimated_wait_seconds: int,
        ai_wait_reasoning: str,
        recommended_station: str,
    ) -> Dict[str, Any]:
        resolved_items: List[Dict[str, Any]] = []
        total_cents = 0
        staged_decrements: List[tuple[str, int]] = []

        for line in items:
            menu = self.menu_items.get(line["sku"])
            if not menu:
                raise ValueError(f"Unknown menu SKU: {line['sku']}")
            qty = int(line["quantity"])
            if not menu.get("active", True) or menu.get("stock_count", 0) < qty:
                raise ValueError(f"Insufficient stock for {menu['name']}")
            staged_decrements.append((menu["sku"], qty))
            unit_price = int(menu["price_cents"])
            total_cents += unit_price * qty
            resolved_items.append(
                {
                    "sku": menu["sku"],
                    "item_name": menu["name"],
                    "quantity": qty,
                    "modifiers": line.get("modifiers", ""),
                    "unit_price_cents": unit_price,
                }
            )

        now = utc_now()
        for sku, qty in staged_decrements:
            self.menu_items[sku]["stock_count"] -= qty
            self.menu_items[sku]["updated_at"] = now

        order_id = str(uuid.uuid4())
        doc = {
            "id": order_id,
            "order_code": f"CF-{secrets.randbelow(900) + 100}",
            "user_uid": user_uid,
            "customer_name": customer_name,
            "channel": channel,
            "table_code": table_code,
            "status": "GRINDING_EXTRACTION",
            "handoff_token": secrets.token_urlsafe(18),
            "estimated_wait_seconds": estimated_wait_seconds,
            "estimated_ready_at": now + timedelta(seconds=estimated_wait_seconds),
            "ai_wait_reasoning": ai_wait_reasoning,
            "recommended_station": recommended_station,
            "total_cents": total_cents,
            "items": resolved_items,
            "stage_history": [
                {
                    "stage": "GRINDING_EXTRACTION",
                    "barista_note": f"Queued at {recommended_station}",
                    "entered_at": now,
                }
            ],
            "feedback_submitted": False,
            "created_at": now,
            "updated_at": now,
        }
        self.orders[order_id] = doc
        return _serialize_dt(doc)

    async def list_orders(self, limit: int = 40) -> List[Dict[str, Any]]:
        ordered = sorted(self.orders.values(), key=lambda o: o["created_at"], reverse=True)
        return [_serialize_dt(o) for o in ordered[:limit]]

    async def get_order_by_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        order = self.orders.get(order_id)
        return _serialize_dt(order) if order else None

    async def get_order_by_handoff_token(self, token: str) -> Optional[Dict[str, Any]]:
        for order in self.orders.values():
            if order.get("handoff_token") == token:
                return _serialize_dt(order)
        return None

    async def advance_order_stage(
        self, order_id: str, stage: str, barista_note: str
    ) -> Optional[Dict[str, Any]]:
        order = self.orders.get(order_id)
        if not order:
            return None
        now = utc_now()
        order["status"] = stage
        order["stage_history"].append(
            {"stage": stage, "barista_note": barista_note, "entered_at": now}
        )
        order["updated_at"] = now
        if stage in {"READY_PICKUP", "COMPLETED"}:
            order["estimated_ready_at"] = now
            order["estimated_wait_seconds"] = 0
        return _serialize_dt(order)

    async def submit_order_feedback(
        self,
        *,
        order_id: str,
        customer_name: str,
        order_code: str,
        drink_quality_rating: int,
        service_experience_rating: int,
        comment: str,
        submitted_by_uid: Optional[str],
    ) -> Dict[str, Any]:
        if order_id in self.order_feedback:
            raise ValueError("Feedback already submitted for this order.")
        now = utc_now()
        doc = {
            "order_id": order_id,
            "order_code": order_code,
            "customer_name": customer_name,
            "drink_quality_rating": drink_quality_rating,
            "service_experience_rating": service_experience_rating,
            "comment": comment,
            "submitted_by_uid": submitted_by_uid,
            "acknowledged": False,
            "created_at": now,
        }
        self.order_feedback[order_id] = doc
        if order_id in self.orders:
            self.orders[order_id]["feedback_submitted"] = True
            self.orders[order_id]["updated_at"] = now
        return _serialize_dt(doc)

    async def list_order_feedback(self, limit: int = 40) -> List[Dict[str, Any]]:
        items = sorted(self.order_feedback.values(), key=lambda f: f["created_at"], reverse=True)
        return [_serialize_dt(f) for f in items[:limit]]

    async def acknowledge_order_feedback(self, order_id: str) -> Optional[Dict[str, Any]]:
        fb = self.order_feedback.get(order_id)
        if not fb:
            return None
        fb["acknowledged"] = True
        fb["acknowledged_at"] = utc_now()
        return _serialize_dt(fb)

    async def upsert_community_vibe(
        self,
        *,
        uid: str,
        display_name: str,
        table_zone: str,
        focus_tag: str,
        focus_description: str,
        open_to_connect: bool,
        embedding: List[float],
    ) -> Dict[str, Any]:
        now = utc_now()
        doc = {
            "uid": uid,
            "display_name": display_name,
            "table_zone": table_zone,
            "focus_tag": focus_tag,
            "focus_description": focus_description,
            "open_to_connect": open_to_connect,
            "embedding": embedding,
            "created_at": now,
            "expires_at": now + timedelta(hours=2),
        }
        self.community_vibes[uid] = doc
        return _serialize_dt({k: v for k, v in doc.items() if k != "embedding"})

    async def get_community_vibe(self, uid: str) -> Optional[Dict[str, Any]]:
        vibe = self.community_vibes.get(uid)
        if not vibe or vibe["expires_at"] <= utc_now():
            return None
        return vibe

    async def find_nearest_vibes(
        self, *, exclude_uid: str, query_embedding: List[float], limit: int = 8
    ) -> List[Dict[str, Any]]:
        now = utc_now()
        scored: List[tuple[float, Dict[str, Any]]] = []
        for uid, vibe in self.community_vibes.items():
            if uid == exclude_uid or not vibe.get("open_to_connect"):
                continue
            if vibe["expires_at"] <= now:
                continue
            sim = cosine_similarity(query_embedding, vibe["embedding"])
            scored.append((sim, vibe))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            _serialize_dt(
                {
                    "uid": vibe["uid"],
                    "display_name": vibe["display_name"],
                    "table_zone": vibe["table_zone"],
                    "focus_tag": vibe["focus_tag"],
                    "focus_description": vibe["focus_description"],
                    "expires_at": vibe["expires_at"],
                    "similarity_pct": max(0, min(100, round(sim * 100))),
                }
            )
            for sim, vibe in scored[:limit]
        ]

    async def insert_ambient_log(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        doc_id = str(uuid.uuid4())
        doc = {**entry, "id": doc_id, "resolved": False, "created_at": utc_now()}
        self.ambient_logs[doc_id] = doc
        return _serialize_dt(doc)

    async def list_ambient_logs(self, limit: int = 30) -> List[Dict[str, Any]]:
        logs = sorted(self.ambient_logs.values(), key=lambda l: l["created_at"], reverse=True)
        return [_serialize_dt(l) for l in logs[:limit]]

    async def resolve_ambient_log(self, log_id: str) -> Optional[Dict[str, Any]]:
        log = self.ambient_logs.get(log_id)
        if not log:
            return None
        log["resolved"] = True
        log["resolved_at"] = utc_now()
        return _serialize_dt(log)
