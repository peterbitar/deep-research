#!/bin/bash
# Start the API server
cd "$(dirname "$0")"
echo "🚀 Starting Deep Research API server..."
echo "📍 Server will run on: http://localhost:3051"
echo ""
echo "Available endpoints:"
echo "  GET  /api/report/latest - Get most recent report as JSON with cards"
echo "  POST /api/generate-report-json - Generate new report and return as JSON"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""
npx tsx --env-file=.env.local src/api.ts
