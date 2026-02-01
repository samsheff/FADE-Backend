#!/bin/bash

# Polymarket Terminal Backend - API Verification Script
# This script tests all API endpoints to verify the server is working correctly

set -e

BASE_URL="http://localhost:3000"
WALLET="0x742d35Cc6634C0532925a3b844Bc454e4438f44e"

echo "🔍 Polymarket Terminal Backend - API Verification"
echo "================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local expected_status=${4:-200}

    echo -n "Testing: $description... "

    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint")
    status_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')

    if [ "$status_code" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status_code)"
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Expected HTTP $expected_status, got HTTP $status_code)"
        echo "Response: $body"
        return 1
    fi
}

# Wait for server to be ready
echo "⏳ Waiting for server to be ready..."
timeout 30 bash -c 'until curl -s http://localhost:3000/health > /dev/null; do sleep 1; done' || {
    echo -e "${RED}✗ Server did not start in time${NC}"
    exit 1
}
echo -e "${GREEN}✓ Server is ready${NC}"
echo ""

# Test Health Check
echo -e "${BLUE}=== Health Check ===${NC}"
test_endpoint GET "/health" "Health check endpoint"
echo ""

# Test Markets API
echo -e "${BLUE}=== Markets API ===${NC}"
test_endpoint GET "/api/v1/markets" "List all markets"
test_endpoint GET "/api/v1/markets?active=true" "Filter active markets"
test_endpoint GET "/api/v1/markets?category=crypto" "Filter by category"
test_endpoint GET "/api/v1/markets?limit=1&offset=0" "Paginate markets"
test_endpoint GET "/api/v1/markets/0x1234567890abcdef1234567890abcdef12345678" "Get market by ID"
test_endpoint GET "/api/v1/markets/nonexistent" "Get non-existent market" 404
echo ""

# Test Auth API
echo -e "${BLUE}=== Auth API ===${NC}"
test_endpoint GET "/api/v1/auth/nonce?wallet=$WALLET" "Request nonce for wallet"
test_endpoint GET "/api/v1/auth/nonce?wallet=invalid" "Request nonce with invalid wallet" 400
echo ""

# Test Protected Endpoints (should fail without auth)
echo -e "${BLUE}=== Protected Endpoints (No Auth) ===${NC}"
test_endpoint GET "/api/v1/positions/$WALLET" "Get positions without auth" 400
echo ""

# Test Documentation
echo -e "${BLUE}=== Documentation ===${NC}"
test_endpoint GET "/documentation" "Swagger UI"
test_endpoint GET "/documentation/json" "OpenAPI spec"
echo ""

# Summary
echo "================================================"
echo -e "${GREEN}✓ All API verification tests completed!${NC}"
echo ""
echo "📚 View full API documentation at: $BASE_URL/documentation"
echo "🏥 Health check: $BASE_URL/health"
