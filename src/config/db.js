import mongoose from "mongoose";
import { autoSeedSuperAdmin } from "../utils/autoSeed.js";
import dns from "dns";

const connectDB = async () => {
  try {
    // Force Google DNS to resolve Atlas SRV/TXT records (fixes ESERVFAIL on some routers/ISPs)
    dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

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