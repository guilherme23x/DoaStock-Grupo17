# =====================================================================================
# DOASTOCK - BACKEND ADAPTADO PARA VERCEL SERVERLESS
# Salve este arquivo dentro de uma pasta chamada "api" na raiz do projeto (api/index.py)
# =====================================================================================

import os
import uuid
import bcrypt
import jwt
from datetime import datetime, timedelta, date
from typing import Optional, Literal

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, field_validator
from supabase import create_client, Client
import httpx

# Em ambiente Vercel, as variáveis de ambiente são injetadas automaticamente no painel.
# Não precisamos do load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGO = "HS256"
JWT_TTL_DAYS = 7
SENDGRID_KEY = os.getenv("SENDGRID_API_KEY", "")

# Verifica se as credenciais do Supabase estão configuradas para evitar erros de inicialização
if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

bearer = HTTPBearer()

# Configura o FastAPI para rodar sob o prefixo /api (Padrão Vercel)
app = FastAPI(
    title="DoaStock API (Vercel)", docs_url="/api/docs", openapi_url="/api/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*"
    ],  # Como o front e back estão no mesmo domínio (Vercel), podemos liberar
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Schemas (Mesmos do arquivo original) ─────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserCreate(BaseModel):
    nome: str
    email: EmailStr
    password: str
    role: Literal["coordinator", "volunteer", "donor"] = "volunteer"


class ItemCreate(BaseModel):
    nome: str
    categoria: Literal["alimentos", "higiene", "limpeza", "vestuario", "outros"]
    unidade_medida: str = "un"
    codigo_barras: Optional[str] = None


class BatchCreate(BaseModel):
    nome: str
    categoria: str
    unidade_medida: str = "un"
    quantidade: int
    data_validade: date
    barcode: Optional[str] = None
    doador: Optional[str] = None
    observacao: Optional[str] = None


class MovementExitCreate(BaseModel):
    item_id: str
    quantidade: int
    destinatario: Optional[str] = None
    observacao: Optional[str] = None


class NeedAlertCreate(BaseModel):
    item_id: str
    quantidade_minima: int
    mensagem: Optional[str] = None


class NeedAlertPatch(BaseModel):
    is_active: bool


# ─── Auth Helpers ─────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def build_token(user_id: str, role: str, org_id: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "org_id": org_id,
        "exp": datetime.utcnow() + timedelta(days=JWT_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    return decode_token(credentials.credentials)


def require_coordinator(claims: dict = Depends(require_auth)) -> dict:
    if claims.get("role") != "coordinator":
        raise HTTPException(status_code=403, detail="Acesso restrito a coordenadores")
    return claims


# ─── Routes (Todas agora começam com /api) ────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "environment": "vercel"}


@app.post("/api/auth/login")
def login(body: LoginRequest):
    result = supabase.table("users").select("*").eq("email", body.email).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="E-mail não cadastrado no sistema.")
    user = result.data[0]

    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=401, detail="Senha incorreta para este usuário."
        )

    token = build_token(user["id"], user["role"], user["org_id"])
    org = (
        supabase.table("organizations")
        .select("nome")
        .eq("id", user["org_id"])
        .execute()
    )
    org_name = org.data[0]["nome"] if org.data else "Organização Desconhecida"

    return {
        "access_token": token,
        "user": {
            "id": user["id"],
            "nome": user["nome"],
            "email": user["email"],
            "role": user["role"],
            "org_id": user["org_id"],
            "org_name": org_name,
        },
    }


@app.get("/api/dashboard/summary")
def get_dashboard_summary(claims: dict = Depends(require_auth)):
    org_id = claims["org_id"]
    today_str = date.today().isoformat()

    batches = (
        supabase.table("batches")
        .select("id")
        .eq("org_id", org_id)
        .eq("status", "ativo")
        .execute()
    )
    movements_today = (
        supabase.table("movements")
        .select("id", count="exact")
        .eq("org_id", org_id)
        .gte("created_at", today_str)
        .execute()
    )
    items_by_cat = (
        supabase.table("inventory_by_category")
        .select("*")
        .eq("org_id", org_id)
        .execute()
    )
    critical = (
        supabase.table("batches")
        .select("id", count="exact")
        .eq("org_id", org_id)
        .eq("status", "ativo")
        .lte("data_validade", (date.today() + timedelta(days=7)).isoformat())
        .execute()
    )

    return {
        "total_batches": len(batches.data),
        "critical_items": critical.count or 0,
        "movements_today": movements_today.count or 0,
        "by_category": items_by_cat.data or [],
    }


@app.get("/api/inventory")
def get_inventory(claims: dict = Depends(require_auth)):
    result = (
        supabase.table("inventory_view")
        .select("*")
        .eq("org_id", claims["org_id"])
        .execute()
    )
    return result.data


@app.get("/api/items")
def list_items(claims: dict = Depends(require_auth)):
    result = (
        supabase.table("items")
        .select("*")
        .eq("org_id", claims["org_id"])
        .order("nome")
        .execute()
    )
    return result.data


@app.get("/api/items/barcode/{barcode}")
def find_by_barcode(barcode: str, claims: dict = Depends(require_auth)):
    result = (
        supabase.table("items")
        .select("*")
        .eq("org_id", claims["org_id"])
        .eq("codigo_barras", barcode)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Não encontrado")
    return result.data[0]


@app.post("/api/items", status_code=201)
def create_item(body: ItemCreate, claims: dict = Depends(require_auth)):
    payload = {
        "id": str(uuid.uuid4()),
        "org_id": claims["org_id"],
        "nome": body.nome,
        "categoria": body.categoria,
        "unidade_medida": body.unidade_medida,
        "codigo_barras": body.codigo_barras,
    }
    result = supabase.table("items").insert(payload).execute()
    return result.data[0]


@app.get("/api/batches/expiring")
def get_expiring_batches(days: int = 15, claims: dict = Depends(require_auth)):
    threshold = (date.today() + timedelta(days=days)).isoformat()
    today_str = date.today().isoformat()
    result = (
        supabase.table("batch_details_view")
        .select("*")
        .eq("org_id", claims["org_id"])
        .eq("status", "ativo")
        .gte("data_validade", today_str)
        .lte("data_validade", threshold)
        .order("data_validade")
        .execute()
    )
    return result.data


@app.post("/api/batches", status_code=201)
def register_batch(body: BatchCreate, claims: dict = Depends(require_auth)):
    item_result = (
        supabase.table("items")
        .select("id")
        .eq("org_id", claims["org_id"])
        .eq("nome", body.nome)
        .execute()
    )
    if item_result.data:
        item_id = item_result.data[0]["id"]
    else:
        item_id = str(uuid.uuid4())
        supabase.table("items").insert(
            {
                "id": item_id,
                "org_id": claims["org_id"],
                "nome": body.nome,
                "categoria": body.categoria,
                "unidade_medida": body.unidade_medida,
                "codigo_barras": body.barcode,
            }
        ).execute()

    batch_id = str(uuid.uuid4())
    supabase.table("batches").insert(
        {
            "id": batch_id,
            "org_id": claims["org_id"],
            "item_id": item_id,
            "quantidade": body.quantidade,
            "data_validade": body.data_validade.isoformat(),
            "status": "ativo",
            "doador": body.doador,
        }
    ).execute()
    supabase.table("movements").insert(
        {
            "id": str(uuid.uuid4()),
            "org_id": claims["org_id"],
            "batch_id": batch_id,
            "item_id": item_id,
            "tipo": "entrada",
            "quantidade": body.quantidade,
            "responsavel_id": claims["sub"],
            "observacao": body.observacao,
        }
    ).execute()
    return {"id": batch_id}


@app.get("/api/movements")
def list_movements(limit: int = 100, claims: dict = Depends(require_auth)):
    result = (
        supabase.table("movement_details_view")
        .select("*")
        .eq("org_id", claims["org_id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data


@app.post("/api/movements/exit", status_code=201)
def register_exit(body: MovementExitCreate, claims: dict = Depends(require_auth)):
    batches = (
        supabase.table("batches")
        .select("id, quantidade")
        .eq("org_id", claims["org_id"])
        .eq("item_id", body.item_id)
        .eq("status", "ativo")
        .order("data_validade")
        .execute()
    )
    total_available = sum(b["quantidade"] for b in batches.data)

    if total_available < body.quantidade:
        raise HTTPException(
            status_code=400,
            detail=f"Estoque insuficiente. Disponível: {total_available}",
        )

    remaining = body.quantidade
    for batch in batches.data:
        if remaining <= 0:
            break
        deduct = min(remaining, batch["quantidade"])
        new_qty = batch["quantidade"] - deduct
        updates = {
            "quantidade": new_qty,
            "status": "distribuido" if new_qty == 0 else "ativo",
        }
        supabase.table("batches").update(updates).eq("id", batch["id"]).execute()
        remaining -= deduct

    movement_id = str(uuid.uuid4())
    supabase.table("movements").insert(
        {
            "id": movement_id,
            "org_id": claims["org_id"],
            "item_id": body.item_id,
            "tipo": "saida",
            "quantidade": body.quantidade,
            "responsavel_id": claims["sub"],
            "observacao": body.observacao or body.destinatario,
        }
    ).execute()
    return {"id": movement_id}


@app.get("/api/public/needs")
def get_public_needs(org_id: Optional[str] = None):
    query = supabase.table("public_needs_view").select("*").eq("is_active", True)
    if org_id:
        query = query.eq("org_id", org_id)
    result = query.limit(10).execute()

    org_info = {}
    if result.data:
        org_res = (
            supabase.table("organizations")
            .select("nome, endereco, horario_recebimento")
            .eq("id", result.data[0].get("org_id"))
            .execute()
        )
        if org_res.data:
            org_info = {
                "org_name": org_res.data[0]["nome"],
                "address": org_res.data[0].get("endereco", ""),
                "receiving_hours": org_res.data[0].get("horario_recebimento", ""),
            }
    return {"needs": result.data, **org_info}


@app.get("/api/need-alerts")
def list_need_alerts(claims: dict = Depends(require_auth)):
    return (
        supabase.table("need_alert_details_view")
        .select("*")
        .eq("org_id", claims["org_id"])
        .order("created_at", desc=True)
        .execute()
        .data
    )


@app.post("/api/need-alerts", status_code=201)
def create_need_alert(
    body: NeedAlertCreate, claims: dict = Depends(require_coordinator)
):
    payload = {
        "id": str(uuid.uuid4()),
        "org_id": claims["org_id"],
        "item_id": body.item_id,
        "quantidade_minima": body.quantidade_minima,
        "mensagem": body.mensagem,
        "is_active": True,
    }
    return supabase.table("need_alerts").insert(payload).execute().data[0]


@app.patch("/api/need-alerts/{alert_id}")
def patch_need_alert(
    alert_id: str, body: NeedAlertPatch, claims: dict = Depends(require_coordinator)
):
    supabase.table("need_alerts").update({"is_active": body.is_active}).eq(
        "id", alert_id
    ).eq("org_id", claims["org_id"]).execute()
    return {"updated": True}


@app.delete("/api/need-alerts/{alert_id}", status_code=204)
def delete_need_alert(alert_id: str, claims: dict = Depends(require_coordinator)):
    supabase.table("need_alerts").delete().eq("id", alert_id).eq(
        "org_id", claims["org_id"]
    ).execute()


@app.get("/api/users")
def list_users(claims: dict = Depends(require_coordinator)):
    return (
        supabase.table("users")
        .select("id, nome, email, role, created_at")
        .eq("org_id", claims["org_id"])
        .order("nome")
        .execute()
        .data
    )


@app.post("/api/users", status_code=201)
def create_user(body: UserCreate, claims: dict = Depends(require_coordinator)):
    existing = supabase.table("users").select("id").eq("email", body.email).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado")
    payload = {
        "id": str(uuid.uuid4()),
        "org_id": claims["org_id"],
        "nome": body.nome,
        "email": body.email,
        "password_hash": hash_password(body.password),
        "role": body.role,
    }
    user = supabase.table("users").insert(payload).execute().data[0]
    return {
        "id": user["id"],
        "nome": user["nome"],
        "email": user["email"],
        "role": user["role"],
    }


@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: str, claims: dict = Depends(require_coordinator)):
    if user_id == claims["sub"]:
        raise HTTPException(
            status_code=400, detail="Não é possível remover o próprio usuário"
        )
    supabase.table("users").delete().eq("id", user_id).eq(
        "org_id", claims["org_id"]
    ).execute()


# ─── Rota CRON do Vercel (Substitui o APScheduler) ───────────
@app.get("/api/cron/expiry")
async def trigger_expiry_cron():
    """
    O Vercel vai bater nesta rota todos os dias às 06:00
    para atualizar lotes expirados e enviar e-mails.
    """
    today_str = date.today().isoformat()
    threshold_15 = (date.today() + timedelta(days=15)).isoformat()

    # 1. Atualizar para expirado os itens que já passaram da validade
    expired_batches = (
        supabase.table("batches")
        .select("id")
        .eq("status", "ativo")
        .lt("data_validade", today_str)
        .execute()
    )
    for batch in expired_batches.data:
        supabase.table("batches").update({"status": "expirado"}).eq(
            "id", batch["id"]
        ).execute()

    # 2. Enviar e-mails para os próximos a vencer
    expiring = (
        supabase.table("batch_details_view")
        .select("*")
        .eq("status", "ativo")
        .gte("data_validade", today_str)
        .lte("data_validade", threshold_15)
        .execute()
    )
    if expiring.data and SENDGRID_KEY:
        org_batches = {}
        for batch in expiring.data:
            org_batches.setdefault(batch["org_id"], []).append(batch)

        async with httpx.AsyncClient() as client:
            for org_id, batches in org_batches.items():
                coordinators = (
                    supabase.table("users")
                    .select("email, nome")
                    .eq("org_id", org_id)
                    .eq("role", "coordinator")
                    .execute()
                )
                for coord in coordinators.data:
                    items_html = "".join(
                        f"<li>{b['item_nome']} — {b['quantidade']} un — vence {b['data_validade']}</li>"
                        for b in batches[:10]
                    )
                    body = {
                        "personalizations": [{"to": [{"email": coord["email"]}]}],
                        "from": {"email": "noreply@doastock.org", "name": "DoaStock"},
                        "subject": f"⚠️ Alerta de validade – {len(batches)} lote(s) próximos ao vencimento",
                        "content": [
                            {
                                "type": "text/html",
                                "value": f"<p>Olá, {coord['nome']}.</p><p>Lotes próximos ao vencimento:</p><ul>{items_html}</ul>",
                            }
                        ],
                    }
                    await client.post(
                        "https://api.sendgrid.com/v3/mail/send",
                        json=body,
                        headers={"Authorization": f"Bearer {SENDGRID_KEY}"},
                    )

    return {
        "status": "Cron executado com sucesso",
        "expirados_atualizados": len(expired_batches.data),
    }
