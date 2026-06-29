import mongoose from "mongoose";
import { autoSeedSuperAdmin } from "../utils/autoSeed.js";
import dns from "dns";

// Set DNS at module load time so it applies before any MongoDB driver
// connection attempt (e.g., MongoStore.create in app.js)
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// Override dns.lookup so TCP/TLS connections (which use getaddrinfo)
// instead use Node.js's dns.resolve4 which respects dns.setServers
const originalLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
  if (typeof options === "function") { callback = options; options = {}; }
  const family = options?.family || 4;
  if (family === 6) {
    dns.resolve6(hostname, (err, addresses) => {
      if (err) return callback(err);
      callback(null, addresses[0], 6);
    });
  } else {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return callback(err);
      callback(null, addresses[0], 4);
    });
  }
};

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