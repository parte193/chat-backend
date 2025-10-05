import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true },
    content: { type: String, required: true },
    receiver: { type: String }
  },
  { timestamps: { createdAt: "timestamp" } }
);

export default mongoose.model("Message", MessageSchema);
