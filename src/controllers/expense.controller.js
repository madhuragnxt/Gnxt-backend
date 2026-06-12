import Expense from "../models/expense.model.js";
import Shipment from "../models/shipment.model.js";
import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";

/* ─────────────────────────────────────────────────
   GET /api/expenses
   List expenses with optional filters
 ───────────────────────────────────────────────── */
export const getExpenses = async (req, res) => {
  try {
    const { lrNumber, vehicleId, driverId, dateFrom, dateTo, tripId } = req.query;
    const query = {};

    if (lrNumber) query.lrNumber = { $regex: lrNumber, $options: "i" };
    if (tripId) query.tripId = { $regex: tripId, $options: "i" };
    if (vehicleId) query.vehicleId = vehicleId;
    if (driverId) query.driverId = driverId;

    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo) query.date.$lte = new Date(dateTo);
    }

    const expenses = await Expense.find(query)
      .sort({ date: -1 })
      .lean();

    // Dynamically resolve missing tripId values for complete resilience
    const shipments = await Shipment.find({})
      .select("_id shipmentId destinations.lrNumber")
      .lean();

    const shipmentMapByRef = new Map();
    const shipmentMapByLr = new Map();

    shipments.forEach((s) => {
      if (s._id) shipmentMapByRef.set(s._id.toString(), s.shipmentId);
      s.destinations?.forEach((d) => {
        if (d.lrNumber) shipmentMapByLr.set(d.lrNumber, s.shipmentId);
      });
    });

    // Shape response to match what the frontend expects
    const shaped = expenses.map((e) => {
      let resolvedTripId = e.tripId || "";
      if (!resolvedTripId) {
        if (e.shipmentId) {
          resolvedTripId = shipmentMapByRef.get(e.shipmentId.toString()) || "";
        }
        if (!resolvedTripId && e.lrNumber) {
          resolvedTripId = shipmentMapByLr.get(e.lrNumber) || "";
        }
      }

      return {
        ...e,
        tripId: resolvedTripId,
        vehicleId: e.vehicleNo || e.vehicleId?.toString() || "",
        driverName: e.driverName || "",
        amount: e.totalAmount !== undefined ? e.totalAmount : (e.amount || 0),
      };
    });

    res.status(200).json(shaped);
  } catch (err) {
    console.error("Get expenses error:", err);
    res.status(500).json({ success: false, message: "Error fetching expenses", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   POST /api/expenses
   Create new expense entry/entries (possibly with multiple items/records)
 ───────────────────────────────────────────────── */
export const createExpense = async (req, res) => {
  try {
    const {
      tripId,
      entries, // Array of { lrNumber, items, date, notes, receiptUrl, paymentMode }
      lrNumber,
      vehicleId,
      driverId,
      items,
      date,
      notes,
      receiptUrl,
      paymentMode,
    } = req.body;

    const isObjectId = (id) => id && typeof id === "string" && id.length === 24 && /^[0-9a-fA-F]{24}$/.test(id);

    // Helper to resolve shipment details
    const resolveShipmentDetails = async (lr, tId) => {
      let shipmentRef = null;
      let finalVehicleId = undefined;
      let vehicleNo = "";
      let finalDriverId = undefined;
      let driverName = "";
      let resolvedTripId = tId || "";

      if (lr) {
        const s = await Shipment.findOne({ "destinations.lrNumber": lr })
          .select("_id shipmentId vehicleId driverId vehicleNumber driverName")
          .lean();
        if (s) {
          shipmentRef = s._id;
          finalVehicleId = s.vehicleId;
          vehicleNo = s.vehicleNumber || "";
          finalDriverId = s.driverId;
          driverName = s.driverName || "";
          resolvedTripId = s.shipmentId || "";
        }
      } else if (tId) {
        const s = await Shipment.findOne({ shipmentId: tId })
          .select("_id shipmentId vehicleId driverId vehicleNumber driverName")
          .lean();
        if (s) {
          shipmentRef = s._id;
          finalVehicleId = s.vehicleId;
          vehicleNo = s.vehicleNumber || "";
          finalDriverId = s.driverId;
          driverName = s.driverName || "";
          resolvedTripId = s.shipmentId || "";
        }
      }
      return { shipmentRef, finalVehicleId, vehicleNo, finalDriverId, driverName, resolvedTripId };
    };

    // Case 1: Bulk creations (Multiple expense entries from same form submission)
    if (entries && Array.isArray(entries) && entries.length > 0) {
      const createdExpenses = [];

      for (const entry of entries) {
        const resolved = await resolveShipmentDetails(entry.lrNumber, tripId);

        let finalVehicleId = resolved.finalVehicleId;
        let vehicleNo = resolved.vehicleNo;
        let finalDriverId = resolved.finalDriverId;
        let driverName = resolved.driverName;

        // Fallbacks
        if (!finalVehicleId && isObjectId(vehicleId)) {
          const v = await Vehicle.findById(vehicleId).select("vehicleNo").lean();
          finalVehicleId = vehicleId;
          vehicleNo = v?.vehicleNo || "";
        }
        if (!finalDriverId && isObjectId(driverId)) {
          const d = await Driver.findById(driverId).select("name").lean();
          finalDriverId = driverId;
          driverName = d?.name || "";
        }

        const entryItems = entry.items || [];
        const totalAmount = entryItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

        const exp = await Expense.create({
          tripId: resolved.resolvedTripId || tripId || "",
          lrNumber: entry.lrNumber || "",
          vehicleId: finalVehicleId,
          vehicleNo,
          driverId: finalDriverId,
          driverName,
          shipmentId: resolved.shipmentRef || undefined,
          items: entryItems,
          totalAmount,
          date: entry.date ? new Date(entry.date) : new Date(),
          notes: entry.notes || "",
          receiptUrl: entry.receiptUrl || "",
          paymentMode: entry.paymentMode || paymentMode || "Cash",
          status: "Pending",
        });

        createdExpenses.push({
          ...exp.toObject(),
          vehicleId: exp.vehicleNo || exp.vehicleId?.toString() || "",
          driverName: exp.driverName || "",
          amount: exp.totalAmount !== undefined ? exp.totalAmount : 0,
        });
      }

      return res.status(201).json(createdExpenses);
    }

    // Case 2: Single creation (Fallback/Backward compatibility)
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one expense item is required" });
    }

    const resolved = await resolveShipmentDetails(lrNumber, tripId);
    let finalVehicleId = resolved.finalVehicleId;
    let vehicleNo = resolved.vehicleNo;
    let finalDriverId = resolved.finalDriverId;
    let driverName = resolved.driverName;

    if (!finalVehicleId && isObjectId(vehicleId)) {
      const v = await Vehicle.findById(vehicleId).select("vehicleNo").lean();
      finalVehicleId = vehicleId;
      vehicleNo = v?.vehicleNo || "";
    }
    if (!finalDriverId && isObjectId(driverId)) {
      const d = await Driver.findById(driverId).select("name").lean();
      finalDriverId = driverId;
      driverName = d?.name || "";
    }

    const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    const expense = await Expense.create({
      tripId: resolved.resolvedTripId || tripId || "",
      lrNumber: lrNumber || "",
      vehicleId: finalVehicleId,
      vehicleNo,
      driverId: finalDriverId,
      driverName,
      shipmentId: resolved.shipmentRef || undefined,
      items,
      totalAmount,
      date: date ? new Date(date) : new Date(),
      notes: notes || "",
      receiptUrl: receiptUrl || "",
      paymentMode: paymentMode || "Cash",
      status: "Pending",
    });

    const shaped = {
      ...expense.toObject(),
      vehicleId: expense.vehicleNo || expense.vehicleId?.toString() || "",
      driverName: expense.driverName || "",
      amount: expense.totalAmount !== undefined ? expense.totalAmount : 0,
    };

    res.status(201).json(shaped);
  } catch (err) {
    console.error("Create expense error:", err);
    res.status(500).json({ success: false, message: "Error creating expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/expenses/:id
 ───────────────────────────────────────────────── */
export const getExpenseById = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).lean();
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    res.status(200).json(expense);
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   PUT /api/expenses/:id
 ───────────────────────────────────────────────── */
export const updateExpense = async (req, res) => {
  try {
    const { items, date, notes, lrNumber, receiptUrl, paymentMode, status } = req.body;

    const update = {};
    if (items && Array.isArray(items)) {
      update.items = items;
      update.totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    }
    if (date) update.date = new Date(date);
    if (notes !== undefined) update.notes = notes;
    if (lrNumber !== undefined) update.lrNumber = lrNumber;
    if (receiptUrl !== undefined) update.receiptUrl = receiptUrl;
    if (paymentMode !== undefined) update.paymentMode = paymentMode;
    if (status !== undefined) update.status = status;

    const expense = await Expense.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    const shaped = {
      ...expense.toObject(),
      vehicleId: expense.vehicleNo || expense.vehicleId?.toString() || "",
      driverName: expense.driverName || "",
      amount: expense.totalAmount !== undefined ? expense.totalAmount : 0,
    };

    res.status(200).json({ success: true, data: shaped });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   DELETE /api/expenses/:id
 ───────────────────────────────────────────────── */
export const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    res.status(200).json({ success: true, message: "Expense deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error deleting expense", error: err.message });
  }
};

/* ─────────────────────────────────────────────────
   GET /api/expenses/summary
   Returns aggregated totals by expense type
 ───────────────────────────────────────────────── */
export const getExpenseSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const match = {};
    if (dateFrom || dateTo) {
      match.date = {};
      if (dateFrom) match.date.$gte = new Date(dateFrom);
      if (dateTo) match.date.$lte = new Date(dateTo);
    }

    const summary = await Expense.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.expenseType",
          total: { $sum: "$items.amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const grandTotal = summary.reduce((s, e) => s + e.total, 0);
    res.status(200).json({ success: true, data: { summary, grandTotal } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching summary", error: err.message });
  }
};
