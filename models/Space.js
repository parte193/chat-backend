import mongoose from "mongoose";

const spaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String },
    createdBy: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Space", spaceSchema);
