import mongoose from "mongoose";
import { autoSeedSuperAdmin } from "../utils/autoSeed.js";
import dns from "dns";

// Set DNS at module load time so it applies before any MongoDB driver
// connection attempt (e.g., MongoStore.create in app.js)
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

const connectDB = async () => {
  try {

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("MongoDB Connected",process.env.MONGO_URI);
    await autoSeedSuperAdmin();
  } catch (error) {
    console.error("DB Error:", error.message);
    console.warn("⚠️ Database connection failed. Running server in static/offline mode.");
  }
};

export default connectDB;