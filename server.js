import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

import messagesRouter from "./routes/messages.js";
import spacesRouter from "./routes/spaces.js";
import Message from "./models/Message.js";
import Space from "./models/Space.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.CORS_TEST,
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 5e6
});

app.use(cors({ 
  origin: allowedOrigins,
  credentials: true 
}));
app.use(express.json({ limit: '5mb' }));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("🟢 Conectado a MongoDB Atlas"))
  .catch((err) => console.error("🔴 Error conectando a MongoDB:", err));

app.use("/api/messages", messagesRouter);
app.use("/api/spaces", spacesRouter);
app.get("/", (_req, res) => res.send("Servidor de chat funcionando 🚀"));

const connectedUsers = new Map();

const getUsersInSpace = (space) => {
  const users = [];
  connectedUsers.forEach((user, socketId) => {
    if (user.space === space && !user.isDM) {
      users.push({ socketId, nickname: user.nickname });
    }
  });
  return users;
};

const getAllConnectedUsers = () => {
  const users = [];
  const seen = new Set();
  connectedUsers.forEach((user) => {
    if (!seen.has(user.nickname)) {
      users.push({ nickname: user.nickname });
      seen.add(user.nickname);
    }
  });
  return users;
};

io.on("connection", async (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  socket.on("join", async ({ nickname, space = 'general' }) => {
    connectedUsers.set(socket.id, { nickname, space, isDM: false });
    socket.join(space);
    
    console.log(`👤 ${nickname} se unió al espacio: ${space}`);
    
    io.to(space).emit("spaceUsers", getUsersInSpace(space));
    io.emit("allUsers", getAllConnectedUsers());
    
    try {
      const history = await Message.find({ type: 'space', space })
        .sort({ createdAt: 1 })
        .lean();
      
      const historyWithTimestamp = history.map(msg => ({
        ...msg,
        timestamp: msg.createdAt || new Date().toISOString()
      }));
      
      socket.emit("chatHistory", historyWithTimestamp);
      console.log(`📦 Enviando ${history.length} mensajes del espacio ${space}`);
    } catch (e) {
      console.error("❌ Error enviando historial:", e);
    }
    
    socket.to(space).emit("userJoined", { nickname, timestamp: new Date().toISOString() });
  });

  socket.on("changeSpace", async ({ space }) => {
    const user = connectedUsers.get(socket.id);
    if (!user || user.isDM) return;
    
    const oldSpace = user.space;
    socket.leave(oldSpace);
    socket.join(space);
    
    user.space = space;
    connectedUsers.set(socket.id, user);
    
    console.log(`🔄 ${user.nickname} cambió de ${oldSpace} a ${space}`);
    
    io.to(oldSpace).emit("spaceUsers", getUsersInSpace(oldSpace));
    io.to(space).emit("spaceUsers", getUsersInSpace(space));
    
    try {
      const history = await Message.find({ type: 'space', space })
        .sort({ createdAt: 1 })
        .lean();
      
      const historyWithTimestamp = history.map(msg => ({
        ...msg,
        timestamp: msg.createdAt || new Date().toISOString()
      }));
      
      socket.emit("chatHistory", historyWithTimestamp);
    } catch (e) {
      console.error("❌ Error enviando historial:", e);
    }
    
    socket.to(oldSpace).emit("userLeft", { nickname: user.nickname, timestamp: new Date().toISOString() });
    socket.to(space).emit("userJoined", { nickname: user.nickname, timestamp: new Date().toISOString() });
  });

  socket.on("startDM", async ({ receiver }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    
    const dmRoom = [user.nickname, receiver].sort().join('-');
    
    socket.join(dmRoom);
    user.isDM = true;
    user.dmWith = receiver;
    user.dmRoom = dmRoom;
    connectedUsers.set(socket.id, user);
    
    console.log(`💬 DM iniciado entre ${user.nickname} y ${receiver}`);
    
    try {
      const history = await Message.find({
        type: 'dm',
        $or: [
          { sender: user.nickname, receiver },
          { sender: receiver, receiver: user.nickname }
        ]
      }).sort({ createdAt: 1 }).lean();
      
      const historyWithTimestamp = history.map(msg => ({
        ...msg,
        timestamp: msg.createdAt || new Date().toISOString()
      }));
      
      socket.emit("dmHistory", historyWithTimestamp);
      console.log(`📦 Enviando ${history.length} mensajes DM`);
    } catch (e) {
      console.error("❌ Error enviando historial DM:", e);
    }
  });

  socket.on("closeDM", async ({ space = 'general' }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    
    if (user.dmRoom) {
      socket.leave(user.dmRoom);
    }
    
    user.isDM = false;
    user.dmWith = null;
    user.dmRoom = null;
    user.space = space;
    connectedUsers.set(socket.id, user);
    
    socket.join(space);
    
    console.log(`🔙 ${user.nickname} volvió al espacio ${space}`);
    
    try {
      const history = await Message.find({ type: 'space', space })
        .sort({ createdAt: 1 })
        .lean();
      
      socket.emit("chatHistory", history.map(msg => ({
        ...msg,
        timestamp: msg.createdAt || new Date().toISOString()
      })));
    } catch (e) {
      console.error("❌ Error:", e);
    }
    
    io.to(space).emit("spaceUsers", getUsersInSpace(space));
  });

  socket.on("sendMessage", async ({ sender, content, image }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    
    try {
      let saved;
      
      if (user.isDM) {
        saved = await Message.create({
          sender,
          content: content || '',
          type: 'dm',
          receiver: user.dmWith,
          image: image || undefined
        });
        
        const dmRoom = user.dmRoom;
        const messageToSend = {
          ...saved.toObject(),
          timestamp: saved.createdAt.toISOString()
        };
        
        io.to(dmRoom).emit("receiveDM", messageToSend);
        
        connectedUsers.forEach((otherUser, otherSocketId) => {
          if (otherUser.nickname === user.dmWith && !otherUser.isDM) {
            io.to(otherSocketId).emit("newDMNotification", {
              from: sender,
              preview: content ? content.substring(0, 50) : '📷 Imagen'
            });
          }
        });
        
        console.log(`💬 Mensaje DM de ${sender} a ${user.dmWith}`);
      } else {
        saved = await Message.create({
          sender,
          content: content || '',
          type: 'space',
          space: user.space,
          image: image || undefined
        });
        
        const messageToSend = {
          ...saved.toObject(),
          timestamp: saved.createdAt.toISOString()
        };
        
        io.to(user.space).emit("receiveMessage", messageToSend);
        console.log(`📨 Mensaje en espacio ${user.space} de ${sender}`);
      }
    } catch (e) {
      console.error("❌ Error guardando mensaje:", e);
    }
  });

  socket.on("disconnect", () => {
    const user = connectedUsers.get(socket.id);
    
    if (user) {
      console.log(`🔴 ${user.nickname} desconectado`);
      connectedUsers.delete(socket.id);
      
      if (!user.isDM) {
        io.to(user.space).emit("spaceUsers", getUsersInSpace(user.space));
        socket.to(user.space).emit("userLeft", { nickname: user.nickname, timestamp: new Date().toISOString() });
      }
      
      io.emit("allUsers", getAllConnectedUsers());
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}`);
  console.log(`🌐 CORS habilitado para: ${allowedOrigins.join(', ')}`);
});