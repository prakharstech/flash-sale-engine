# ⚡ Flash Sale Engine

A high-concurrency, fault-tolerant e-commerce backend engine designed to handle "Flash Sale" events (high traffic, limited inventory). 

This project demonstrates how to handle race conditions, ensure data consistency, and process orders asynchronously using **Node.js**, **RabbitMQ**, **Redis**, and **PostgreSQL**. It also includes full monitoring with **Prometheus** and **Grafana**.

---

## 🚀 Features

* **Asynchronous Processing:** Decouples order reception from processing using RabbitMQ to handle traffic spikes.
* **Concurrency Control:** Uses Redis Distributed Locks (via `ioredis`) to prevent race conditions during stock updates.
* **Idempotency:** Ensures that duplicate requests (network retries) do not result in double bookings.
* **Transactional Integrity:** Uses PostgreSQL transactions to ensure orders are only created if stock is successfully deducted.
* **Scalable Architecture:** Separate API (Producer) and Worker (Consumer) services containerized with Docker.
* **Real-time Monitoring:** Built-in Prometheus metrics for order rates, stock levels, and system health.

---

## 🏗️ Architecture

The system consists of the following microservices orchestrated via Docker Compose:

1.  **API Service (Port 3000):** * Receives `POST /buy` requests.
    * Validates input.
    * Pushes the order event to the RabbitMQ queue (`order_queue`).
    * Returns an immediate "Queued" response to the client.
2.  **RabbitMQ:** Message broker buffering requests between the API and Worker.
3.  **Worker Service:** * Consumes messages from the queue.
    * Checks idempotency key in Redis to avoid duplicates.
    * Acquires a distributed lock for the specific product.
    * Updates PostgreSQL database (deduct stock, create order) inside a transaction.
    * Releases lock and acknowledges the message.
4.  **Redis:** Used for distributed locking and caching idempotency keys.
5.  **PostgreSQL:** Persistent storage for `products` and `orders`.
6.  **Monitoring Stack:** Prometheus (Metrics collection) and Grafana (Visualization).

---

## 🛠️ Prerequisites

* **Docker** and **Docker Compose** installed on your machine.
* *Optional:* `curl` or Postman for testing.

---

## 📦 Installation & Setup

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd flash-sale-engine
    ```

2.  **Start the services**
    Run the application in detached mode:
    ```bash
    docker-compose up --build -d
    ```

    This will spin up:
    * **PostgreSQL** (Port 5432)
    * **Redis** (Port 6379)
    * **RabbitMQ** (Port 5672/15672)
    * **API** (Port 3000)
    * **Worker** (3 Replicas, internal network)
    * **Prometheus** (Port 9090)
    * **Grafana** (Port 3002)

3.  **Verify Database Initialization**
    The `init.sql` script automatically seeds the database with a test product:
    * **Product ID:** `1`
    * **Name:** `Flash Sale Item`
    * **Stock:** `100`

---

## 📡 API Documentation

### 1. Place an Order
**Endpoint:** `POST http://localhost:3000/buy`

**Headers:**
* `Content-Type`: `application/json`
* `idempotency-key`: *(Optional)* Unique string to prevent duplicate processing.

**Body:**
```json
{
  "userId": "user_123",
  "productId": 1,
  "quantity": 1
}
```

### 2. Check Metrics (API)
**Endpoint:** `GET http://localhost:3000/metrics`  
Exposes Prometheus metrics including `flashsale_order_requests_total`.

---

## 🧪 Testing & Simulation
A stress test script is included to simulate concurrent traffic.

1. **Make the script executable:**
   ```bash
   chmod +x stress_test.sh
   ```
2. **Run the simulation:**
    ```bash
    ./stress_test.sh
    ```
    This sends 20 concurrent buy requests for Product ID 1.

---

## 📊 Monitoring
The project includes a pre-configured monitoring stack.

* **Prometheus:** http://localhost:9090 Check targets status to ensure API and Workers are being scraped.

* **Grafana:** http://localhost:3002 Default Login: admin / admin Connect Prometheus as a data source (http://prometheus:9090) to visualize metrics.

### Key Metrics available:

* **flashsale_stock_level:** Current stock for products.

* **flashsale_orders_processed_total:** Counts of confirmed, failed, or locked attempts.

---

## 📂 Project Structure

```text
.
├── api/                  # Express API Service
│   ├── Dockerfile
│   └── src/index.js      # API Logic (Producer)
├── worker/               # Worker Service
│   ├── Dockerfile
│   └── src/index.js      # Worker Logic (Consumer + DB Transaction)
├── monitoring/
│   └── prometheus.yml    # Prometheus Configuration
├── init.sql              # Database Schema & Seed Data
├── docker-compose.yml    # Orchestration
├── stress_test.sh        # Load testing script
└── .gitignore
```

---

## 🛡️ License
ISC