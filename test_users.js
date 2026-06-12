import mongoose from "mongoose";
import User from "./src/models/User.js";

async function run() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/gnxt');
    const users = await User.find({}, 'username email role permissions granularPermissions');
    console.log(JSON.stringify(users, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
