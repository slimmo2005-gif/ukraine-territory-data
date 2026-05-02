# Cloud Deployment Options for Daily Ukraine Data Extraction

## COMPARISON TABLE

| Service | Cost | Ease | Storage | Best For |
|---------|------|------|---------|----------|
| **GitHub Actions** | Free (public repos) | ⭐ Easy | Git repo | Version history, collaboration |
| **Vercel Cron** | Free tier | ⭐⭐ Medium | Vercel KV | Serverless, API serving |
| **Railway/Render** | $5-10/mo | ⭐⭐ Medium | Postgres/S3 | Persistent database |
| **AWS Lambda + EventBridge** | ~$1-2/mo | ⭐⭐⭐ Hard | S3 | Enterprise scale |
| **Google Cloud Scheduler** | ~$1-2/mo | ⭐⭐⭐ Hard | Cloud Storage | GCP ecosystem |
| **Firebase Functions** | Spark tier free | ⭐⭐ Medium | Firestore | Mobile app integration |

---

## RECOMMENDED: GitHub Actions (Free, Simple, Reliable)

### Why GitHub Actions?
- ✅ **Completely free** for public repositories
- ✅ **Runs even when your computer is off**
- ✅ **Version control** - every day's data is committed to git history
- ✅ **Reliable** - GitHub's infrastructure, 99.9% uptime
- ✅ **Notifications** - email on failure
- ✅ **Manual trigger** - can run on-demand

### Setup Steps (5 minutes)

**1. Create GitHub Repository**
```bash
# Go to https://github.com/new
# Name: ukraine-territory-data
# Make it Public (for free Actions)
```

**2. Upload Your Files**
```bash
# In your project directory:
git init
git add daily-extract.js package.json
git commit -m "Initial extraction script"
git remote add origin https://github.com/YOURNAME/ukraine-territory-data.git
git push -u origin main
```

**3. Create GitHub Actions Workflow**
```bash
# Create directory structure:
mkdir -p .github/workflows

# Copy the workflow file I created:
cp github-actions-workflow.yml .github/workflows/daily-extract.yml

# Commit and push:
git add .github/workflows/daily-extract.yml
git commit -m "Add daily extraction workflow"
git push
```

**4. That's it!** GitHub will now run daily at 20:00 UTC.

### Viewing Results

**Option A: Download from GitHub**
- Go to your repo on GitHub
- Navigate to `daily_output/` folder
- Download JSON files

**Option B: Git Clone**
```bash
git pull origin main
# Gets latest data with all history
```

**Option C: GitHub API**
```bash
# Download latest file programmatically:
curl -L "https://raw.githubusercontent.com/YOURNAME/ukraine-territory-data/main/daily_output/ukraine_oblast_control_$(date +%Y-%m-%d).json"
```

---

## ALTERNATIVE: Vercel Scheduled Functions

### Why Vercel?
- ✅ Serverless (scales automatically)
- ✅ Good for building an API to serve the data
- ✅ Free tier: 6,000 execution hours/month

### When to use Vercel over GitHub Actions?
- You want to serve the data via API endpoint
- You need to store in database (Vercel KV)
- You want to build a dashboard frontend

### Setup
```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Create project
mkdir ukraine-extract-vercel
cd ukraine-extract-vercel
npm init -y
npm install @vercel/kv

# 4. Add vercel.json (see vercel-scheduled-function.js comments)

# 5. Deploy
vercel --prod
```

---

## ALTERNATIVE: Railway/Render (Simple PaaS)

### Why Railway/Render?
- ✅ Persistent storage (PostgreSQL)
- ✅ Easy Node.js deployment
- ✅ Good for storing time-series data

### Cost
- Railway: $5/month (512MB RAM, 1GB storage)
- Render: Free tier (limited hours) or $7/month

### When to use?
- You want a proper database (PostgreSQL)
- You need to query historical data
- Building analytics dashboard

---

## AWS LAMBDA (Enterprise Option)

### Cost
- ~$1-2/month for daily invocations
- S3 storage: $0.023/GB/month

### Components needed
1. **AWS Lambda** - Run the extraction code
2. **Amazon EventBridge** - Schedule daily trigger
3. **Amazon S3** - Store JSON results
4. **IAM Role** - Permissions

### When to use?
- You need enterprise-grade reliability
- Integration with other AWS services
- Large-scale data processing

---

## RECOMMENDED SETUP FOR YOU

Given your requirements:
- Runs when computer is off ✓
- Daily schedule ✓
- Simple ✓
- Free/cheap ✓

**I recommend: GitHub Actions**

### Quick Start Commands

```bash
# 1. Create repo on GitHub (manual step at github.com)

# 2. Initialize and push your files
cd C:\temp\ukraine-investigator
git init
git add daily-extract.js package.json

# Create workflow directory
mkdir -p .github\workflows
copy github-actions-workflow.yml .github\workflows\daily-extract.yml

git add .github\workflows\daily-extract.yml
git commit -m "Initial commit with extraction workflow"
git remote add origin https://github.com/YOUR_USERNAME/ukraine-territory-data.git
git push -u origin main

# 3. Done! GitHub will run daily at 20:00 UTC
```

### Checking if it works

1. Go to `https://github.com/YOUR_USERNAME/ukraine-territory-data`
2. Click **Actions** tab
3. See workflow runs
4. Click latest run to see logs

---

## DATA STORAGE CONSIDERATIONS

### GitHub Repository Storage
- **Pros**: Version history, free, reliable
- **Cons**: Repo size limit ~2GB (sufficient for years of daily JSON)
- **Best for**: Starting out, simple use case

### If you need more storage:

**Option A: GitHub + External Storage**
- Store JSON in GitHub (metadata, recent data)
- Archive old data to:
  - Google Drive (15GB free)
  - Dropbox (2GB free)
  - AWS S3 Glacier ($0.004/GB/month)

**Option B: Database**
- PostgreSQL on Railway/Render
- Store time-series data properly
- Query by date, oblast, control type

---

## MONITORING & ALERTS

### GitHub Actions Notifications
- Email on failure (automatic)
- Check Actions tab for status
- Can add Slack/Discord webhooks

### Add Health Check
Create `health-check.js`:
```javascript
// Ping service to verify data freshness
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./daily_output/latest.json'));
const age = Date.now() - new Date(data.metadata.extraction_date);
if (age > 25 * 60 * 60 * 1000) { // > 25 hours
  console.error('Data stale!');
  process.exit(1);
}
```

---

## TROUBLESHOOTING

### Workflow not running?
- Check Actions tab for errors
- Verify cron syntax: `0 20 * * *` (20:00 UTC)
- Ensure workflow file is in `.github/workflows/`

### Want to change time?
Edit cron in workflow file:
```yaml
# 20:00 UTC = 6:00 AM Sydney (AEST)
- cron: '0 20 * * *'

# Or 6:00 AM UTC = 4:00 PM Sydney previous day
- cron: '0 6 * * *'
```

### Need to run manually?
Go to Actions tab → Click workflow → Run workflow button

---

## SUMMARY

**Easiest setup**: GitHub Actions (free, reliable, versioned)
**Best for API**: Vercel (serverless, KV storage)
**Best for database**: Railway/Render (PostgreSQL)

**My recommendation**: Start with GitHub Actions, migrate to database if you need complex queries later.
