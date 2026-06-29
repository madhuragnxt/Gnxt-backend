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
  if (typeof options === "number") { options = { family: options }; }
  const family = options?.family || 4;
  const resolver = family === 6 ? dns.resolve6 : dns.resolve4;
  resolver(hostname, (err, addresses) => {
    if (err || !addresses?.[0]) {
      return originalLookup(hostname, options, callback);
    }
    callback(null, addresses[0], family);
  });
};

// Prevent unhandled MongoDB driver rejections from crashing the server
process.on("unhandledRejection", (reason) => {
  if (reason?.message?.includes("Mongo") || reason?.message?.includes("mongo") || reason?.message?.includes("topology")) {
    console.warn("⚠️ Caught unhandled MongoDB rejection — server continues in offline mode.");
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

const connectDB = async () => {
  try {
    // Suppress MongoDB error events to prevent process crashes
    mongoose.connection.on("error", (err) => {
      console.warn("⚠️ MongoDB connection error suppressed:", err.message.substring(0, 100));
    });

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