import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Ramp up to 100 users
    { duration: '1m', target: 100 },  // Stay at 100 users (Stress)
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be under 500ms
    http_req_failed: ['rate<0.01'],   // Error rate should be less than 1%
  },
};

export default function () {
  const url = 'http://localhost:3000/buy';
  const payload = JSON.stringify({
    userId: `user_${Math.floor(Math.random() * 100000)}`,
    productId: 1,
    quantity: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'idempotency-key': `k6_${Date.now()}_${Math.random()}`,
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    'is status 202': (r) => r.status === 202,
  });

  sleep(0.1); // Small pause between requests per virtual user
}