CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    stock INT NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    product_id INT REFERENCES products(id),
    quantity INT NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed data for the stress test (Product ID 1)
INSERT INTO products (id, name, stock) 
VALUES (1, 'Flash Sale Item', 100) 
ON CONFLICT (id) DO NOTHING;