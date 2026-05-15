import csv
import io
import json
import base64
from datetime import datetime, timezone

import requests

import os

# ── Graph API credentials ──────────────────────────────────────────────────
TENANT_ID     = "409ee6a5-574c-426f-a6d6-d0f1ebd021fd"
CLIENT_ID     = "cfce36e1-4646-4643-9a6a-2111f6ccfe72"
CLIENT_SECRET = os.environ["GRAPH_SECRET"]
SENDER        = "aceron@censys.com.mx"

# ── GitHub CSV storage ─────────────────────────────────────────────────────
GITHUB_TOKEN    = os.environ["GH_PAT"]
GITHUB_REPO     = "maxceca/pmo-hub"
GITHUB_CSV_PATH = "data/registros_proyeccion.csv"

CSV_HEADERS = [
    "Fecha Reporte", "PM", "Email PM", "Proyecto", "Nombre", "Cliente",
    "Causa", "Monto", "Nuevo Mes", "Nuevo Año", "Nueva Fecha",
    "Moneda", "Comentario",
]

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
}

MONTH_NAMES = {
    1:"Enero", 2:"Febrero", 3:"Marzo", 4:"Abril", 5:"Mayo", 6:"Junio",
    7:"Julio", 8:"Agosto", 9:"Septiembre", 10:"Octubre", 11:"Noviembre", 12:"Diciembre",
}

FIXED_RECIPIENTS = [
    {"emailAddress": {"address": "aceron@censys.com.mx",                 "name": "Alan Cerón Cardonne"}},
    {"emailAddress": {"address": "frodriguez@censystems.com.mx",         "name": "Fabiola Rodríguez Granados"}},
    {"emailAddress": {"address": "gsantamaria@censys.com.mx",            "name": "Gabriel Santamaría Pacheco"}},
    {"emailAddress": {"address": "iochoa@censystems.com.mx",             "name": "Ingrid Ochoa"}},
    {"emailAddress": {"address": "icastilla@censys.com.mx",              "name": "Irving Castilla Castillo"}},
    {"emailAddress": {"address": "jromero@censystems.com.mx",            "name": "José Juan Romero Solares"}},
    {"emailAddress": {"address": "oosorio@censystems.com.mx",            "name": "Omar Osorio Martínez"}},
    {"emailAddress": {"address": "valcaraz@censystems.com.mx",           "name": "Víctor Manuel Alcaraz Miranda"}},
    {"emailAddress": {"address": "lgomez@censystems.com.mx",             "name": "Lázaro Gómez Ontiveros"}},
    {"emailAddress": {"address": "proyectos_finanzas@censystems.com.mx", "name": "Proyectos Finanzas"}},
]

GH_HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}
GH_API = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{GITHUB_CSV_PATH}"


# ── GitHub CSV helpers ─────────────────────────────────────────────────────
def _read_csv_from_github():
    """Returns (current_csv_text, sha). sha is None if file doesn't exist."""
    r = requests.get(GH_API, headers=GH_HEADERS, timeout=15)
    if r.status_code == 404:
        return None, None
    r.raise_for_status()
    data = r.json()
    content = base64.b64decode(data["content"]).decode("utf-8-sig")
    return content, data["sha"]


def _append_to_csv(current_text, new_row):
    """Appends new_row to existing CSV text (or creates with headers)."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")

    if current_text is None:
        writer.writerow(CSV_HEADERS)
    else:
        buf.write(current_text.rstrip("\n") + "\n")

    writer.writerow(new_row)
    return buf.getvalue()


def _save_csv_to_github(csv_text, sha, commit_msg):
    payload = {
        "message": commit_msg,
        "content": base64.b64encode(csv_text.encode("utf-8")).decode("ascii"),
    }
    if sha:
        payload["sha"] = sha
    r = requests.put(GH_API, headers=GH_HEADERS, json=payload, timeout=20)
    if not r.ok:
        raise RuntimeError(f"Error guardando CSV en GitHub: {r.status_code} {r.text}")


# ── Graph API token ────────────────────────────────────────────────────────
def _graph_token():
    r = requests.post(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data={
            "grant_type":    "client_credentials",
            "client_id":     CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope":         "https://graph.microsoft.com/.default",
        },
        timeout=20,
    )
    r.raise_for_status()
    return r.json()["access_token"]


# ── Email ──────────────────────────────────────────────────────────────────
def _email_html(d, ts):
    mes = MONTH_NAMES.get(d["nuevoMes"], str(d["nuevoMes"]))
    moneda = d.get("moneda", "")
    monto_fmt = f"${d['monto']:,.2f}{' ' + moneda if moneda else ''}"
    return f"""
<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1a1a2e;margin:0;padding:0;">
<div style="max-width:640px;margin:32px auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
  <div style="background:#003366;padding:24px 32px;">
    <h2 style="margin:0;color:#fff;font-size:20px;">Cambio en Proyección de Facturación</h2>
    <p style="margin:6px 0 0;color:#b3c6e0;font-size:13px;">Notificación automática · {ts}</p>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f4f7fb;">
        <td style="padding:10px 14px;font-weight:600;width:42%;border-bottom:1px solid #e0e0e0;">Proyecto</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">{d['proyecto']}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Nombre</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">{d['nombre']}</td>
      </tr>
      <tr style="background:#f4f7fb;">
        <td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Cliente</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">{d['nombreCliente']}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">PM Responsable</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">{d['pmNombre']}</td>
      </tr>
      <tr style="background:#f4f7fb;">
        <td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Causa del Cambio</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;color:#c0392b;font-weight:600;">{d['causa']}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Monto Afectado</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;font-size:16px;font-weight:700;color:#003366;">{monto_fmt}</td>
      </tr>
      <tr style="background:#f4f7fb;">
        <td style="padding:10px 14px;font-weight:600;">Nueva Fecha de Proyección</td>
        <td style="padding:10px 14px;font-weight:700;color:#27ae60;">{mes} {d['nuevoAnio']}</td>
      </tr>
    </table>
    <div style="margin-top:24px;background:#f9f9f9;border-left:4px solid #003366;padding:16px 20px;border-radius:0 6px 6px 0;">
      <p style="margin:0 0 6px;font-weight:600;font-size:13px;color:#003366;">Comentario del PM</p>
      <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">{d['comentario']}</p>
    </div>
  </div>
  <div style="background:#f4f7fb;padding:14px 32px;font-size:12px;color:#888;text-align:center;">
    CenSystems · Sistema de Proyección de Facturación · {ts}
  </div>
</div>
</body></html>
"""


def _send_email(token, d, html):
    mes = MONTH_NAMES.get(d["nuevoMes"], str(d["nuevoMes"]))
    subject = (
        f"[Cambio de Proyección] {d['proyecto']} – {d['nombreCliente']} "
        f"| {d['causa']} | {mes} {d['nuevoAnio']}"
    )

    recipients = list(FIXED_RECIPIENTS)
    fixed_addrs = {r["emailAddress"]["address"].lower() for r in FIXED_RECIPIENTS}
    pm_email = d.get("pmEmail", "").strip().lower()
    if pm_email and pm_email not in fixed_addrs:
        recipients.append({"emailAddress": {"address": pm_email, "name": d.get("pmNombre", "")}})

    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html},
            "toRecipients": recipients,
        },
        "saveToSentItems": True,
    }
    r = requests.post(
        f"https://graph.microsoft.com/v1.0/users/{SENDER}/sendMail",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=20,
    )
    if r.status_code not in (200, 202):
        raise RuntimeError(f"Error al enviar correo: {r.status_code} {r.text}")


# ── Handler ────────────────────────────────────────────────────────────────
def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    try:
        d = json.loads(event.get("body") or "{}")

        required = ["proyecto", "nombre", "nombreCliente", "pmNombre", "pmEmail",
                    "causa", "monto", "nuevoMes", "nuevoAnio", "comentario"]
        missing = [f for f in required if not str(d.get(f, "")).strip()]
        if missing:
            return {
                "statusCode": 400, "headers": CORS,
                "body": json.dumps({"error": f"Faltan campos: {', '.join(missing)}"}),
            }

        now = datetime.now(timezone.utc)
        ts = now.strftime("%Y-%m-%d %H:%M UTC")
        nueva_fecha = f"{d['nuevoAnio']}-{int(d['nuevoMes']):02d}"

        row = [
            ts, d["pmNombre"], d["pmEmail"],
            d["proyecto"], d["nombre"], d["nombreCliente"],
            d["causa"], float(d["monto"]),
            int(d["nuevoMes"]), int(d["nuevoAnio"]), nueva_fecha,
            d.get("moneda", ""), d["comentario"],
        ]

        # 1. Save to GitHub CSV
        current_text, sha = _read_csv_from_github()
        updated_csv = _append_to_csv(current_text, row)
        commit_msg = f"Proyección: {d['proyecto']} – {d['causa']} ({nueva_fecha})"
        _save_csv_to_github(updated_csv, sha, commit_msg)

        # 2. Send email
        token = _graph_token()
        html = _email_html(d, ts)
        _send_email(token, d, html)

        return {
            "statusCode": 200, "headers": CORS,
            "body": json.dumps({"success": True, "message": "Notificación enviada correctamente."}),
        }

    except Exception as e:
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": str(e)})}
