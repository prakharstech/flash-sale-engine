#!/bin/bash
 
echo "🚀 Starting Flash Sale Simulation..."

for i in {1..20}
do
   curl -X POST http://localhost:3000/buy \
     -H "Content-Type: application/json" \
     -d "{\"userId\": \"user_$i\", \"productId\": 1, \"quantity\": 1}" &
done

wait
echo "All requests sent!"