import json
import os
import snowflake.connector

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
}

QUERY = """
    SELECT PROYECTO, NOMBRE, NOMBRE_CLIENTE, PM, 'USD' AS MONEDA
    FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_USD
    WHERE LOAD_DATE = (SELECT MAX(LOAD_DATE) FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_USD)
      AND UPPER(TIPO_VENTA) != 'SUMINISTRO'
      AND TRY_TO_NUMBER(SUBSTR(PROYECTO, 5, 2)) >= 23
      AND (PROYECTO ILIKE %s OR NOMBRE ILIKE %s OR NOMBRE_CLIENTE ILIKE %s OR PM ILIKE %s)
    UNION
    SELECT PROYECTO, NOMBRE, NOMBRE_CLIENTE, PM, 'MXN' AS MONEDA
    FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_MXN
    WHERE LOAD_DATE = (SELECT MAX(LOAD_DATE) FROM MUAMBA_EXTRACT.MUAMBA_API.MUAMBA_RDA_MXN)
      AND UPPER(TIPO_VENTA) != 'SUMINISTRO'
      AND TRY_TO_NUMBER(SUBSTR(PROYECTO, 5, 2)) >= 23
      AND (PROYECTO ILIKE %s OR NOMBRE ILIKE %s OR NOMBRE_CLIENTE ILIKE %s OR PM ILIKE %s)
    ORDER BY PROYECTO
    LIMIT 50
"""


def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    q = (event.get("queryStringParameters") or {}).get("q", "").strip()
    if not q:
        return {"statusCode": 200, "headers": CORS, "body": json.dumps([])}

    like = f"%{q}%"

    try:
        conn = snowflake.connector.connect(
            account=os.environ["SF_ACCOUNT"],
            user=os.environ["SF_USER"],
            password=os.environ["SF_PASSWORD"],
            role=os.environ.get("SF_ROLE", "PM"),
            warehouse=os.environ.get("SF_WAREHOUSE", "COMPUTE_WH"),
            database="MUAMBA_EXTRACT",
            schema="MUAMBA_API",
        )
        cur = conn.cursor()
        cur.execute(QUERY, (like, like, like, like, like, like, like, like))
        rows = cur.fetchall()
        cols = [d[0].lower() for d in cur.description]
        cur.close()
        conn.close()

        results = [dict(zip(cols, row)) for row in rows]
        return {"statusCode": 200, "headers": CORS, "body": json.dumps(results, default=str)}

    except Exception as e:
        return {"statusCode": 500, "headers": CORS, "body": json.dumps({"error": str(e)})}
