const express = require('express');
const amqp = require('amqplib');
const client = require('prom-client'); // Import prometheus

const app = express();
app.use(express.json());

// --- MONITORING SETUP ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics(); // Collects CPU, Memory usage automatically

// Custom Metric: Count total order requests
const orderCounter = new client.Counter({
    name: 'flashsale_order_requests_total',
    help: 'Total number of order requests received',
    labelNames: ['status'] // e.g., 'queued', 'rejected'
});
// ------------------------

const RABBITMQ_URL = 'amqp://rabbitmq:5672';
const QUEUE_NAME = 'order_queue';

let channel;

async function connectRabbit() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log("✅ Connected to RabbitMQ");
    } catch (error) {
        console.error("RabbitMQ connection failed (retrying in 5s)...", error);
        setTimeout(connectRabbit, 5000);
    }
}
connectRabbit();

// METRICS ENDPOINT (Prometheus scrapes this)
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

app.post('/buy', async (req, res) => {
    const { userId, productId, quantity } = req.body;

    if (!userId || !productId || !quantity) {
        orderCounter.inc({ status: 'bad_request' }); // Track error
        return res.status(400).json({ error: "Missing fields" });
    }

    const orderData = { userId, productId, quantity, timestamp: Date.now() };

    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(orderData)), {
        persistent: true
    });

    orderCounter.inc({ status: 'queued' }); // Track success
    console.log(`[API] Queued order for User ${userId}`);
    
    return res.status(202).json({ 
        message: "Order received! Processing...", 
        status: "QUEUED" 
    });
});

app.listen(3000, () => console.log('🚀 API running on port 3000'));