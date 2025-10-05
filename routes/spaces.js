import { Router } from "express";
import Space from "../models/Space.js";

const router = Router();

// 🔹 Obtener todos los espacios
router.get("/", async (_req, res) => {
  try {
    const spaces = await Space.find().sort({ createdAt: 1 });
    res.json(spaces);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener espacios" });
  }
});

// 🔹 Crear nuevo espacio
router.post("/", async (req, res) => {
  try {
    const { name, description, createdBy } = req.body;

    if (!name) return res.status(400).json({ error: "El nombre es obligatorio" });

    const exists = await Space.findOne({ name });
    if (exists) return res.status(400).json({ error: "El espacio ya existe" });

    const space = await Space.create({ name, description, createdBy });
    res.status(201).json(space);
  } catch (error) {
    res.status(500).json({ error: "Error al crear espacio" });
  }
});

export default router;
