import { Router } from "express";
import Message from "../models/Message.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const msgs = await Message.find().sort({ timestamp: 1 }).lean();
    res.json(msgs);
  } catch (err) {
    console.error("GET /api/messages error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { sender, content } = req.body;
    if (!sender || !content) {
      return res.status(400).json({ error: "sender y content son requeridos" });
    }
    const msg = await Message.create({ sender, content });
    res.status(201).json(msg);
  } catch (err) {
    console.error("POST /api/messages error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
