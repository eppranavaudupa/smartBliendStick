// server.js
const express = require('express');
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
const server = http.createServer(app);

// ---------- Configuration ----------
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";
const SERVER_LAT = process.env.SERVER_LAT || 13.2180;
const SERVER_LNG = process.env.SERVER_LNG || 75.0060;

// Twilio Config
const TWILIO_SID = process.env.TWILIO_SID ;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN ;
const TWILIO_FROM = process.env.TWILIO_FROM ;
const ALERT_TO = process.env.ALERT_TO ;

let twilioClient = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
  console.log("Twilio configured");
} else {
  console.warn(" Twilio not configured - SMS won't be sent.");
}

// ---------- Middleware ----------
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helper: Save + Load Events ----------
const EVENTS_FILE = path.join(__dirname, 'events.json');
function loadEvents() {
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      return JSON.parse(fs.readFileSync(EVENTS_FILE));
    }
  } catch (err) {
    console.error('Failed to read events file:', err);
  }
  return [];
}
function saveEvent(ev) {
  const events = loadEvents();
  events.push(ev);
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

// ---------- POST /event ----------
app.post('/event', (req, res) => {
  if (API_KEY && req.header('x-api-key') !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const ev = req.body || {};
  ev.receivedAt = new Date().toISOString();

  // Attach fallback location if missing
  if (!ev.latitude || !ev.longitude) {
    ev.latitude = parseFloat(SERVER_LAT);
    ev.longitude = parseFloat(SERVER_LNG);
    ev.locationSource = 'server-default';
  } else {
    ev.latitude = parseFloat(ev.latitude);
    ev.longitude = parseFloat(ev.longitude);
    ev.locationSource = 'device';
  }

  console.log(" Event received:", ev);
  saveEvent(ev);

  // Send SMS if event = fall
  if (String(ev.event).toLowerCase() === 'fall') {
    const mapLink = `https://www.google.com/maps?q=${ev.latitude},${ev.longitude}`;
    const msg = ` ALERT!!!
    : Device ${ev.deviceId || 'unknown'} reported a FALL!\nTime: ${ev.timestamp || ev.receivedAt}\nLocation: ${mapLink}`;
    
    if (twilioClient && TWILIO_FROM && ALERT_TO) {
      twilioClient.messages
        .create({ body: msg, from: TWILIO_FROM, to: ALERT_TO })
        .then((m) => console.log(' SMS sent, SID:', m.sid))
        .catch((err) => console.error(' Twilio send error:', err));
    } else {
      console.warn(' Twilio not configured, skipping SMS.');
    }
  }

  res.json({ status: 'ok' });
});

// ---------- GET /events (frontend fetches this) ----------
app.get('/events', (req, res) => {
  const events = loadEvents();
  res.json(events);
});

// ---------- Serve Frontend ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ---------- Authentication ----------
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const USERS_FILE = path.join(__dirname, 'users.json');
const SECRET_KEY = process.env.SECRET_KEY || 'supersecret';

// Helper: Load & Save users
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE));
    }
  } catch (err) {
    console.error('Failed to read users file:', err);
  }
  return [];
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ---------- Sign Up ----------
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  const users = loadUsers();
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const hashed = await bcrypt.hash(password, 10);
  users.push({ name, email, password: hashed });
  saveUsers(users);
  res.json({ status: 'registered' });
});

// ---------- Login ----------
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'User not found' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Invalid password' });

  const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: '1h' });
  res.json({ token });
});

// ---------- Auth Middleware ----------
function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });

  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, SECRET_KEY);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Protect dashboard API
app.get('/events', verifyAuth, (req, res) => {
  const events = loadEvents();
  res.json(events);
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
