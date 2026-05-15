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

// Allowed PM emails — validated on server to prevent impersonation
const ALLOWED_PM_EMAILS = new Set([
  'aceron@censys.com.mx',
  'frodriguez@censystems.com.mx',
  'gsantamaria@censys.com.mx',
  'iochoa@censystems.com.mx',
  'icastilla@censys.com.mx',
  'jromero@censystems.com.mx',
  'oosorio@censystems.com.mx',
  'valcaraz@censystems.com.mx',
]);

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

const ALLOWED_CAUSES = new Set([
  'Pendiente de Orden de Compra',
  'Cambio de fecha de migración por el cliente',
  'Atraso en implementación',
  'Solicitud de cliente',
  'Equipo atrasado en salida de fábrica',
  'Otra',
]);

const CORS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Escape HTML to prevent XSS in email body
function htmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Sanitize CSV cell — escape formula injection prefixes
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(',') || s.includes('"') || s.includes('\n'))
    s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
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
  if (!data.access_token) throw new Error('Error al autenticar con el servicio de correo.');
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
    throw new Error('Error al acceder al registro de notificaciones.');
  }

  const updated = existing + '\n' + csvRow(row);
  const body = {
    message: `Proyección: ${row[3]} – ${row[6]}`,
    content: Buffer.from(updated, 'utf-8').toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(url, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(body) });
  if (!putRes.ok) throw new Error('Error al guardar el registro. Intenta de nuevo.');
}

async function sendEmail(token, d, ts) {
  const mes     = MONTHS[d.nuevoMes] || d.nuevoMes;
  const moneda  = htmlEsc(d.moneda || '');
  const monto   = `$${Number(d.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${moneda}`.trim();
  const subject = `[Cambio de Proyección] ${htmlEsc(d.proyecto)} – ${htmlEsc(d.nombreCliente)} | ${htmlEsc(d.causa)} | ${mes} ${d.nuevoAnio}`;

  const recipients = [...FIXED_TO];
  const fixed = new Set(FIXED_TO.map(r => r.emailAddress.address.toLowerCase()));
  if (d.pmEmail && !fixed.has(d.pmEmail.toLowerCase())) {
    recipients.push({ emailAddress: { address: d.pmEmail, name: htmlEsc(d.pmNombre) } });
  }

  // All user-supplied values are escaped with htmlEsc before interpolation
  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F5F5F5;font-family:'Open Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #e4e8ec;">
  <tr>
    <td style="background:#101820;padding:24px 32px;border-bottom:3px solid #97D700;">
      <p style="margin:0;font-size:11px;color:#97D700;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Cen Systems S.A. de C.V. · Cisco Gold Partner</p>
      <h1 style="margin:8px 0 0;color:#ffffff;font-size:20px;font-weight:700;font-family:'Open Sans',Arial,sans-serif;">Cambio en Proyección de Facturación</h1>
      <p style="margin:6px 0 0;color:#919D9D;font-size:12px;">Notificación automática &nbsp;·&nbsp; ${htmlEsc(ts)}</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 32px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
        <tr style="background:#F5F5F5;">
          <td style="padding:11px 14px;font-weight:600;color:#101820;width:40%;border-bottom:1px solid #e4e8ec;">Proyecto</td>
          <td style="padding:11px 14px;color:#717C7D;border-bottom:1px solid #e4e8ec;">${htmlEsc(d.proyecto)}</td>
        </tr>
        <tr>
          <td style="padding:11px 14px;font-weight:600;color:#101820;border-bottom:1px solid #e4e8ec;">Nombre</td>
          <td style="padding:11px 14px;color:#717C7D;border-bottom:1px solid #e4e8ec;">${htmlEsc(d.nombre)}</td>
        </tr>
        <tr style="background:#F5F5F5;">
          <td style="padding:11px 14px;font-weight:600;color:#101820;border-bottom:1px solid #e4e8ec;">Cliente</td>
          <td style="padding:11px 14px;color:#717C7D;border-bottom:1px solid #e4e8ec;">${htmlEsc(d.nombreCliente)}</td>
        </tr>
        <tr>
          <td style="padding:11px 14px;font-weight:600;color:#101820;border-bottom:1px solid #e4e8ec;">PM Responsable</td>
          <td style="padding:11px 14px;color:#717C7D;border-bottom:1px solid #e4e8ec;">${htmlEsc(d.pmNombre)}</td>
        </tr>
        <tr style="background:#F5F5F5;">
          <td style="padding:11px 14px;font-weight:600;color:#101820;border-bottom:1px solid #e4e8ec;">Causa del Cambio</td>
          <td style="padding:11px 14px;color:#D62828;font-weight:700;border-bottom:1px solid #e4e8ec;">${htmlEsc(d.causa)}</td>
        </tr>
        <tr>
          <td style="padding:11px 14px;font-weight:600;color:#101820;border-bottom:1px solid #e4e8ec;">Monto Afectado</td>
          <td style="padding:11px 14px;font-size:17px;font-weight:700;color:#101820;border-bottom:1px solid #e4e8ec;">${monto}</td>
        </tr>
        <tr style="background:#F5F5F5;">
          <td style="padding:11px 14px;font-weight:600;color:#101820;">Nueva Fecha de Proyección</td>
          <td style="padding:11px 14px;font-weight:700;color:#97D700;font-size:15px;">${htmlEsc(mes)} ${Number(d.nuevoAnio)}</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#F5F5F5;border-left:4px solid #97D700;padding:16px 20px;border-radius:0 4px 4px 0;">
            <p style="margin:0 0 8px;font-weight:700;font-size:12px;color:#101820;text-transform:uppercase;letter-spacing:.5px;">Comentario del PM</p>
            <p style="margin:0;font-size:14px;color:#717C7D;line-height:1.7;white-space:pre-wrap;">${htmlEsc(d.comentario)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="background:#F5F5F5;padding:16px 32px;border-top:1px solid #e4e8ec;">
      <p style="margin:0;font-size:11px;color:#919D9D;text-align:center;line-height:1.6;">
        <strong style="color:#717C7D;">Cen Systems S.A. de C.V.</strong> &nbsp;|&nbsp; Cisco Gold Partner<br>
        Este mensaje es propiedad de Cen Systems S.A. de C.V., queda prohibido cualquier uso o reproducción no autorizada.<br>
        <span style="color:#c0c5c5;">${htmlEsc(ts)}</span>
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body></html>`;

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
  if (![200, 202].includes(res.status)) throw new Error('Error al enviar el correo de notificación.');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const d = JSON.parse(event.body || '{}');

    // Validate required fields
    const required = ['proyecto','nombre','nombreCliente','pmNombre','pmEmail',
                      'causa','monto','nuevoMes','nuevoAnio','comentario'];
    const missing = required.filter(f => !String(d[f] ?? '').trim());
    if (missing.length) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan campos requeridos.' }) };
    }

    // Validate pmEmail is in allowed list (prevent PM impersonation)
    if (!ALLOWED_PM_EMAILS.has(d.pmEmail.toLowerCase())) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'El correo del PM no está autorizado.' }) };
    }

    // Validate causa is in allowed list (prevent injection via causa field)
    if (!ALLOWED_CAUSES.has(d.causa)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Causa no válida.' }) };
    }

    // Validate numeric fields
    const monto = parseFloat(d.monto);
    const nuevoMes = parseInt(d.nuevoMes, 10);
    const nuevoAnio = parseInt(d.nuevoAnio, 10);
    if (isNaN(monto) || monto <= 0) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Monto inválido.' }) };
    }
    if (nuevoMes < 1 || nuevoMes > 12) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Mes inválido.' }) };
    }
    if (nuevoAnio < 2020 || nuevoAnio > 2035) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Año inválido.' }) };
    }

    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const nueva_fecha = `${nuevoAnio}-${String(nuevoMes).padStart(2, '0')}`;

    const row = [
      ts, d.pmNombre, d.pmEmail, d.proyecto, d.nombre, d.nombreCliente,
      d.causa, monto, nuevoMes, nuevoAnio, nueva_fecha, d.moneda || '', d.comentario,
    ];

    const [_, token] = await Promise.all([
      appendGitHubCSV(row),
      getGraphToken(),
    ]);

    await sendEmail(token, { ...d, monto, nuevoMes, nuevoAnio }, ts);

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ success: true, message: 'Notificación enviada correctamente.' }),
    };

  } catch (e) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'Ocurrió un error al procesar la solicitud. Intenta de nuevo.' }),
    };
  }
};
