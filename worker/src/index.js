const amqp = require('amqplib');
const { Pool } = require('pg');
const Redis = require('ioredis');
const express = require('express'); 
const client = require('prom-client');

// --- MONITORING SETUP ---
const app = express();
const orderProcessedCounter = new client.Counter({
    name: 'flashsale_orders_processed_total',
    help: 'Total orders processed by worker',
    labelNames: ['status']
});

const stockGauge = new client.Gauge({
    name: 'flashsale_stock_level',
    help: 'Current stock level of products',
    labelNames: ['product_id']
});


const pool = new Pool({ connectionString: 'postgresql://user:password@postgres:5432/flashsale' });
const redis = new Redis({ host: 'redis', port: 6379 }); 

const RABBITMQ_URL = 'amqp://rabbitmq:5672';
const QUEUE_NAME = 'order_queue';

async function processOrder(order) {
    // 1. IDEMPOTENCY CHECK (Start)
    // If the order has a key and we have already seen it, stop immediately.
    if (order.idempotencyKey) {
        const processedKey = `processed:${order.idempotencyKey}`;
        const alreadyProcessed = await redis.get(processedKey);
        if (alreadyProcessed) {
            console.log(`🔁 Duplicate Message Ignored: ${order.idempotencyKey}`);
            return; // Exit function, the worker will ACK this message and move on
        }
    }

    const clientDB = await pool.connect();
    const lockKey = `lock:product:${order.productId}`;
    const lockTTL = 10000; 

    try {
        // Attempt to acquire distributed lock
        const acquiredLock = await redis.set(lockKey, order.userId, 'NX', 'PX', lockTTL);

        if (!acquiredLock) {
            orderProcessedCounter.inc({ status: 'locked' });
            console.log(`🔒 Product ${order.productId} is busy. Re-queueing... ${order.userId}`);
            throw new Error('LOCKED');
        }

        // START TRANSACTION
        await clientDB.query('BEGIN');
        
        const productRes = await clientDB.query('SELECT stock FROM products WHERE id = $1', [order.productId]);
        
        if (productRes.rows.length === 0) {
            throw new Error('Product not found');
        }

        const product = productRes.rows[0];
        stockGauge.set({ product_id: order.productId }, product.stock);

        if (product.stock >= order.quantity) {
            await clientDB.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [order.quantity, order.productId]);
            await clientDB.query('INSERT INTO orders (user_id, product_id, quantity, status) VALUES ($1, $2, $3, $4)', [order.userId, order.productId, order.quantity, 'CONFIRMED']);
            await clientDB.query('COMMIT');
            
            stockGauge.dec({ product_id: order.productId }, order.quantity);
            orderProcessedCounter.inc({ status: 'confirmed' });
            console.log(`✅ Order Confirmed for User ${order.userId}`);
        } else {
            await clientDB.query('INSERT INTO orders (user_id, product_id, quantity, status) VALUES ($1, $2, $3, $4)', [order.userId, order.productId, order.quantity, 'FAILED']);
            await clientDB.query('COMMIT');
            
            stockGauge.set({ product_id: order.productId }, 0);
            orderProcessedCounter.inc({ status: 'failed' });
            console.log(`❌ Out of Stock for User ${order.userId}`);
        }

        // 2. IDEMPOTENCY SAVE (End)
        // Mark this key as processed so we never do it again.
        if (order.idempotencyKey) {
            // Expire in 24 hours (86400 seconds) to save Redis memory
            await redis.set(`processed:${order.idempotencyKey}`, 'true', 'EX', 86400);
        }

    } catch (err) {
        // Only rollback if we actually started a transaction (avoid "no transaction in progress" warning)
        if (err.message !== 'LOCKED') {
            await clientDB.query('ROLLBACK');
        }
        
        if (err.message === 'LOCKED') throw err;
        console.error(`⚠️ Error: ${err.message}`);
    } finally {
        // Release the lock if this worker owns it
        const currentLock = await redis.get(lockKey);
        if (currentLock === order.userId) {
            await redis.del(lockKey);
        }
        clientDB.release();
    }
}

async function startWorker() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        channel.prefetch(1);

        console.log("👷 Worker waiting for messages...");

        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                const orderData = JSON.parse(msg.content.toString());
                try {
                    await processOrder(orderData);
                    channel.ack(msg);
                } catch (err) {
                    if (err.message === 'LOCKED') {
                        // Requeue with a slight delay
                        setTimeout(() => channel.nack(msg, false, true), 500); 
                    } else {
                        channel.ack(msg); 
                    }
                }
            }
        });
    } catch (error) {
        console.log("RabbitMQ connection failed, retrying...", error);
        setTimeout(startWorker, 5000);
    }
}

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

app.listen(3001, () => console.log('📊 Worker Metrics running on port 3001'));

startWorker();