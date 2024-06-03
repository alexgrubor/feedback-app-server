import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { Redis } from "ioredis";
import "dotenv/config";

const { REDIS_CONNECTION_STRING, PORT, CORS_ORIGIN } = process.env;

if (!REDIS_CONNECTION_STRING) {
  throw new Error("Missing REDIS_CONNECTION_STRING in environment variables");
}

const app = express();
app.use(
  cors({
    origin: CORS_ORIGIN ? CORS_ORIGIN.split(",") : ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const redis = new Redis(REDIS_CONNECTION_STRING);
const subRedis = new Redis(REDIS_CONNECTION_STRING);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN ? CORS_ORIGIN.split(",") : ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

subRedis.on("message", (channel, message) => {
  io.to(channel).emit("room-update", message);
});

subRedis.on("error", (err) => {
  console.error("Redis subscription error:", err);
});

io.on("connection", async (socket) => {
  const { id } = socket;

  socket.on("join-room", async (room) => {
    try {
      console.log(`User ${id} joined room: ${room}`);

      const subscribedRooms = await redis.smembers("subscribed-rooms");
      await socket.join(room);
      await redis.sadd(`rooms:${id}`, room);
      await redis.hincrby("room-connections", room, 1);

      if (!subscribedRooms.includes(room)) {
        await new Promise<void>((resolve, reject) => {
          subRedis.subscribe(room, async (err) => {
            if (err) {
              reject(err);
            } else {
              await redis.sadd("subscribed-rooms", room);
              console.log(`Subscribed to room: ${room}`);
              resolve();
            }
          });
        });
      }
    } catch (err) {
      console.error(`Error joining room ${room} for user ${id}:`, err);
    }
  });

  socket.on("disconnect", async () => {
    try {
      const joinedRooms = await redis.smembers(`rooms:${id}`);
      await redis.del(`rooms:${id}`);

      for (const room of joinedRooms) {
        const remainingConnections = await redis.hincrby(
          "room-connections",
          room,
          -1
        );

        if (remainingConnections <= 0) {
          await redis.hdel("room-connections", room);
          await new Promise<void>((resolve, reject) => {
            subRedis.unsubscribe(room, async (err) => {
              if (err) {
                reject(err);
              } else {
                await redis.srem("subscribed-rooms", room);
                console.log(`Unsubscribed from room: ${room}`);
                resolve();
              }
            });
          });
        }
      }
    } catch (err) {
      console.error(`Error disconnecting user ${id}:`, err);
    }
  });
});

const port = PORT || 8080;

server.listen(port, () => {
  console.log(`Server is listening on port: ${port}`);
});