# Troubleshooting Railway Deployment

## 502 Error: "Application failed to respond"

This means Railway can't reach your app. Common causes:

### 1. Port Mismatch (Most Common)

**Problem:** Railway is routing to one port, but your app listens on another.

**Solution:**
- Railway automatically sets `PORT` environment variable
- Your app should listen on `process.env.PORT` (which it does: `const port = process.env.PORT || 3051`)
- **In Railway Networking settings:**
  - Check what `PORT` is set to (Settings → Variables)
  - Or use the **default Railway port** (usually `$PORT` or `3000`)
  - Enter that port when generating the domain

**How to check:**
1. Go to Railway → Settings → Variables
2. Look for `PORT` variable
3. If not set, Railway will auto-assign (usually 3000-10000)
4. Use that port number in Networking → Generate Domain

### 2. App Not Running

**Check Deploy Logs:**
- Railway → Deployments → Click latest deployment → "Deploy Logs"
- Look for errors or crash messages
- Should see: `Deep Research API running on port XXXX`

### 3. Missing Environment Variables

**Check Required Variables:**
- `OPENAI_KEY` or `FIREWORKS_KEY` (at least one)
- `FIRECRAWL_KEY` (required)

### 4. Quick Fix: Try Port 3000

Railway often uses port 3000 by default:
1. Go to Networking settings
2. Delete the current domain (if any)
3. Generate new domain with port `3000`
4. Test again

### 5. Check App is Actually Running

In Railway Deploy Logs, you should see:
```
Deep Research API running on port 3051
```
(or whatever port Railway assigned)

If you don't see this, the app crashed. Check the logs for errors.

## Testing Commands

```bash
# Test your deployed API
curl https://deep-research-production-0185.up.railway.app/api/podcast/latest

# Check if it's responding at all
curl -v https://deep-research-production-0185.up.railway.app
```

## Still Not Working?

1. Check Railway Deploy Logs for runtime errors
2. Verify all environment variables are set
3. Try redeploying (Settings → Redeploy)
4. Check if the port in Networking matches what Railway assigned
