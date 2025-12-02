// server.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '-');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use('/uploads', express.static(uploadsDir));

// Serve chat page
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Friends Chat (Realtime)</title>
  <style>
    body { font-family: Arial; margin:0; display:flex; flex-direction:column; height:100vh; }
    header { background:#4CAF50; color:white; padding:15px; text-align:center; font-size:1.5em; }
    main { flex:1; display:flex; }
    .chat { flex:3; display:flex; flex-direction:column; }
    .messages { flex:1; padding:10px; overflow-y:auto; background:#f9f9f9; }
    .message { margin:8px 0; padding:10px; background:#e8fff0; border-radius:8px; }
    .chat-input { display:flex; flex-wrap:wrap; padding:10px; background:#fafafa; border-top:1px solid #ddd; }
    .chat-input input, .chat-input button { margin:5px; padding:8px; border-radius:6px; }
    .chat-input button { background:#4CAF50; color:white; border:none; cursor:pointer; }
    .chat-input button:hover { background:#2E8B57; }
    .users { flex:1; background:#fff; border-left:1px solid #ddd; padding:10px; }
    .users h3 { margin-top:0; }
    .users ul { list-style:none; padding:0; }
    .users li { margin:5px 0; }
  </style>
</head>
<body>
  <header>🌟 Friends Chat (Realtime) 🌟</header>
  <main>
    <div class="chat">
      <div class="messages" id="messages"></div>
      <div class="chat-input">
        <input type="text" id="chatName" placeholder="Your name" />
        <input type="text" id="chatText" placeholder="Type a message..." />
        <button onclick="sendText()">Send</button>
        <input type="file" id="imageFile" accept="image/*" />
        <button onclick="sendFile('imageFile')">🖼️ Image</button>
        <input type="file" id="audioFile" accept="audio/*" />
        <button onclick="sendFile('audioFile')">🎵 Audio</button>
        <input type="file" id="videoFile" accept="video/*" />
        <button onclick="sendFile('videoFile')">🎬 Video</button>
      </div>
    </div>
    <div class="users">
      <h3>👥 Online Users</h3>
      <ul id="userList"></ul>
    </div>
  </main>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const messagesDiv = document.getElementById('messages');
    const userList = document.getElementById('userList');

    socket.on('chat:message', (msg) => addMessage(msg));
    socket.on('users:update', (users) => updateUsers(users));

    function addMessage(msg) {
      const div = document.createElement('div');
      div.className = 'message';
      const time = msg.time ? \`<span style="color:gray; font-size:0.8em;"> (\${msg.time})</span>\` : '';
      if (msg.type === 'text') {
        div.innerHTML = \`<b>\${msg.name}:</b> \${msg.text} \${time}\`;
      } else if (msg.type === 'image') {
        div.innerHTML = \`<b>\${msg.name}:</b> \${time}<br><img src="\${msg.url}" style="max-width:200px;" />\`;
      } else if (msg.type === 'audio') {
        div.innerHTML = \`<b>\${msg.name}:</b> \${time}<br><audio controls src="\${msg.url}"></audio>\`;
      } else if (msg.type === 'video') {
        div.innerHTML = \`<b>\${msg.name}:</b> \${time}<br><video controls width="250" src="\${msg.url}"></video>\`;
      }
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function sendText() {
      const name = document.getElementById('chatName').value.trim();
      const text = document.getElementById('chatText').value.trim();
      if (!name || !text) return;
      socket.emit('chat:message', { type:'text', name, text });
      document.getElementById('chatText').value = '';
    }

    async function sendFile(inputId) {
      const name = document.getElementById('chatName').value.trim();
      const fileInput = document.getElementById(inputId);
      const file = fileInput.files[0];
      if (!name || !file) return;
      const form = new FormData();
      form.append('media', file);
      const res = await fetch('/upload', { method:'POST', body:form });
      const data = await res.json();
      if (data.ok) {
        socket.emit('chat:message', { type:data.type, name, url:data.url });
      }
      fileInput.value = '';
    }

    function updateUsers(users) {
      userList.innerHTML = '';
      users.forEach(u => {
        const li = document.createElement('li');
        li.textContent = u;
        userList.appendChild(li);
      });
    }

    // Send name to server when set
    document.getElementById('chatName').addEventListener('change', () => {
      const name = document.getElementById('chatName').value.trim();
      if (name) socket.emit('user:setName', name);
    });
  </script>
</body>
</html>
  `);
});

// Upload endpoint
app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok:false, error:'No file uploaded' });
  const url = '/uploads/' + req.file.filename;
  const mime = req.file.mimetype || '';
  let type = 'file';
  if (mime.startsWith('image/')) type = 'image';
  else if (mime.startsWith('audio/')) type = 'audio';
  else if (mime.startsWith('video/')) type = 'video';
  res.json({ ok:true, url, type });
});

// Track online users
let users = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user:setName', (name) => {
    users[socket.id] = name;
    io.emit('users:update', Object.values(users));
  });

  socket.on('chat:message', (payload) => {
    payload.time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    io.emit('chat:message', payload);
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    io.emit('users:update', Object.values(users));
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
});