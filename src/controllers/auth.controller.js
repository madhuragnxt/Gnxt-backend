import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import ActivityLog from "../models/ActivityLog.js";

const JWT_SECRET  = process.env.JWT_SECRET  || "gnxt_super_secret_2026";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

// Define a static Super Admin user profile for offline/development fallback
export const STATIC_ADMIN = {
  _id: "000000000000000000000001",
  username: "admin",
  email: "admin@gnxt.com",
  role: "Super Admin",
  branch: "All Branches",
  status: "Active",
  avatar: "SA",
  permissions: [
    { module: "Dashboard", view: true, create: true, edit: true, delete: true },
    { module: "Shipments", view: true, create: true, edit: true, delete: true },
    { module: "Vehicles", view: true, create: true, edit: true, delete: true },
    { module: "Drivers", view: true, create: true, edit: true, delete: true },
    { module: "Invoices", view: true, create: true, edit: true, delete: true },
    { module: "Expenses", view: true, create: true, edit: true, delete: true },
    { module: "GPS Tracking", view: true, create: true, edit: true, delete: true },
    { module: "Reports", view: true, create: true, edit: true, delete: true },
    { module: "Users", view: true, create: true, edit: true, delete: true },
    { module: "Support", view: true, create: true, edit: true, delete: true }
  ],
  toJSON: function() {
    const obj = { ...this };
    delete obj.password;
    delete obj.toJSON;
    return obj;
  }
};

/* ── Helper: get client IP ── */
const getIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "Unknown";

/* ── POST /api/auth/login ── */
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = getIp(req);

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }

    const isMongoConnected = mongoose.connection.readyState === 1;
    const lowerUsername = username.toLowerCase();

    // 1. Try DB lookup first if MongoDB is connected
    let user = null;
    if (isMongoConnected) {
      user = await User.findOne({
        $or: [
          { username: lowerUsername },
          { email: lowerUsername },
        ],
      });
    }

    // 2. If user is found in the database, authenticate them using DB credentials
    if (user) {
      if (user.status === "Inactive") {
        return res.status(403).json({ success: false, message: "Account is inactive. Contact admin." });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        await ActivityLog.create({
          userId: user._id,
          userName: user.username,
          action: "Failed Login",
          target: "System",
          ipAddress: ip,
          status: "Failed",
        });
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      // Update lastLogin
      user.lastLogin = new Date();
      await user.save();

      // Log success
      await ActivityLog.create({
        userId: user._id,
        userName: user.username,
        action: "Login",
        target: "System",
        ipAddress: ip,
        status: "Success",
      });

      const token = jwt.sign(
        { id: user._id, role: user.role, username: user.username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      return res.status(200).json({
        success: true,
        message: "Login successful",
        token,
        user: user.toJSON(),
      });
    }

    // 3. Fallback: Check for static admin login (either if DB doesn't have the user or DB is offline)
    if (lowerUsername === "admin" || lowerUsername === "admin@gnxt.com") {
      if (password === "admin" || password === "admin123" || password === "Admin@2026" || password === "gnxt@admin@123") {
        if (isMongoConnected) {
          try {
            await ActivityLog.create({
              userName: STATIC_ADMIN.username,
              action: "Login",
              target: "System",
              ipAddress: ip,
              status: "Success",
            });
          } catch (logErr) {
            console.error("Failed to write activity log:", logErr.message);
          }
        } else {
          console.log(`[Static Mode Log] Success login for ${STATIC_ADMIN.username} from ${ip}`);
        }

        const token = jwt.sign(
          { id: STATIC_ADMIN._id, role: STATIC_ADMIN.role, username: STATIC_ADMIN.username },
          JWT_SECRET,
          { expiresIn: JWT_EXPIRES }
        );

        return res.status(200).json({
          success: true,
          message: "Static Login successful (Development/Offline Mode)",
          token,
          user: STATIC_ADMIN,
        });
      } else {
        if (isMongoConnected) {
          try {
            await ActivityLog.create({
              userName: username,
              action: "Failed Login",
              target: "System",
              ipAddress: ip,
              status: "Failed",
            });
          } catch (logErr) {
            console.error("Failed to write activity log:", logErr.message);
          }
        }
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }
    }

    // 4. If MongoDB is not connected and username is not static admin
    if (!isMongoConnected) {
      return res.status(503).json({
        success: false,
        message: "Database is offline. Please log in using the static 'admin' account."
      });
    }

    // 5. User not found and not static admin credentials
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Login failed", error: err.message });
  }
};

/* ── POST /api/auth/logout ── */
export const logout = async (req, res) => {
  try {
    const ip = getIp(req);
    const isMongoConnected = mongoose.connection.readyState === 1;
    if (req.user && isMongoConnected) {
      await ActivityLog.create({
        userId: req.user.id,
        userName: req.user.username,
        action: "Logout",
        target: "System",
        ipAddress: ip,
        status: "Success",
      });
    } else if (req.user) {
      console.log(`[Static Mode Log] Logout for ${req.user.username} from ${ip}`);
    }
    res.status(200).json({ success: true, message: "Logged out" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Logout error", error: err.message });
  }
};

/* ── GET /api/auth/me ── */
export const getMe = async (req, res) => {
  try {
    if (req.user.id === "000000000000000000000001") {
      return res.status(200).json({ success: true, data: STATIC_ADMIN });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, data: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching profile", error: err.message });
  }
};
