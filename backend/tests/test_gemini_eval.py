"""18-case Gemini evaluation & prompt-injection benchmark (offline deterministic + optional live Gemini mode)."""
from __future__ import annotations

import copy
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

from app.firestore_repo import SAMPLE_MENU_ITEMS
from app.gemini_service import GeminiCafeEngine, cosine_similarity
from app.sanitizer import sanitize_text, wrap_untrusted
from tests.conftest import DeterministicGeminiEngine

DATASET_PATH = Path(__file__).resolve().parent / "eval_dataset.json"
EVAL_CASES: List[Dict[str, Any]] = json.loads(DATASET_PATH.read_text(encoding="utf-8"))


def _select_engine() -> GeminiCafeEngine:
    if os.getenv("RUN_LIVE_GEMINI_EVAL", "false").lower() == "true" and os.getenv("GEMINI_API_KEY"):
        return GeminiCafeEngine()
    return DeterministicGeminiEngine()


def run_single_eval(case: Dict[str, Any], engine: GeminiCafeEngine) -> Dict[str, Any]:
    start = time.perf_counter()
    category = case["category"]
    inp = case["input"]
    exp = case["expect"]

    if category in {"palate_match", "palate_injection"}:
        menu = copy.deepcopy(SAMPLE_MENU_ITEMS)
        forced_oos = set(inp.get("force_out_of_stock_skus", []))
        for item in menu:
            if item["sku"] in forced_oos:
                item["stock_count"] = 0
        valid_skus = {m["sku"] for m in menu if m["stock_count"] > 0}

        res = engine.match_palate(user_prompt=inp["prompt"], in_stock_menu=menu)
        returned_skus = [p.sku for p in res.pairings]

        if exp.get("must_be_in_stock"):
            assert all(sku in valid_skus for sku in returned_skus), f"Out-of-stock/hallucinated SKU: {returned_skus}"
        if "min_pairings" in exp:
            assert len(returned_skus) >= exp["min_pairings"], f"Expected >= {exp['min_pairings']} pairings"
        if "expect_any_sku" in exp:
            assert any(sku in exp["expect_any_sku"] for sku in returned_skus), (
                f"None of expected {exp['expect_any_sku']} found in {returned_skus}"
            )
        if "forbid_skus" in exp:
            assert not any(sku in exp["forbid_skus"] for sku in returned_skus), (
                f"Forbidden SKU returned: {returned_skus}"
            )
        if exp.get("expect_injection_blocked"):
            assert res.safety_notice is not None, "Expected prompt-injection safety notice"
        else:
            assert res.safety_notice is None, f"Unexpected safety block: {res.safety_notice}"
        for forbidden_text in exp.get("forbid_substrings", []):
            serialized = res.model_dump_json()
            assert forbidden_text not in serialized, f"Leaked forbidden string: {forbidden_text}"

    elif category in {"ambient_triage", "ambient_injection"}:
        out = engine.triage_ambient(
            zone=inp["zone"],
            decibels=inp["decibels"],
            feedback_type=inp["feedback_type"],
            raw_message=inp["raw_message"],
        )
        assert out.severity in exp["allowed_severities"], (
            f"Severity {out.severity} not in {exp['allowed_severities']}"
        )
        assert len(out.ai_corrective_action.strip()) >= 10
        if exp.get("expect_moderation"):
            assert out.ai_category == "Moderation"

    elif category == "wait_time":
        fast = engine.predict_wait_time(
            items=inp["fast_order"]["items"],
            active_queue_depth=inp["fast_order"]["queue"],
            active_baristas=inp["fast_order"]["baristas"],
        )
        complex_pred = engine.predict_wait_time(
            items=inp["complex_order"]["items"],
            active_queue_depth=inp["complex_order"]["queue"],
            active_baristas=inp["complex_order"]["baristas"],
        )
        assert exp["min_seconds"] <= fast.estimated_seconds <= exp["max_seconds"]
        assert exp["min_seconds"] <= complex_pred.estimated_seconds <= exp["max_seconds"]
        if exp.get("complex_greater_than_fast"):
            assert complex_pred.estimated_seconds > fast.estimated_seconds, (
                f"Expected complex ({complex_pred.estimated_seconds}s) > fast ({fast.estimated_seconds}s)"
            )

    elif category == "sanitizer":
        cleaned = sanitize_text(inp["raw"])
        fenced = wrap_untrusted("patron_request", cleaned)
        prefix = "<untrusted_patron_request>\n"
        suffix = "\n</untrusted_patron_request>"
        assert fenced.startswith(prefix) and fenced.endswith(suffix)
        inner_body = fenced[len(prefix) : -len(suffix)]
        for bad in exp["must_not_contain"]:
            assert bad not in inner_body, f"Unsanitized token {bad!r} found in inner body {inner_body!r}"

    elif category == "embedding_rank":
        v_anchor = engine.embed_vibe(inp["anchor"])
        v_sim = engine.embed_vibe(inp["similar"])
        v_unrel = engine.embed_vibe(inp["unrelated"])
        assert len(v_anchor) == exp["embedding_dim"]
        sim_score = cosine_similarity(v_anchor, v_sim)
        unrel_score = cosine_similarity(v_anchor, v_unrel)
        if exp.get("similar_outranks_unrelated"):
            assert sim_score > unrel_score, f"Expected {sim_score:.4f} > {unrel_score:.4f}"
    else:
        raise ValueError(f"Unknown eval category: {category}")

    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
    return {"id": case["id"], "category": category, "passed": True, "latency_ms": elapsed_ms}


@pytest.mark.parametrize("eval_case", EVAL_CASES, ids=[c["id"] for c in EVAL_CASES])
def test_gemini_eval_suite(eval_case: Dict[str, Any]) -> None:
    engine = _select_engine()
    result = run_single_eval(eval_case, engine)
    assert result["passed"] is True


def main() -> None:
    mode = (
        "LIVE GEMINI API"
        if os.getenv("RUN_LIVE_GEMINI_EVAL", "false").lower() == "true" and os.getenv("GEMINI_API_KEY")
        else "DETERMINISTIC OFFLINE"
    )
    engine = _select_engine()
    print(f"\n=== Café Companion Gemini Eval Harness ({mode}) — {len(EVAL_CASES)} cases ===")
    passed = 0
    for case in EVAL_CASES:
        try:
            res = run_single_eval(case, engine)
            passed += 1
            print(f"[PASS] {res['id']:36s} | {res['category']:18s} | {res['latency_ms']:6.2f} ms")
        except Exception as exc:
            print(f"[FAIL] {case['id']:36s} | {case['category']:18s} | {exc}")
    print(f"=== Score: {passed}/{len(EVAL_CASES)} passed ({round(passed / len(EVAL_CASES) * 100, 1)}%) ===\n")
    if passed != len(EVAL_CASES):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
