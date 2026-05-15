const { Buffer } = require('buffer');

const TENANT_ID = '409ee6a5-574c-426f-a6d6-d0f1ebd021fd';
const CLIENT_ID = 'cfce36e1-4646-4643-9a6a-2111f6ccfe72';
const SENDER    = 'aceron@censys.com.mx';
const GH_REPO   = 'maxceca/pmo-hub';
const GH_PATH   = 'data/registros_proyeccion.csv';

const CSV_HEADERS = [
  'Fecha Reporte','PM','Email PM','Proyecto','Nombre','Cliente',
  'Causa','Monto','Nuevo Mes','Nuevo Año','Nueva Fecha','Moneda','Comentario',
];

const MONTHS = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const FIXED_TO = [
  { emailAddress: { address: 'aceron@censys.com.mx',                 name: 'Alan Cerón Cardonne' } },
  { emailAddress: { address: 'frodriguez@censystems.com.mx',         name: 'Fabiola Rodríguez Granados' } },
  { emailAddress: { address: 'gsantamaria@censys.com.mx',            name: 'Gabriel Santamaría Pacheco' } },
  { emailAddress: { address: 'iochoa@censystems.com.mx',             name: 'Ingrid Ochoa' } },
  { emailAddress: { address: 'icastilla@censys.com.mx',              name: 'Irving Castilla Castillo' } },
  { emailAddress: { address: 'jromero@censystems.com.mx',            name: 'José Juan Romero Solares' } },
  { emailAddress: { address: 'oosorio@censystems.com.mx',            name: 'Omar Osorio Martínez' } },
  { emailAddress: { address: 'valcaraz@censystems.com.mx',           name: 'Víctor Manuel Alcaraz Miranda' } },
  { emailAddress: { address: 'lgomez@censystems.com.mx',             name: 'Lázaro Gómez Ontiveros' } },
  { emailAddress: { address: 'proyectos_finanzas@censystems.com.mx', name: 'Proyectos Finanzas' } },
];

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function csvRow(values) {
  return values.map(v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

async function getGraphToken() {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: process.env.GRAPH_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(`Graph token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function appendGitHubCSV(row) {
  const ghHeaders = {
    Authorization: `Bearer ${process.env.GH_PAT}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;

  const getRes = await fetch(url, { headers: ghHeaders });
  let sha = null;
  let existing = '';

  if (getRes.ok) {
    const file = await getRes.json();
    sha = file.sha;
    existing = Buffer.from(file.content, 'base64').toString('utf-8').trimEnd();
  } else if (getRes.status === 404) {
    existing = csvRow(CSV_HEADERS);
  } else {
    throw new Error(`GitHub GET error: ${getRes.status}`);
  }

  const updated = existing + '\n' + csvRow(row);
  const body = {
    message: `Proyección: ${row[3]} – ${row[6]}`,
    content: Buffer.from(updated, 'utf-8').toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(url, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(body) });
  if (!putRes.ok) throw new Error(`GitHub PUT error: ${putRes.status} ${await putRes.text()}`);
}

async function sendEmail(token, d, ts) {
  const mes = MONTHS[d.nuevoMes] || d.nuevoMes;
  const moneda = d.moneda || '';
  const monto = `$${Number(d.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${moneda}`.trim();
  const subject = `[Cambio de Proyección] ${d.proyecto} – ${d.nombreCliente} | ${d.causa} | ${mes} ${d.nuevoAnio}`;

  const recipients = [...FIXED_TO];
  const fixed = new Set(FIXED_TO.map(r => r.emailAddress.address.toLowerCase()));
  if (d.pmEmail && !fixed.has(d.pmEmail.toLowerCase())) {
    recipients.push({ emailAddress: { address: d.pmEmail, name: d.pmNombre } });
  }

  const html = `
<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1a1a2e;margin:0;padding:0;">
<div style="max-width:640px;margin:32px auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
  <div style="background:#003366;padding:24px 32px;">
    <h2 style="margin:0;color:#fff;font-size:20px;">Cambio en Proyección de Facturación</h2>
    <p style="margin:6px 0 0;color:#b3c6e0;font-size:13px;">Notificación automática · ${ts}</p>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f4f7fb;"><td style="padding:10px 14px;font-weight:600;width:42%;border-bottom:1px solid #e0e0e0;">Proyecto</td><td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">${d.proyecto}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Nombre</td><td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">${d.nombre}</td></tr>
      <tr style="background:#f4f7fb;"><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Cliente</td><td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">${d.nombreCliente}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">PM Responsable</td><td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;">${d.pmNombre}</td></tr>
      <tr style="background:#f4f7fb;"><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Causa del Cambio</td><td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;color:#c0392b;font-weight:600;">${d.causa}</td></tr>
      <tr><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e0e0e0;">Monto Afectado</td><td style="padding:10px 14px;border-bottom:1px solid #e0e0e0;font-size:16px;font-weight:700;color:#003366;">${monto}</td></tr>
      <tr style="background:#f4f7fb;"><td style="padding:10px 14px;font-weight:600;">Nueva Fecha de Proyección</td><td style="padding:10px 14px;font-weight:700;color:#27ae60;">${mes} ${d.nuevoAnio}</td></tr>
    </table>
    <div style="margin-top:24px;background:#f9f9f9;border-left:4px solid #003366;padding:16px 20px;border-radius:0 6px 6px 0;">
      <p style="margin:0 0 6px;font-weight:600;font-size:13px;color:#003366;">Comentario del PM</p>
      <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${d.comentario}</p>
    </div>
  </div>
  <div style="background:#f4f7fb;padding:14px 32px;font-size:12px;color:#888;text-align:center;">CenSystems · Sistema de Proyección de Facturación · ${ts}</div>
</div></body></html>`;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: recipients },
        saveToSentItems: true,
      }),
    }
  );
  if (![200, 202].includes(res.status)) throw new Error(`sendMail error: ${res.status} ${await res.text()}`);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const d = JSON.parse(event.body || '{}');
    const required = ['proyecto','nombre','nombreCliente','pmNombre','pmEmail','causa','monto','nuevoMes','nuevoAnio','comentario'];
    const missing = required.filter(f => !String(d[f] ?? '').trim());
    if (missing.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Faltan: ${missing.join(', ')}` }) };

    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const nueva_fecha = `${d.nuevoAnio}-${String(d.nuevoMes).padStart(2, '0')}`;

    const row = [
      ts, d.pmNombre, d.pmEmail, d.proyecto, d.nombre, d.nombreCliente,
      d.causa, Number(d.monto), Number(d.nuevoMes), Number(d.nuevoAnio),
      nueva_fecha, d.moneda || '', d.comentario,
    ];

    const [_, token] = await Promise.all([
      appendGitHubCSV(row),
      getGraphToken(),
    ]);

    await sendEmail(token, d, ts);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, message: 'Notificación enviada correctamente.' }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
