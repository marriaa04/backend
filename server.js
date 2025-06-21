const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const Database = require('better-sqlite3');
const db = new Database('data.db'); // This will create data.db in your backend folder if it doesn't exist

// Create tables if they don't exist
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnp TEXT UNIQUE,
  password TEXT,
  hasVoted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  candidateId INTEGER,
  FOREIGN KEY(userId) REFERENCES users(id)
);
`);

const app = express();
app.use(cors());
app.use(express.json());

let candidates = [
  { id: 1, name: "Alice Rossi", party: "Party A", photo: "https://randomuser.me/api/portraits/women/68.jpg" },
  { id: 2, name: "Bob Bianchi", party: "Party B", photo: "https://randomuser.me/api/portraits/men/65.jpg" },
  { id: 3, name: "Carla Verdi", party: "Party C", photo: "https://randomuser.me/api/portraits/women/65.jpg" },
];
let nextId = 4;

// --- REST API ---
app.get("/api/candidates", (req, res) => res.json(candidates));
app.post("/api/candidates", (req, res) => {
  const { name, party, photo } = req.body;
  const candidate = { id: nextId++, name, party, photo };
  candidates.push(candidate);
  broadcastStats();
  res.json(candidate);
});
app.put("/api/candidates/:id", (req, res) => {
  const id = Number(req.params.id);
  const idx = candidates.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).end();
  candidates[idx] = { ...candidates[idx], ...req.body };
  broadcastStats();
  res.json(candidates[idx]);
});
app.delete("/api/candidates/:id", (req, res) => {
  const id = Number(req.params.id);
  candidates = candidates.filter(c => c.id !== id);
  broadcastStats();
  res.status(204).end();
});

// --- WebSocket for statistics ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function getStats() {
  const stats = {};
  for (const c of candidates) {
    stats[c.party] = (stats[c.party] || 0) + 1;
  }
  return stats;
}
function broadcastStats() {
  const stats = getStats();
  const msg = JSON.stringify({ type: "stats", stats });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}
wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "stats", stats: getStats() }));
});

let generatorInterval = null;

function randomName() {
  const first = ["Alex", "Sam", "Chris", "Jamie", "Taylor", "Jordan", "Morgan", "Casey"];
  const last = ["Smith", "Johnson", "Lee", "Brown", "Garcia", "Martinez", "Davis", "Lopez"];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}
function randomParty() {
  const PARTIES = ["Party A", "Party B", "Party C", "Party D", "Party E"];
  return PARTIES[Math.floor(Math.random() * PARTIES.length)];
}
function randomPhoto() {
  const gender = Math.random() > 0.5 ? "men" : "women";
  const num = Math.floor(Math.random() * 99);
  return `https://randomuser.me/api/portraits/${gender}/${num}.jpg`;
}

// Start generator
app.post("/api/candidates/generate", (req, res) => {
  if (generatorInterval) return res.status(400).json({ error: "Already generating" });
  generatorInterval = setInterval(() => {
    const candidate = {
      id: nextId++,
      name: randomName(),
      party: randomParty(),
      photo: randomPhoto(),
    };
    candidates.push(candidate);
    broadcastStats();
  }, 500);
  res.json({ started: true });
});

// Stop generator
app.post("/api/candidates/stop", (req, res) => {
  if (generatorInterval) {
    clearInterval(generatorInterval);
    generatorInterval = null;
  }
  res.json({ stopped: true });
});

// Register
app.post("/api/register", (req, res) => {
  const { cnp, password } = req.body;
  try {
    const stmt = db.prepare("INSERT INTO users (cnp, password) VALUES (?, ?)");
    const info = stmt.run(cnp, password);
    res.json({ id: info.lastInsertRowid, cnp });
  } catch (e) {
    res.status(400).json({ error: "CNP already registered" });
  }
});

// Login
app.post("/api/login", (req, res) => {
  const { cnp, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE cnp = ? AND password = ?").get(cnp, password);
  if (user) {
    res.json({ id: user.id, cnp: user.cnp, hasVoted: !!user.hasVoted });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

// Vote
app.post("/api/vote", (req, res) => {
  console.log("Vote request:", req.body); // Add this line
  const { userId, candidateId } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.hasVoted) return res.status(400).json({ error: "User already voted" });

  // Check if candidate exists in memory
  const candidate = candidates.find(c => c.id === candidateId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  db.prepare("INSERT INTO votes (userId, candidateId) VALUES (?, ?)").run(userId, candidateId);
  db.prepare("UPDATE users SET hasVoted = 1 WHERE id = ?").run(userId);
  res.json({ success: true });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));