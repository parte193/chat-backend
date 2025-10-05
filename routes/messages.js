import { Router } from "express";
import Message from "../models/Message.js";

const router = Router();

// 🔹 Obtener todos los mensajes (solo para pruebas)
router.get("/", async (_req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener mensajes" });
  }
});

export default router;
