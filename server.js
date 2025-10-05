import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

import messagesRouter from "./routes/messages.js";
import Message from "./models/Message.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"]
  }
});

// Middlewares
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// DB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("🟢 Conectado a MongoDB Atlas"))
  .catch((err) => console.error("🔴 Error conectando a MongoDB:", err));

// Rutas REST
app.use("/api/messages", messagesRouter);
app.get("/", (_req, res) => res.send("Servidor de chat funcionando 🚀"));

// Socket.io
io.on("connection", async (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  // Envía historial al cliente que se conecta
  try {
    const history = await Message.find().sort({ timestamp: 1 }).lean();
    socket.emit("chatHistory", history);
  } catch (e) {
    console.error("Error enviando historial:", e);
  }

  // Recibe y guarda mensaje, luego lo broadcast
  socket.on("sendMessage", async ({ sender, content }) => {
    if (!sender || !content?.trim()) return;
    try {
      const saved = await Message.create({ sender, content: content.trim() });
      io.emit("receiveMessage", saved);
    } catch (e) {
      console.error("Error guardando mensaje:", e);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Usuario desconectado:", socket.id);
  });
});

// Start
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`✅ Servidor activo en puerto ${PORT}`);
});
