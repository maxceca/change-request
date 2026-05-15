const snowflake = require('snowflake-sdk');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

const QUERY = `
  SELECT PROYECTO, NOMBRE, NOMBRE_CLIENTE, PM, 'USD' AS MONEDA
  FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_USD
  WHERE LOAD_DATE = (SELECT MAX(LOAD_DATE) FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_USD)
    AND UPPER(TIPO_VENTA) != 'SUMINISTRO'
    AND TRY_TO_NUMBER(SUBSTR(PROYECTO, 5, 2)) >= 23
    AND (PROYECTO ILIKE :1 OR NOMBRE ILIKE :2 OR NOMBRE_CLIENTE ILIKE :3 OR PM ILIKE :4)
  UNION
  SELECT PROYECTO, NOMBRE, NOMBRE_CLIENTE, PM, 'MXN' AS MONEDA
  FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_MXN
  WHERE LOAD_DATE = (SELECT MAX(LOAD_DATE) FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_MXN)
    AND UPPER(TIPO_VENTA) != 'SUMINISTRO'
    AND TRY_TO_NUMBER(SUBSTR(PROYECTO, 5, 2)) >= 23
    AND (PROYECTO ILIKE :5 OR NOMBRE ILIKE :6 OR NOMBRE_CLIENTE ILIKE :7 OR PM ILIKE :8)
  ORDER BY PROYECTO
  LIMIT 50
`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const q = (event.queryStringParameters || {}).q?.trim();
  if (!q) return { statusCode: 200, headers: CORS, body: '[]' };

  const like = `%${q}%`;

  return new Promise((resolve) => {
    const conn = snowflake.createConnection({
      account:   process.env.SF_ACCOUNT,
      username:  process.env.SF_USER,
      password:  process.env.SF_PASSWORD,
      role:      'PM',
      warehouse: 'COMPUTE_WH',
      database:  'MUAMBA_EXTRACT',
      schema:    'MUAMBA_API',
    });

    conn.connect((err) => {
      if (err) return resolve({ statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) });

      conn.execute({
        sqlText: QUERY,
        binds: [like, like, like, like, like, like, like, like],
        complete: (err, _stmt, rows) => {
          conn.destroy(() => {});
          if (err) return resolve({ statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) });

          const results = (rows || []).map(r => ({
            proyecto:       r.PROYECTO       || '',
            nombre:         r.NOMBRE         || '',
            nombre_cliente: r.NOMBRE_CLIENTE || '',
            pm:             r.PM             || '',
            moneda:         r.MONEDA         || '',
          }));
          resolve({ statusCode: 200, headers: CORS, body: JSON.stringify(results) });
        },
      });
    });
  });
};
