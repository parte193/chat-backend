import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Message from "./models/Message.js";
import Space from "./models/Space.js";
import messagesRouter from "./routes/messages.js";
import spacesRouter from "./routes/spaces.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 5e6, // 5MB
});

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "5mb" }));

// MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("🟢 Conectado a MongoDB Atlas");

    // Crear espacio general si no existe
    const exists = await Space.findOne({ name: "general" });
    if (!exists) {
      await Space.create({
        name: "general",
        description: "Espacio general por defecto",
        createdBy: "sistema",
        isDefault: true,
      });
      console.log("✅ Espacio 'general' creado automáticamente");
    }
  })
  .catch((err) => console.error("🔴 Error conectando a MongoDB:", err));

// Rutas API
app.use("/api/messages", messagesRouter);
app.use("/api/spaces", spacesRouter);

// Test
app.get("/", (_req, res) => res.send("Servidor de chat funcionando 🚀"));

// ==========================================
// SOCKET.IO CONFIGURACIÓN
// ==========================================

const connectedUsers = new Map(); // socket.id -> {nickname, space, isDM}

const getUsersInSpace = (space) => {
  return Array.from(connectedUsers.entries())
    .filter(([_, user]) => user.space === space && !user.isDM)
    .map(([socketId, user]) => ({ socketId, nickname: user.nickname }));
};

const getAllConnectedUsers = () => {
  const unique = new Set();
  const list = [];
  connectedUsers.forEach((user) => {
    if (!unique.has(user.nickname)) {
      unique.add(user.nickname);
      list.push({ nickname: user.nickname });
    }
  });
  return list;
};

// ==========================================
// EVENTOS DE SOCKET.IO
// ==========================================
io.on("connection", (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  // ========================
  // JOIN (Unirse al espacio)
  // ========================
  socket.on("join", async ({ nickname, space = "general" }) => {
    connectedUsers.set(socket.id, { nickname, space, isDM: false });
    socket.join(space);

    console.log(`👤 ${nickname} se unió al espacio: ${space}`);

    io.to(space).emit("spaceUsers", getUsersInSpace(space));
    io.emit("allUsers", getAllConnectedUsers());

    // Enviar historial del espacio
    const history = await Message.find({ type: "space", space }).sort({
      createdAt: 1,
    });
    socket.emit("chatHistory", history);
  });

  // ========================
  // CAMBIO DE ESPACIO
  // ========================
  socket.on("changeSpace", async ({ space }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    socket.leave(user.space);
    user.space = space;
    user.isDM = false;
    connectedUsers.set(socket.id, user);

    socket.join(space);
    console.log(`🔄 ${user.nickname} cambió al espacio ${space}`);

    io.to(space).emit("spaceUsers", getUsersInSpace(space));
    io.emit("allUsers", getAllConnectedUsers());

    const history = await Message.find({ type: "space", space }).sort({
      createdAt: 1,
    });
    socket.emit("chatHistory", history);
  });

  // ========================
  // MENSAJES EN ESPACIOS
  // ========================
  socket.on("sendMessage", async ({ sender, content, image }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    let saved;
    if (user.isDM) {
      // MENSAJE DIRECTO
      saved = await Message.create({
        sender,
        receiver: user.dmWith,
        content,
        image,
        type: "dm",
      });

      const dmRoom = user.dmRoom;
      io.to(dmRoom).emit("receiveDM", saved);
    } else {
      // MENSAJE EN ESPACIO
      saved = await Message.create({
        sender,
        content,
        image,
        type: "space",
        space: user.space,
      });

      io.to(user.space).emit("receiveMessage", saved);
    }
  });

  // ========================
  // MENSAJES DIRECTOS
  // ========================
  socket.on("startDM", async ({ receiver }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const dmRoom = [user.nickname, receiver].sort().join("-");
    socket.join(dmRoom);

    user.isDM = true;
    user.dmWith = receiver;
    user.dmRoom = dmRoom;
    connectedUsers.set(socket.id, user);

    const history = await Message.find({
      type: "dm",
      $or: [
        { sender: user.nickname, receiver },
        { sender: receiver, receiver: user.nickname },
      ],
    }).sort({ createdAt: 1 });

    socket.emit("dmHistory", history);
  });

  socket.on("closeDM", async ({ space = "general" }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    if (user.dmRoom) socket.leave(user.dmRoom);
    user.isDM = false;
    user.dmWith = null;
    user.dmRoom = null;
    user.space = space;
    connectedUsers.set(socket.id, user);
    socket.join(space);

    const history = await Message.find({ type: "space", space }).sort({
      createdAt: 1,
    });
    socket.emit("chatHistory", history);
  });

  // ========================
  // DESCONECTAR
  // ========================
  socket.on("disconnect", () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      console.log(`🔴 ${user.nickname} desconectado`);
      connectedUsers.delete(socket.id);
      io.to(user.space).emit("spaceUsers", getUsersInSpace(user.space));
      io.emit("allUsers", getAllConnectedUsers());
    }
  });
});

// ==========================================
// SERVIDOR ACTIVO
// ==========================================
const PORT = process.env.PORT || 4000;
server.listen(PORT, () =>
  console.log(`✅ Servidor activo en puerto ${PORT}`)
);
