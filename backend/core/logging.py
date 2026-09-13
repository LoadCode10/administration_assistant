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