"""Shared pytest fixtures and deterministic Gemini fake preserving real sanitization & guardrails."""
from __future__ import annotations

import hashlib
import math
import os
from typing import Any, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

os.environ["APP_ENV"] = "local"
os.environ["USE_LOCAL_STORE"] = "true"
os.environ["LOCAL_DEV_AUTH_BYPASS"] = "true"
os.environ["ENABLE_WEBSOCKETS"] = "false"

from app.firestore_repo import InMemoryFirestoreRepo
from app.gemini_service import GeminiCafeEngine
from app.main import create_app
from app.models import (
    AmbientTriageOutput,
    IcebreakerResponse,
    PalatePairing,
    PalateRecommendationResponse,
    WaitTimePrediction,
)
from app.sanitizer import inspect_prompt_safety


def deterministic_embedding(text: str, dim: int = 768) -> List[float]:
    """Generate a deterministic unit-normalized 768-dim bag-of-keywords embedding for offline tests."""
    tokens = [tok.strip(".,!?;:-()").lower() for tok in text.split() if len(tok.strip(".,!?;:-()")) > 2]
    vec = [0.0] * dim
    if not tokens:
        vec[0] = 1.0
        return vec
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if (digest[4] % 2 == 0) else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(x * x for x in vec))
    return [x / norm for x in vec] if norm > 0 else vec


class DeterministicGeminiEngine(GeminiCafeEngine):
    """Deterministic engine that exercises real sanitization, injection blocks, and SKU reconciliation."""

    def __init__(self) -> None:
        super().__init__(api_key="test-key-not-sent-over-network")

    def predict_wait_time(
        self,
        items: List[Dict[str, Any]],
        active_queue_depth: int,
        active_baristas: int,
    ) -> WaitTimePrediction:
        total_qty = sum(int(i.get("quantity", 1)) for i in items)
        has_pourover = any("POUR" in str(i.get("sku", "")).upper() for i in items)
        base = 240 if has_pourover else 110
        est = max(60, min(900, base + (active_queue_depth * 40 + total_qty * 30) // max(1, active_baristas)))
        return WaitTimePrediction(
            estimated_seconds=est,
            complexity_score=4.5 if has_pourover else 2.2,
            reasoning=(
                f"Projected {est}s for {total_qty} item(s) with {active_queue_depth} queued "
                f"across {active_baristas} barista(s)."
            ),
            recommended_station="Slow Pour-Over Bar" if has_pourover else "Main Espresso Bar",
        )

    def match_palate(
        self,
        user_prompt: str,
        in_stock_menu: List[Dict[str, Any]],
        image_base64: Optional[str] = None,
        image_mime_type: Optional[str] = None,
    ) -> PalateRecommendationResponse:
        is_suspicious, clean_prompt = inspect_prompt_safety(user_prompt)
        valid_skus = {m["sku"]: m for m in in_stock_menu if m.get("stock_count", 0) > 0}
        if is_suspicious:
            fallback = list(valid_skus.values())[:2]
            return PalateRecommendationResponse(
                inferred_mood="Standard Café Tasting",
                detected_dietary_limits=[],
                sommelier_summary=(
                    "I can only recommend drinks and pastries from our live menu catalog. "
                    "Here are two balanced in-stock selections to get you started."
                ),
                pairings=[
                    PalatePairing(
                        sku=item["sku"],
                        item_name=item["name"],
                        match_score=88,
                        flavor_rationale="Safe in-stock house selection.",
                        suggested_modifier="Standard bar recipe",
                    )
                    for item in fallback
                ],
                safety_notice="Untrusted override instructions were ignored.",
            )

        lower = clean_prompt.lower()
        dietary: List[str] = []
        if "gluten" in lower or "celiac" in lower:
            dietary.append("GLUTEN_FREE")
        if "dairy" in lower or "vegan" in lower or "oat" in lower:
            dietary.append("DAIRY_FREE")
        if "decaf" in lower or "no caffeine" in lower or "anxiety" in lower or "calm" in lower:
            dietary.append("LOW_CAFFEINE")

        scored: List[tuple[int, Dict[str, Any]]] = []
        for item in valid_skus.values():
            score = 75
            tags = set(item.get("dietary_tags", []))
            if "GLUTEN_FREE" in dietary and "GLUTEN_FREE" in tags:
                score += 12
            if "DAIRY_FREE" in dietary and "DAIRY_FREE" in tags:
                score += 8
            if ("savory" in lower or "snack" in lower) and item["category"] == "SAVORY_PASTRY":
                score += 14
            if ("low-acid" in lower or "low acid" in lower) and item["acidity_level"] == "LOW":
                score += 10
            if ("decaf" in lower or "evening" in lower) and item["caffeine_level"] in {"DECAF", "LOW"}:
                score += 14
            if ("iced" in lower or "cold" in lower) and item["category"] == "ICED_BREW":
                score += 12
            if ("floral" in lower or "pour-over" in lower or "pour over" in lower) and item["category"] == "POUR_OVER":
                score += 15
            if ("fast" in lower or "nitro" in lower or "high caffeine" in lower) and item["sku"] == "NITRO-BATCH-06":
                score += 15
            scored.append((min(99, score), item))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        top = scored[:3]
        pairings = [
            PalatePairing(
                sku=item["sku"],
                item_name=item["name"],
                match_score=score,
                flavor_rationale=f"Matched notes: {', '.join(item.get('flavor_notes', [])[:2])}.",
                suggested_modifier="Light ice" if item["category"] == "ICED_BREW" else "Barista standard",
            )
            for score, item in top
        ]
        # Enforce live in-stock reconciliation
        pairings = [p for p in pairings if p.sku in valid_skus][:3]
        mood = "Visual Receipt Match" if image_base64 and not clean_prompt else "Tailored Focus Pairing"
        return PalateRecommendationResponse(
            inferred_mood=mood,
            detected_dietary_limits=dietary,
            sommelier_summary=f"Selected {len(pairings)} in-stock pairings matched to your tasting profile.",
            pairings=pairings,
            safety_notice=None,
        )

    def embed_vibe(self, text: str) -> List[float]:
        return deterministic_embedding(text, dim=768)

    def craft_icebreaker(
        self,
        my_tag: str,
        my_desc: str,
        peer_name: str,
        peer_zone: str,
        peer_tag: str,
        peer_desc: str,
    ) -> IcebreakerResponse:
        return IcebreakerResponse(
            shared_ground=f"Both working near café tables on complementary topics ({my_tag} & {peer_tag}).",
            icebreaker_prompt=f"Hey {peer_name}, noticed your tag about {peer_tag}—open to a 5-minute coffee swap?",
            suggested_table_action=f"Wave casually when passing {peer_zone}.",
        )

    def triage_ambient(
        self,
        zone: str,
        decibels: Optional[float],
        feedback_type: str,
        raw_message: str,
    ) -> AmbientTriageOutput:
        is_suspicious, clean_msg = inspect_prompt_safety(raw_message)
        if is_suspicious:
            return AmbientTriageOutput(
                severity="LOW",
                ai_category="Moderation",
                ai_corrective_action="Ignore automated override text; verify table comfort manually during next floor sweep.",
            )

        lower = clean_msg.lower()
        if (decibels is not None and decibels >= 85.0) or "unusable" in lower or "outage" in lower or "spill" in lower:
            severity = "CRITICAL"
            action = f"Dispatch shift lead immediately to {zone} to resolve urgent floor disruption."
        elif (decibels is not None and decibels >= 74.0) or "loud" in lower or "slow wi-fi" in lower or "wifi" in lower:
            severity = "HIGH"
            action = f"Adjust audio/network equipment serving {zone} within 5 minutes."
        elif "chilly" in lower or "cold" in lower or "warm" in lower:
            severity = "MEDIUM"
            action = f"Rebalance HVAC damper for {zone} by 1.5°C."
        else:
            severity = "LOW"
            action = f"Log comfort note for {zone} and check during next routine floor pass."

        return AmbientTriageOutput(
            severity=severity,
            ai_category=feedback_type.title(),
            ai_corrective_action=action,
        )


@pytest.fixture()
def test_context():
    repo = InMemoryFirestoreRepo()
    ai = DeterministicGeminiEngine()
    app = create_app(repo_override=repo, ai_override=ai)
    with TestClient(app) as client:
        yield client, repo, ai
