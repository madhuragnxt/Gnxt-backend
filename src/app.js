import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import shipmentRoutes from "./routes/shipment.routes.js";
import expenseRoutes from "./routes/expense.routes.js";
import gpsRoutes from "./routes/gps.routes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import reportRoutes from "./routes/report.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import supportRoutes from "./routes/support.routes.js";
import { setIo } from "./controllers/gps.controller.js";
import { startOfflineDetection } from "./services/offlineDetection.js";
import { upload } from "./middleware/upload.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config();

const app = express();
const httpServer = createServer(app);   // wrap express in http.Server

/* ── CORS origin ──────────────────────────────── */
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
  : "*";

/* ── Socket.io ─────────────────────────────────── */
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

// Pass io to the GPS controller so it can broadcast
setIo(io);

// Start offline vehicle detection background job
startOfflineDetection(io);

io.on("connection", (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Client can join a vehicle-specific room to get targeted updates
  socket.on("join:vehicle", (vehicleNo) => {
    socket.join(`vehicle:${vehicleNo}`);
    console.log(`[Socket.io] ${socket.id} joined vehicle:${vehicleNo}`);
  });

  // Client can join a shipment-specific room
  socket.on("join:shipment", (shipmentId) => {
    socket.join(`shipment:${shipmentId}`);
    console.log(`[Socket.io] ${socket.id} joined shipment:${shipmentId}`);
  });

  socket.on("disconnect", () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

/* ── Middleware ────────────────────────────────── */
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(path.join(path.dirname(__dirname), "uploads")));

// Attach io instance to every request so controllers can emit socket events
app.use((req, res, next) => { req.io = io; next(); });


connectDB();

/* ── Routes ────────────────────────────────────── */
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/gps", gpsRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/support", supportRoutes);

/* ── File Upload ──────────────────────────────── */
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.status(200).json({ url: fileUrl });
});


/* ── Health check ──────────────────────────────── */
app.get(["/health", "/api/health"], (req, res) => {
  console.log(`[Health API] Health check requested from ${req.ip} at ${new Date().toLocaleTimeString()}`);
  res.status(200).json({
    message: "Server is running",
    socketClients: io.engine.clientsCount,
  });
});

/* ── Error handling ────────────────────────────── */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error", error: err.message });
});

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

/* ── Graceful shutdown ────────────────────────── */
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  httpServer.close(() => {
    mongoose.connection.close(false).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* ── Start ─────────────────────────────────────── */
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Socket.io ready`);
});
