"""Strict Pydantic v2 request, response, and Gemini response_schema models."""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .sanitizer import sanitize_text

OrderStatus = Literal[
    "GRINDING_EXTRACTION",
    "STEAMING_POUR",
    "QUALITY_PLATING",
    "READY_PICKUP",
    "COMPLETED",
]
OrderChannel = Literal["COUNTER_POS", "MOBILE_PWA"]
SeverityLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
FeedbackSignalType = Literal["ACOUSTIC", "WIFI", "CLIMATE", "MUSIC", "SERVICE"]


# --- Gemini Structured Output Schemas (response_schema) ---
class WaitTimePrediction(BaseModel):
    estimated_seconds: int = Field(..., ge=60, le=900)
    complexity_score: float = Field(..., ge=1.0, le=5.0)
    reasoning: str = Field(..., max_length=280)
    recommended_station: str = Field(..., max_length=60)


class PalatePairing(BaseModel):
    sku: str = Field(..., max_length=40)
    item_name: str = Field(..., max_length=120)
    match_score: int = Field(..., ge=70, le=100)
    flavor_rationale: str = Field(..., max_length=260)
    suggested_modifier: str = Field("", max_length=120)


class PalateRecommendationResponse(BaseModel):
    inferred_mood: str = Field(..., max_length=100)
    detected_dietary_limits: List[str] = Field(default_factory=list, max_length=8)
    sommelier_summary: str = Field(..., max_length=400)
    pairings: List[PalatePairing] = Field(default_factory=list, max_length=3)
    safety_notice: Optional[str] = None


class IcebreakerResponse(BaseModel):
    shared_ground: str = Field(..., max_length=240)
    icebreaker_prompt: str = Field(..., max_length=280)
    suggested_table_action: str = Field(..., max_length=200)


class AmbientTriageOutput(BaseModel):
    severity: SeverityLevel
    ai_category: str = Field(..., max_length=60)
    ai_corrective_action: str = Field(..., max_length=260)


# --- REST API Request Schemas ---
class OrderLineItemIn(BaseModel):
    sku: str = Field(..., min_length=2, max_length=40)
    quantity: int = Field(1, ge=1, le=20)
    modifiers: str = Field("", max_length=140)

    @field_validator("modifiers")
    @classmethod
    def clean_modifiers(cls, v: str) -> str:
        return sanitize_text(v, max_length=140)


class CreateOrderRequest(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=80)
    channel: OrderChannel = "MOBILE_PWA"
    table_code: Optional[str] = Field(None, max_length=40)
    active_baristas: int = Field(2, ge=1, le=8)
    confirmed_by_human: bool = Field(
        True,
        description="Explicit human confirmation before submitting an order ticket.",
    )
    items: List[OrderLineItemIn] = Field(..., min_length=1, max_length=15)

    @field_validator("customer_name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        cleaned = sanitize_text(v, max_length=80)
        if not cleaned:
            raise ValueError("customer_name cannot be empty")
        return cleaned

    @field_validator("table_code")
    @classmethod
    def clean_table(cls, v: Optional[str]) -> Optional[str]:
        return sanitize_text(v, max_length=40) if v else None


class UpdateStageRequest(BaseModel):
    stage: OrderStatus
    barista_note: str = Field("", max_length=160)

    @field_validator("barista_note")
    @classmethod
    def clean_note(cls, v: str) -> str:
        return sanitize_text(v, max_length=160)


class PalateMatchRequest(BaseModel):
    prompt: str = Field("", max_length=600)
    image_base64: Optional[str] = Field(None, max_length=6_000_000)
    image_mime_type: Optional[str] = Field(None, max_length=50)

    @field_validator("prompt")
    @classmethod
    def clean_prompt(cls, v: str) -> str:
        return sanitize_text(v, max_length=600)


class TableConnectOptInRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=60)
    table_zone: str = Field(..., min_length=2, max_length=80)
    focus_tag: str = Field(..., min_length=3, max_length=120)
    focus_description: str = Field(..., min_length=5, max_length=320)
    open_to_connect: bool = True

    @field_validator("display_name", "table_zone", "focus_tag", "focus_description")
    @classmethod
    def clean_fields(cls, v: str) -> str:
        cleaned = sanitize_text(v, max_length=320)
        if not cleaned:
            raise ValueError("Field cannot be blank")
        return cleaned


class IcebreakerRequest(BaseModel):
    peer_uid: str = Field(..., min_length=1, max_length=128)


class AmbientReportRequest(BaseModel):
    zone: str = Field(..., min_length=2, max_length=80)
    decibels: Optional[float] = Field(None, ge=20.0, le=130.0)
    feedback_type: FeedbackSignalType = "SERVICE"
    raw_message: str = Field(..., min_length=3, max_length=320)

    @field_validator("zone", "raw_message")
    @classmethod
    def clean_text(cls, v: str) -> str:
        cleaned = sanitize_text(v, max_length=320)
        if not cleaned:
            raise ValueError("Field cannot be blank")
        return cleaned


class OrderFeedbackRequest(BaseModel):
    drink_quality_rating: int = Field(..., ge=1, le=5)
    service_experience_rating: int = Field(..., ge=1, le=5)
    comment: str = Field("", max_length=500)
    handoff_token: Optional[str] = Field(None, max_length=64)

    @field_validator("comment")
    @classmethod
    def clean_comment(cls, v: str) -> str:
        return sanitize_text(v, max_length=500)


class HealthResponse(BaseModel):
    status: str
    service: str
    datastore: str
    timestamp: datetime
