const amqp = require('amqplib');
const { Pool } = require('pg');
const Redis = require('ioredis');
const express = require('express'); // For metrics server
const client = require('prom-client');

// --- MONITORING SETUP ---
const app = express(); // Tiny server just for metrics
const orderProcessedCounter = new client.Counter({
    name: 'flashsale_orders_processed_total',
    help: 'Total orders processed by worker',
    labelNames: ['status'] // 'confirmed', 'failed', 'locked'
});

const stockGauge = new client.Gauge({
    name: 'flashsale_stock_level',
    help: 'Current stock level of products',
    labelNames: ['product_id']
});
// ------------------------

const pool = new Pool({ connectionString: 'postgresql://user:password@postgres:5432/flashsale' });
const redis = new Redis({ host: 'redis', port: 6379 });

const RABBITMQ_URL = 'amqp://rabbitmq:5672';
const QUEUE_NAME = 'order_queue';

async function processOrder(order) {
    const clientDB = await pool.connect();
    const lockKey = `lock:product:${order.productId}`;
    const lockTTL = 5000;

    try {
        const acquiredLock = await redis.set(lockKey, order.userId, 'NX', 'PX', lockTTL);

        if (!acquiredLock) {
            orderProcessedCounter.inc({ status: 'locked' }); // Metric
            console.log(`🔒 Product ${order.productId} is busy. Re-queueing... ${order.userId}`);
            throw new Error('LOCKED');
        }

        await clientDB.query('BEGIN');
        const productRes = await clientDB.query('SELECT stock FROM products WHERE id = $1', [order.productId]);
        const product = productRes.rows[0];

        // Update Gauge
        stockGauge.set({ product_id: order.productId }, product.stock);

        if (product.stock >= order.quantity) {
            await clientDB.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [order.quantity, order.productId]);
            await clientDB.query('INSERT INTO orders (user_id, product_id, quantity, status) VALUES ($1, $2, $3, $4)', [order.userId, order.productId, order.quantity, 'CONFIRMED']);
            await clientDB.query('COMMIT');
            
            // Metrics
            stockGauge.dec({ product_id: order.productId }, order.quantity);
            orderProcessedCounter.inc({ status: 'confirmed' });
            
            console.log(`✅ Order Confirmed for User ${order.userId}`);
        } else {
            await clientDB.query('INSERT INTO orders (user_id, product_id, quantity, status) VALUES ($1, $2, $3, $4)', [order.userId, order.productId, order.quantity, 'FAILED']);
            await clientDB.query('COMMIT');
            
            // Metrics
            stockGauge.set({ product_id: order.productId }, 0);
            orderProcessedCounter.inc({ status: 'failed' });
            
            console.log(`❌ Out of Stock for User ${order.userId}`);
        }

    } catch (err) {
        await clientDB.query('ROLLBACK');
        if (err.message === 'LOCKED') throw err;
        console.error(`⚠️ Error: ${err.message}`);
    } finally {
        const currentLock = await redis.get(lockKey);
        if (currentLock === order.userId) await redis.del(lockKey);
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
                        setTimeout(() => channel.nack(msg, false, true), 1000);
                    } else {
                        channel.ack(msg);
                    }
                }
            }
        });
    } catch (error) {
        setTimeout(startWorker, 5000);
    }
}

// Start Metrics Server on Port 3001 (Internal use)
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});
app.listen(3001, () => console.log('📊 Worker Metrics running on port 3001'));

startWorker();