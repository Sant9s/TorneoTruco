const ROW_ID = "main";
const TABLE_NAME = "tournament_state";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return sendJson(res, 500, { error: "Missing Supabase environment variables." });
  }

  if (req.method === "GET") {
    return getState(req, res, supabaseUrl, serviceKey);
  }

  if (req.method === "PUT") {
    return putState(req, res, supabaseUrl, serviceKey);
  }

  res.setHeader("Allow", "GET, PUT");
  return sendJson(res, 405, { error: "Method not allowed." });
};

async function getState(req, res, supabaseUrl, serviceKey) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${TABLE_NAME}?id=eq.${ROW_ID}&select=state,updated_at&limit=1`,
    {
      headers: supabaseHeaders(serviceKey),
    }
  );

  if (!response.ok) {
    return sendJson(res, response.status, { error: await response.text() });
  }

  const rows = await response.json();
  const row = rows[0] || null;
  return sendJson(res, 200, {
    state: row?.state || null,
    updatedAt: row?.updated_at || null,
  });
}

async function putState(req, res, supabaseUrl, serviceKey) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const state = body.state;

  if (!state || typeof state !== "object") {
    return sendJson(res, 400, { error: "Invalid state payload." });
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${TABLE_NAME}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id: ROW_ID,
      state,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return sendJson(res, response.status, { error: await response.text() });
  }

  const rows = await response.json();
  const row = rows[0] || null;
  return sendJson(res, 200, {
    state: row?.state || state,
    updatedAt: row?.updated_at || null,
  });
}

function supabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
