const express = require('express');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

const RABBITMQ_URL = 'amqp://rabbitmq:5672'; // Docker service name
const QUEUE_NAME = 'order_queue';

let channel;

// Connect to RabbitMQ
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

// The "Buy" Endpoint
app.post('/buy', async (req, res) => {
    const { userId, productId, quantity } = req.body;

    if (!userId || !productId || !quantity) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const orderData = { userId, productId, quantity, timestamp: Date.now() };

    // Send to Queue
    // We use Buffer.from because RabbitMQ expects binary data
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(orderData)), {
        persistent: true // Ensure data is saved to disk if RabbitMQ crashes
    });

    console.log(`[API] Queued order for User ${userId}`);
    
    // Respond immediately - don't make the user wait for DB processing!
    return res.status(202).json({ 
        message: "Order received! Processing...", 
        status: "QUEUED" 
    });
});

app.listen(3000, () => console.log('🚀 API running on port 3000'));