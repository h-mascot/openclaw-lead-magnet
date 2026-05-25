const allowedOrigins = new Set([
  "https://openclaw-guide.com",
  "https://www.openclaw-guide.com",
  "https://pdf-landing-page-tau.vercel.app",
]);

if (process.env.VERCEL_ENV !== "production") {
  allowedOrigins.add("http://127.0.0.1:4173");
  allowedOrigins.add("http://localhost:4173");
}

const recentSubmissions = new Map();
const { createHash } = require("crypto");

function setCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "600");
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

function rateLimited(email) {
  const now = Date.now();
  const key = email || "anonymous";
  const previous = recentSubmissions.get(key) || 0;
  recentSubmissions.set(key, now);
  for (const [entry, timestamp] of recentSubmissions.entries()) {
    if (now - timestamp > 10 * 60 * 1000) recentSubmissions.delete(entry);
  }
  return now - previous < 30_000;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
  setCors(req, res);

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
    };

    const loadedAt = Number(body.loaded_at || body.loadedAt || 0);
    const elapsed = loadedAt ? Date.now() - loadedAt : 0;
    const honeypot = clean(body.website, 200);

    if (honeypot || (elapsed > 0 && elapsed < 1200)) {
      res.status(200).json({ ok: true, downloadUrl: "/lead-magnet.pdf" });
      return;
    }

    if (!lead.name || !validEmail(lead.email) || !lead.automation_priority) {
      res.status(400).json({ ok: false, error: "Name, work email, and automation priority are required." });
      return;
    }

    if (rateLimited(lead.email)) {
      res.status(429).json({ ok: false, error: "Please wait a moment before submitting again." });
      return;
    }

    const forward = await forwardLead(lead).catch((error) => ({
      configured: Boolean(process.env.LEAD_WEBHOOK_URL),
      ok: false,
      error: error.message,
    }));

    const emailHash = sha256(lead.email);
    console.log(JSON.stringify({
      event: "openclaw_lead_magnet_submission",
      lead: {
        email_hash: emailHash,
        automation_priority: lead.automation_priority,
        source: lead.source,
        submitted_at: lead.submitted_at,
      },
      forward,
    }));

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
