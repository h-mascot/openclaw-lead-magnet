function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function getBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 50_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const type = req.headers["content-type"] || "";
        if (type.includes("application/json")) {
          resolve(raw ? JSON.parse(raw) : {});
          return;
        }
        const params = new URLSearchParams(raw);
        resolve(Object.fromEntries(params.entries()));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function forwardLead(lead) {
  const target = process.env.LEAD_WEBHOOK_URL;
  if (!target) return { configured: false };

  const response = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LEAD_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.LEAD_WEBHOOK_SECRET}` } : {}),
    },
    body: JSON.stringify(lead),
  });

  return { configured: true, status: response.status, ok: response.ok };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = await getBody(req);
    const lead = {
      name: clean(body.name, 120),
      email: clean(body.email, 180).toLowerCase(),
      automation_priority: clean(body.automation_priority || body.automationPriority, 180),
      source: clean(body.source || "openclaw-guide-lead-magnet", 120),
      submitted_at: new Date().toISOString(),
      user_agent: clean(req.headers["user-agent"], 300),
      ip_hint: clean(req.headers["x-forwarded-for"] || req.socket?.remoteAddress, 80),
    };

    if (!lead.name || !validEmail(lead.email) || !lead.automation_priority) {
      res.status(400).json({ ok: false, error: "Name, work email, and automation priority are required." });
      return;
    }

    const forward = await forwardLead(lead).catch((error) => ({
      configured: Boolean(process.env.LEAD_WEBHOOK_URL),
      ok: false,
      error: error.message,
    }));

    console.log(JSON.stringify({ event: "openclaw_lead_magnet_submission", lead, forward }));

    res.status(200).json({
      ok: true,
      downloadUrl: "/lead-magnet.pdf",
      lead: { email: lead.email, source: lead.source },
      forward,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Submission failed." });
  }
};
