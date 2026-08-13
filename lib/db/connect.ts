import mongoose from "mongoose";

const mongoUri = process.env.MONGODB_URI;

let isConnected = false;

export async function connectToDatabase() {
  if (!mongoUri) {
    return false;
  }

  if (isConnected) {
    return true;
  }

  try {
    await mongoose.connect(mongoUri);
    isConnected = true;
    return true;
  } catch {
    return false;
  }
}

export function isMongoConfigured() {
  return Boolean(mongoUri);
}
