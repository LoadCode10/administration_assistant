from fastapi import Request
import models


def get_client_ip(request: Request) -> str | None:
  forwarded = request.headers.get("x-forwarded-for")
  if forwarded:
    return forwarded.split(",")[0].strip()
  return request.client.host if request.client else None

def write_log(
    db, request, user, action, entity_type=None, entity_id=None, detail=None
):
  db.add(models.Log(
    id_user=user.id_user if user else None,
    user_role= user.role if user else None,
    action=action,
    entity_type=entity_type,
    entity_id=entity_id,
    detail=detail,
    ip_address=get_client_ip(request),
    user_agent=request.headers.get("user-agent"),
    method=request.method,
    path=str(request.url.path),
  ))

def record_usage(db, user, feature: str, model: str, tokens: dict) -> None:
  db.add(models.TokenUsage(
    id_user=user.id_user if user else None,
    feature=feature,
    model=model,
    prompt_tokens=tokens.get("prompt_tokens") or 0,
    output_tokens=tokens.get("output_tokens") or 0,
  ))