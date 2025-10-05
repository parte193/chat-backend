import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true },
    receiver: { type: String },
    content: { type: String },
    image: { type: Object },
    type: { type: String, enum: ["space", "dm"], required: true },
    space: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);
