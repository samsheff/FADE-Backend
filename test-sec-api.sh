#!/bin/bash
# Quick test to verify SEC EDGAR API is accessible

echo "Testing SEC EDGAR API access..."
echo ""

# Test 1: Fetch Tesla filings
echo "1. Fetching Tesla (CIK 0001318605) recent filings..."
RESPONSE=$(curl -s -H "User-Agent: Test Script" "https://data.sec.gov/submissions/CIK0001318605.json")

if [ $? -eq 0 ]; then
    echo "✅ SEC API is accessible"

    # Parse and show recent filings count
    FILING_COUNT=$(echo "$RESPONSE" | grep -o '"accessionNumber"' | wc -l)
    echo "   Found $FILING_COUNT recent filings for Tesla"

    # Show first few forms
    echo ""
    echo "   Recent form types:"
    echo "$RESPONSE" | grep -o '"form":"[^"]*"' | head -10 | sed 's/"form":"//g' | sed 's/"//g' | sed 's/^/   - /'
else
    echo "❌ Failed to connect to SEC API"
    echo "   Check your internet connection"
fi

echo ""

# Test 2: Check if we can filter for specific forms
echo "2. Testing form type filtering..."
FORM_8K_COUNT=$(echo "$RESPONSE" | grep -o '"form":"8-K"' | wc -l)
FORM_10Q_COUNT=$(echo "$RESPONSE" | grep -o '"form":"10-Q"' | wc -l)
FORM_10K_COUNT=$(echo "$RESPONSE" | grep -o '"form":"10-K"' | wc -l)

echo "   - 8-K filings: $FORM_8K_COUNT"
echo "   - 10-Q filings: $FORM_10Q_COUNT"
echo "   - 10-K filings: $FORM_10K_COUNT"

echo ""
echo "If you see counts above, the SEC API is working correctly!"
echo "The EDGAR worker should be able to discover filings."
