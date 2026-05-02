/**
 * Vercel Scheduled Function for Daily Extraction
 * 
 * Setup:
 * 1. Create Vercel account (vercel.com) - free tier
 * 2. Install Vercel CLI: npm i -g vercel
 * 3. Create project directory with this file in api/ directory
 * 4. Add vercel.json config (see below)
 * 5. Deploy: vercel --prod
 * 
 * File location: api/daily-extract.js
 * Config: vercel.json (in project root)
 */

// This runs as a Vercel Cron Job
export default async function handler(req, res) {
  // Verify it's from the cron (optional security)
  if (req.headers['user-agent'] !== 'vercel-cron') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Import your extraction logic
    const { fetchTerritoryData, processByOblast } = await import('../daily-extract.js');
    
    // Fetch and process
    const rawData = await fetchTerritoryData();
    const processedData = processByOblast(rawData);
    
    // Store in Vercel KV (key-value store) or external DB
    // Or send to your API endpoint
    
    // For now, log to console (visible in Vercel logs)
    console.log('Extraction complete:', processedData.metadata);
    
    res.status(200).json({
      success: true,
      date: new Date().toISOString(),
      oblasts: Object.keys(processedData.oblasts)
    });
    
  } catch (error) {
    console.error('Extraction failed:', error);
    res.status(500).json({ error: error.message });
  }
}

/*
vercel.json config:

{
  "crons": [
    {
      "path": "/api/daily-extract",
      "schedule": "0 20 * * *"
    }
  ]
}

Install Vercel KV to store results:
- Go to Vercel Dashboard > Storage
- Create KV database
- Use @vercel/kv package to store daily results
*/
