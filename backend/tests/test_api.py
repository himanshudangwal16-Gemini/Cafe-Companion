"""Automated API tests covering all 5 Café Companion flows, edge cases, RBAC, and malformed inputs."""
from __future__ import annotations

import base64
from datetime import timedelta

from app.firestore_repo import utc_now

BARISTA_HEADERS = {"X-Dev-Uid": "barista-1", "X-Dev-Role": "barista"}
PATRON_A_HEADERS = {"X-Dev-Uid": "patron-a", "X-Dev-Role": "patron"}
PATRON_B_HEADERS = {"X-Dev-Uid": "patron-b", "X-Dev-Role": "patron"}
PATRON_C_HEADERS = {"X-Dev-Uid": "patron-c", "X-Dev-Role": "patron"}

# Minimal valid 1x1 PNG bytes for multimodal upload testing
TINY_PNG_B64 = base64.b64encode(
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc`\x00\x00"
    b"\x00\x02\x00\x01\xe2!\xbc3\x00\x00\x00\x00IEND\xaeB`\x82"
).decode("ascii")


def test_health_and_seeded_menu(test_context):
    client, _repo, _ai = test_context
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    menu_resp = client.get("/api/menu")
    assert menu_resp.status_code == 200
    items = menu_resp.json()["items"]
    assert len(items) == 8
    skus = {item["sku"] for item in items}
    assert {"CB-TONIC-01", "POUR-GEISHA-04", "GF-GALETTE-07"}.issubset(skus)


def test_flow_1_and_5_order_qr_handoff_kds_stages_and_feedback_loop(test_context):
    client, repo, _ai = test_context
    initial_stock = repo.menu_items["CB-TONIC-01"]["stock_count"]

    # 1. Place order via Counter POS (requires barista role + human confirmation)
    create_resp = client.post(
        "/api/orders",
        headers=BARISTA_HEADERS,
        json={
            "customer_name": "Aarav",
            "channel": "COUNTER_POS",
            "table_code": "Table-4",
            "active_baristas": 2,
            "confirmed_by_human": True,
            "items": [
                {"sku": "CB-TONIC-01", "quantity": 2, "modifiers": "Less ice"},
                {"sku": "GF-GALETTE-07", "quantity": 1, "modifiers": "Warmed"},
            ],
        },
    )
    assert create_resp.status_code == 201
    order = create_resp.json()["order"]
    assert order["status"] == "GRINDING_EXTRACTION"
    assert order["total_cents"] == 650 * 2 + 750
    assert order["handoff_token"]
    assert repo.menu_items["CB-TONIC-01"]["stock_count"] == initial_stock - 2

    # 2. Zero-app QR handoff lookup without authentication
    handoff = client.get(f"/api/orders/handoff/{order['handoff_token']}")
    assert handoff.status_code == 200
    assert handoff.json()["order"]["id"] == order["id"]

    # 3. Attempting feedback BEFORE READY_PICKUP must be rejected
    early_fb = client.post(
        f"/api/orders/{order['id']}/feedback",
        json={
            "drink_quality_rating": 5,
            "service_experience_rating": 5,
            "comment": "Too early",
            "handoff_token": order["handoff_token"],
        },
    )
    assert early_fb.status_code == 400

    # 4. Barista advances stages on KDS -> READY_PICKUP
    for stage, note in [
        ("STEAMING_POUR", "Pulled clean shot"),
        ("QUALITY_PLATING", "Warmed buckwheat galette"),
        ("READY_PICKUP", "At pickup counter"),
    ]:
        stage_resp = client.patch(
            f"/api/orders/{order['id']}/stage",
            headers=BARISTA_HEADERS,
            json={"stage": stage, "barista_note": note},
        )
        assert stage_resp.status_code == 200
        assert stage_resp.json()["order"]["status"] == stage

    # 5. Patron submits post-completion rating using QR handoff token
    fb_resp = client.post(
        f"/api/orders/{order['id']}/feedback",
        json={
            "drink_quality_rating": 5,
            "service_experience_rating": 4,
            "comment": "Crisp yuzu balance and friendly handoff.",
            "handoff_token": order["handoff_token"],
        },
    )
    assert fb_resp.status_code == 201
    assert fb_resp.json()["feedback"]["acknowledged"] is False

    # Duplicate submission must return 409 Conflict
    dup_fb = client.post(
        f"/api/orders/{order['id']}/feedback",
        json={
            "drink_quality_rating": 4,
            "service_experience_rating": 4,
            "comment": "Duplicate attempt",
            "handoff_token": order["handoff_token"],
        },
    )
    assert dup_fb.status_code == 409

    # 6. Barista inspects KDS feedback rolling averages & acknowledges
    kds_fb = client.get("/api/feedback", headers=BARISTA_HEADERS)
    assert kds_fb.status_code == 200
    summary = kds_fb.json()["summary"]
    assert summary["total_reviews"] == 1
    assert summary["avg_drink_quality"] == 5.0
    assert summary["avg_service_experience"] == 4.0

    ack_resp = client.patch(f"/api/feedback/{order['id']}/acknowledge", headers=BARISTA_HEADERS)
    assert ack_resp.status_code == 200
    assert ack_resp.json()["feedback"]["acknowledged"] is True


def test_flow_2_palate_sommelier_text_and_multimodal(test_context):
    client, _repo, _ai = test_context

    # Text prompt with dietary limits
    resp = client.post(
        "/api/palate/match",
        json={"prompt": "Need a low-acid iced brew for deep focus plus a gluten-free savory snack"},
    )
    assert resp.status_code == 200
    rec = resp.json()["recommendation"]
    assert "GLUTEN_FREE" in rec["detected_dietary_limits"]
    assert 2 <= len(rec["pairings"]) <= 3
    recommended_skus = {p["sku"] for p in rec["pairings"]}
    assert "GF-GALETTE-07" in recommended_skus

    # Multimodal image-only receipt/bean bag upload
    img_resp = client.post(
        "/api/palate/match",
        json={
            "prompt": "",
            "image_base64": TINY_PNG_B64,
            "image_mime_type": "image/png",
        },
    )
    assert img_resp.status_code == 200
    assert len(img_resp.json()["recommendation"]["pairings"]) >= 1


def test_flow_3_table_connect_cosine_matching_ttl_and_icebreaker(test_context):
    client, repo, _ai = test_context

    # Patron A opts in (React / UX design feedback)
    r_a = client.post(
        "/api/table-connect/opt-in",
        headers=PATRON_A_HEADERS,
        json={
            "display_name": "Maya",
            "table_zone": "Window Bar",
            "focus_tag": "Full-stack React dev seeking UX feedback",
            "focus_description": "Polishing a design system and Figma prototype for a fintech PWA.",
            "open_to_connect": True,
        },
    )
    assert r_a.status_code == 201

    # Patron B opts in with overlapping UX/Figma focus
    r_b = client.post(
        "/api/table-connect/opt-in",
        headers=PATRON_B_HEADERS,
        json={
            "display_name": "Rohan",
            "table_zone": "Communal Oak Table",
            "focus_tag": "Product designer reviewing Figma prototypes",
            "focus_description": "Happy to trade UX feedback on React web apps over coffee.",
            "open_to_connect": True,
        },
    )
    assert r_b.status_code == 201
    matches_for_b = r_b.json()["matches"]
    assert len(matches_for_b) == 1
    assert matches_for_b[0]["uid"] == "patron-a"
    assert matches_for_b[0]["similarity_pct"] > 0

    # Patron C posts DND (open_to_connect=False) — must never appear in matches
    r_c = client.post(
        "/api/table-connect/opt-in",
        headers=PATRON_C_HEADERS,
        json={
            "display_name": "Elena",
            "table_zone": "Quiet Library Corner",
            "focus_tag": "Focus reading - DND",
            "focus_description": "Deep solo reading session on Figma UX systems, please do not disturb.",
            "open_to_connect": False,
        },
    )
    assert r_c.status_code == 201
    assert r_c.json()["matches"] == []

    # Generate Gemini contextual icebreaker between A and B
    ice = client.post(
        "/api/table-connect/icebreaker",
        headers=PATRON_B_HEADERS,
        json={"peer_uid": "patron-a"},
    )
    assert ice.status_code == 200
    assert "Maya" in ice.json()["icebreaker"]["icebreaker_prompt"]

    # ADR-003: Simulate 2-hour TTL expiration on Patron A -> immediately hidden from matches
    repo.community_vibes["patron-a"]["expires_at"] = utc_now() - timedelta(minutes=1)
    after_expiry = client.get("/api/table-connect/matches", headers=PATRON_B_HEADERS)
    assert after_expiry.status_code == 200
    assert after_expiry.json()["matches"] == []


def test_flow_4_ambient_triage_and_staff_resolution(test_context):
    client, _repo, _ai = test_context

    report = client.post(
        "/api/ambient/report",
        json={
            "zone": "Main Espresso Lounge",
            "decibels": 88.4,
            "feedback_type": "ACOUSTIC",
            "raw_message": "Grinder and speaker feedback loop is way too loud for calls.",
        },
    )
    assert report.status_code == 201
    log = report.json()["log"]
    assert log["severity"] == "CRITICAL"
    assert log["resolved"] is False

    # Patron cannot resolve staff alert
    forbidden = client.patch(f"/api/ambient/{log['id']}/resolve", headers=PATRON_A_HEADERS)
    assert forbidden.status_code == 403

    # Barista resolves staff alert
    resolved = client.patch(f"/api/ambient/{log['id']}/resolve", headers=BARISTA_HEADERS)
    assert resolved.status_code == 200
    assert resolved.json()["log"]["resolved"] is True


def test_edge_cases_and_malformed_input_rejections(test_context):
    client, repo, _ai = test_context

    # 1. Human confirmation guardrail on orders
    no_confirm = client.post(
        "/api/orders",
        headers=PATRON_A_HEADERS,
        json={
            "customer_name": "Dev",
            "channel": "MOBILE_PWA",
            "confirmed_by_human": False,
            "items": [{"sku": "CB-TONIC-01", "quantity": 1}],
        },
    )
    assert no_confirm.status_code == 400

    # 2. Patron cannot spoof COUNTER_POS channel
    spoof_pos = client.post(
        "/api/orders",
        headers=PATRON_A_HEADERS,
        json={
            "customer_name": "Spoof",
            "channel": "COUNTER_POS",
            "confirmed_by_human": True,
            "items": [{"sku": "CB-TONIC-01", "quantity": 1}],
        },
    )
    assert spoof_pos.status_code == 403

    # 3. Atomic stock check: insufficient stock leaves other item's stock untouched
    repo.menu_items["POUR-GEISHA-04"]["stock_count"] = 1
    before_tonic = repo.menu_items["CB-TONIC-01"]["stock_count"]
    out_of_stock = client.post(
        "/api/orders",
        headers=PATRON_A_HEADERS,
        json={
            "customer_name": "OverOrder",
            "channel": "MOBILE_PWA",
            "confirmed_by_human": True,
            "items": [
                {"sku": "CB-TONIC-01", "quantity": 1},
                {"sku": "POUR-GEISHA-04", "quantity": 5},
            ],
        },
    )
    assert out_of_stock.status_code == 400
    assert repo.menu_items["CB-TONIC-01"]["stock_count"] == before_tonic

    # 4. Empty palate request rejected
    assert client.post("/api/palate/match", json={"prompt": ""}).status_code == 400

    # 5. Unsupported image MIME type (SVG XSS risk) rejected
    bad_mime = client.post(
        "/api/palate/match",
        json={
            "prompt": "Check this image",
            "image_base64": TINY_PNG_B64,
            "image_mime_type": "image/svg+xml",
        },
    )
    assert bad_mime.status_code == 400

    # 6. Malformed base64 rejected
    bad_b64 = client.post(
        "/api/palate/match",
        json={
            "prompt": "Check broken image",
            "image_base64": "%%%not-valid-base64%%%",
            "image_mime_type": "image/png",
        },
    )
    assert bad_b64.status_code == 400

    # 7. Out-of-bounds feedback rating rejected by Pydantic (422)
    bad_rating = client.post(
        "/api/orders/nonexistent/feedback",
        json={
            "drink_quality_rating": 6,
            "service_experience_rating": 0,
            "comment": "Invalid bounds",
        },
    )
    assert bad_rating.status_code == 422

    # 8. Unknown QR handoff token returns 404
    assert client.get("/api/orders/handoff/unknown-token-123").status_code == 404

    # 9. Non-staff patron cannot list all KDS feedback
    assert client.get("/api/feedback", headers=PATRON_A_HEADERS).status_code == 403
