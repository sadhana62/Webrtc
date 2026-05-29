const express = require("express");
const bodyParser = require("body-parser");
const { createServer } = require("node:http");

const app = express();
const server = createServer(app);

app.use(bodyParser.json());

const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("[socket] connected", socket.id);

  socket.on("disconnecting", () => {
    console.log("[socket] disconnecting", socket.id);
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.to(room).emit("room:user-left", { id: socket.id });
      }
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected", socket.id, reason);
  });

  const handleJoin = ({ roomId, email } = {}) => {
    if (!roomId) return;
    console.log("[socket] room:join", { id: socket.id, roomId, email });
    socket.join(roomId);
    socket.to(roomId).emit("room:user-joined", { id: socket.id, email });
    socket.emit("room:joined", { roomId, id: socket.id });
  };

  socket.on("room:join", handleJoin);
  socket.on("join-room", handleJoin);

  socket.on("webrtc:offer", ({ roomId, offer } = {}) => {
    if (!roomId || !offer) return;
    console.log("[socket] webrtc:offer", { from: socket.id, roomId });
    socket.to(roomId).emit("webrtc:offer", { from: socket.id, offer });
  });

  socket.on("webrtc:answer", ({ roomId, answer } = {}) => {
    if (!roomId || !answer) return;
    console.log("[socket] webrtc:answer", { from: socket.id, roomId });
    socket.to(roomId).emit("webrtc:answer", { from: socket.id, answer });
  });

  socket.on("webrtc:ice-candidate", ({ roomId, candidate } = {}) => {
    if (!roomId || !candidate) return;
    console.log("[socket] webrtc:ice-candidate", { from: socket.id, roomId });
    socket.to(roomId).emit("webrtc:ice-candidate", { from: socket.id, candidate });
  });

  socket.on("webrtc:ready", ({ roomId } = {}) => {
    if (!roomId) return;
    console.log("[socket] webrtc:ready", { from: socket.id, roomId });
    socket.to(roomId).emit("webrtc:ready", { from: socket.id });
  });

  socket.on("webrtc:media-toggle", ({ roomId, kind, enabled } = {}) => {
    if (!roomId) return;
    console.log("[socket] webrtc:media-toggle", { from: socket.id, roomId, kind, enabled });
    socket.to(roomId).emit("webrtc:media-toggle", { from: socket.id, kind, enabled });
  });

  socket.on("chat:message", ({ roomId, message, sender, timestamp } = {}) => {
    if (!roomId || !message) return;
    console.log("[socket] chat:message", { from: socket.id, roomId, message, sender });
    socket.to(roomId).emit("chat:message", { from: socket.id, message, sender, timestamp });
  });
});

app.get("/", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log("server is running at", PORT));
