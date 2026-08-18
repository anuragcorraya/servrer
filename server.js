const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== ফায়ারবেস ও Wingo API কনফিগারেশন ====================
const FIREBASE_PROJECT_ID = "appp-42a6a";
const FIREBASE_API_KEY = "AIzaSyB8BfSkcBtHrg7BTNn45jsP50Qq9uGb6_w";
const WINGO_API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";

// মেমোরি স্টেট ও ক্যাশ
const savedIssuesSet = new Set();
const systemLogs = [];
let totalSavedCount = 0;
let lastCheckTime = null;
let lastStatus = "Initializing...";

// লগ যোগ করার ফাংশন
function addLog(message, type = "INFO") {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  const logEntry = `[${timestamp}] [${type}] ${message}`;
  systemLogs.unshift(logEntry);
  if (systemLogs.length > 50) systemLogs.pop();
  console.log(logEntry);
}

// API রেসপন্স থেকে অ্যারাই খুঁজে বের করার লজিক
function findResultArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.data && Array.isArray(data.data)) return data.data;
  if (data.data && Array.isArray(data.data.list)) return data.data.list;
  if (data.result && Array.isArray(data.result)) return data.result;
  if (data.result && Array.isArray(data.result.list)) return data.result.list;
  if (data.list && Array.isArray(data.list)) return data.list;
  return [];
}

// রেজাল্ট অবজেক্ট ফরম্যাট ক্লিয়ার করার লজিক
function normalizeResult(item) {
  if (!item || typeof item !== "object") return null;
  const issue = item.issueNumber ?? item.issue ?? item.issueNo ?? item.period ?? item.roundId ?? item.round ?? item.id;
  const number = item.number ?? item.result ?? item.resultNumber ?? item.openNumber ?? item.code;
  if (issue === undefined || issue === null) return null;
  return {
    issue: String(issue),
    number: (number !== undefined && number !== null) ? String(number) : ""
  };
}

// Firebase Firestore REST API দিয়ে সরাসরি ফায়ারবেসে ডাটা সেভ করার ফাংশন
async function saveToFirestore(result) {
  const safeId = String(result.issue).replace(/[\/\\.#$[\]]/g, "_");
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/wingo_results/${safeId}?key=${FIREBASE_API_KEY}`;

  const payload = {
    fields: {
      issueNumber: { stringValue: String(result.issue) },
      number: { stringValue: String(result.number) },
      source: { stringValue: "Render Backend Automation" },
      apiUrl: { stringValue: WINGO_API_URL },
      savedAt: { timestampValue: new Date().toISOString() }
    }
  };

  try {
    await axios.patch(firestoreUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000
    });
    return true;
  } catch (err) {
    addLog(`Firebase save failed for Round ${result.issue}: ${err.message}`, "ERROR");
    return false;
  }
}

// ==================== মূল অটোমেশন ইঞ্জিন (প্রতি ১০ সেকেন্ড পর পর চলবে) ====================
async function fetchAndSyncWingo() {
  lastCheckTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  try {
    const response = await axios.get(WINGO_API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Cache-Control': 'no-cache'
      },
      timeout: 10000
    });

    const results = findResultArray(response.data);
    if (!results || results.length === 0) {
      lastStatus = "Warning: API returned empty list";
      addLog("Wingo API returned no data items", "WARN");
      return;
    }

    let newSavedInThisRun = 0;

    for (const item of results) {
      const parsed = normalizeResult(item);
      if (!parsed || !parsed.issue) continue;

      // মেমোরি ফিল্টার
      if (savedIssuesSet.has(parsed.issue)) continue;

      // ফায়ারবেসে পুশ
      const isSaved = await saveToFirestore(parsed);
      if (isSaved) {
        savedIssuesSet.add(parsed.issue);
        totalSavedCount++;
        newSavedInThisRun++;
        addLog(`✅ New Round Saved: ${parsed.issue} (Number: ${parsed.number})`, "SUCCESS");
      }
    }

    lastStatus = "ONLINE 🟢 (Auto Sync Active)";
    if (newSavedInThisRun > 0) {
      addLog(`Synced ${newSavedInThisRun} new rounds to Firebase. Total: ${totalSavedCount}`, "INFO");
    }

  } catch (error) {
    lastStatus = "Error connecting to Wingo API 🔴";
    addLog(`Wingo API Fetch Error: ${error.message}`, "ERROR");
  }
}

// সার্ভার চালু হওয়ার পরপরই প্রতি ১০ সেকেন্ড পর পর স্বয়ংক্রিয়ভাবে Wingo চেক করবে
setInterval(fetchAndSyncWingo, 10000); // 10 Seconds check ensures zero data loss
fetchAndSyncWingo(); // First run immediately

// ==================== Express Server & Status Monitor UI ====================
app.use(express.json());

// API Status Route
app.get('/api/status', (req, res) => {
  res.json({
    status: lastStatus,
    lastChecked: lastCheckTime,
    totalSaved: totalSavedCount,
    cachedRounds: savedIssuesSet.size,
    logs: systemLogs
  });
});

// Ping endpoint for UptimeRobot
app.get('/ping', (req, res) => {
  res.send('PONG - Wingo 30s Backend is Live!');
});

// Admin Dashboard UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Wingo 30s Backend Engine Status</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; background: #151d30; padding: 25px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); }
        h1 { color: #818cf8; font-size: 24px; margin-bottom: 20px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; }
        .card { background: #1e293b; padding: 15px; border-radius: 8px; border: 1px solid #334155; }
        .card label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 5px; }
        .card .val { font-size: 18px; font-weight: bold; color: #f8fafc; }
        .status-online { color: #4ade80 !important; }
        .log-box { background: #0f172a; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 13px; max-height: 400px; overflow-y: auto; border: 1px solid #1e293b; }
        .log-line { margin-bottom: 6px; border-bottom: 1px dashed #1e293b; padding-bottom: 4px; word-break: break-all; }
        .SUCCESS { color: #4ade80; }
        .ERROR { color: #f87171; }
        .WARN { color: #fbbf24; }
        .INFO { color: #38bdf8; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 MADDOX MODZ - Wingo 30s Backend Server</h1>
        <div class="grid">
          <div class="card">
            <label>Server Status</label>
            <div class="val status-online">${lastStatus}</div>
          </div>
          <div class="card">
            <label>Total Saved to Firebase</label>
            <div class="val">${totalSavedCount}</div>
          </div>
          <div class="card">
            <label>Last Synced Time</label>
            <div class="val" style="font-size: 14px;">${lastCheckTime || 'Syncing...'}</div>
          </div>
        </div>

        <h3>📋 Live Console Logs (Auto Refreshing)</h3>
        <div class="log-box" id="logs">
          ${systemLogs.map(log => {
            const cls = log.includes('[SUCCESS]') ? 'SUCCESS' : log.includes('[ERROR]') ? 'ERROR' : log.includes('[WARN]') ? 'WARN' : 'INFO';
            return `<div class="log-line ${cls}">${log}</div>`;
          }).join('')}
        </div>
      </div>
      <script>
        setInterval(() => {
          fetch('/api/status')
            .then(res => res.json())
            .then(data => {
              location.reload();
            });
        }, 8000);
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  addLog(`Server successfully started on port ${PORT}`, "INFO");
});
