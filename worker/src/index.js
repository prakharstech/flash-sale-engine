const amqp = require('amqplib');
const { Pool } = require('pg');
const Redis = require('ioredis'); // New dependency

// Database Connection
const pool = new Pool({
    connectionString: 'postgresql://user:password@postgres:5432/flashsale'
});

// Redis Connection (The Gatekeeper)
const redis = new Redis({
    host: 'redis', // Docker service name
    port: 6379
});

const RABBITMQ_URL = 'amqp://rabbitmq:5672';
const QUEUE_NAME = 'order_queue';

async function processOrder(order) {
    const client = await pool.connect();
    // Unique Lock Key: Only one worker can process this PRODUCT at a time
    const lockKey = `lock:product:${order.productId}`; 
    const lockValue = order.userId; // Who owns the lock?
    const lockTTL = 5000; // 5 seconds expiry (prevent deadlocks)

    try {
        // --- STEP 1: DISTRIBUTED LOCK ACQUISITION ---
        // "SET if Not eXists" (NX) with Expiry (PX)
        // If this returns 'OK', we have the lock. If null, someone else is busy.
        const acquiredLock = await redis.set(lockKey, lockValue, 'NX', 'PX', lockTTL);

        if (!acquiredLock) {
            console.log(`🔒 Product ${order.productId} is busy. Re-queueing order for ${order.userId}...`);
            throw new Error('LOCKED'); // Throwing error will cause RabbitMQ to re-queue it
        }

        // --- STEP 2: DATABASE TRANSACTION ---
        await client.query('BEGIN');
        
        const productRes = await client.query('SELECT stock FROM products WHERE id = $1', [order.productId]);
        const product = productRes.rows[0];

        if (product.stock >= order.quantity) {
            await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [order.quantity, order.productId]);
            await client.query('INSERT INTO orders (user_id, product_id, quantity, status) VALUES ($1, $2, $3, $4)', [order.userId, order.productId, order.quantity, 'CONFIRMED']);
            await client.query('COMMIT');
            console.log(`✅ Order Confirmed for User ${order.userId}`);
        } else {
            await client.query('INSERT INTO orders (user_id, product_id, quantity, status) VALUES ($1, $2, $3, $4)', [order.userId, order.productId, order.quantity, 'FAILED']);
            await client.query('COMMIT');
            console.log(`❌ Out of Stock for User ${order.userId}`);
        }

    } catch (err) {
        await client.query('ROLLBACK');
        
        // If it was just a lock contention, we re-throw so RabbitMQ tries again later
        if (err.message === 'LOCKED') throw err;
        
        console.error(`⚠️ System Error: ${err.message}`);
    } finally {
        // --- STEP 3: RELEASE LOCK ---
        // Only release if WE were the ones who set it (Lua script is better for this, but this is okay for MVP)
        const currentLock = await redis.get(lockKey);
        if (currentLock === lockValue) {
            await redis.del(lockKey);
        }
        client.release();
    }
}

async function startWorker() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        channel.prefetch(1);

        console.log("👷 Worker (Redis-Powered) waiting for messages...");

        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                const orderData = JSON.parse(msg.content.toString());
                try {
                    await processOrder(orderData);
                    channel.ack(msg);
                } catch (err) {
                    if (err.message === 'LOCKED') {
                        // If locked, wait 1s and put back in queue (NACK with requeue)
                        setTimeout(() => channel.nack(msg, false, true), 1000); 
                    } else {
                        channel.ack(msg); // Discard bad data
                    }
                }
            }
        });
    } catch (error) {
        setTimeout(startWorker, 5000);
    }
}

startWorker();