/**
 * Test DeepStateMap History API
 * Check if historical snapshots are accessible
 */

import fs from 'fs';

const BASE_URL = 'https://deepstatemap.live/api';

// Test different history endpoints
async function testHistoryEndpoints() {
  console.log('='.repeat(60));
  console.log('Testing DeepStateMap History API');
  console.log('='.repeat(60));
  
  // 1. Get current snapshot info
  console.log('\n1. Current snapshot from captured data:');
  const currentData = JSON.parse(fs.readFileSync('./discovered_data/geojson_DeepStateMap_1777725794447.json', 'utf8'));
  const currentId = currentData.id;
  console.log(`   Current ID: ${currentId}`);
  console.log(`   Date (if epoch): ${new Date(currentId * 1000).toISOString()}`);
  
  // 2. Try to construct previous day IDs
  console.log('\n2. Estimated previous snapshot IDs:');
  const oneDayMs = 24 * 60 * 60 * 1000;
  const currentTimestamp = currentId * 1000;
  
  for (let i = 1; i <= 5; i++) {
    const prevTimestamp = currentTimestamp - (i * oneDayMs);
    const prevId = Math.floor(prevTimestamp / 1000);
    console.log(`   ${i} day(s) ago: ID ${prevId} (${new Date(prevTimestamp).toISOString()})`);
  }
  
  // 3. Try common history API patterns
  console.log('\n3. Testing history API patterns:');
  
  const patternsToTest = [
    `${BASE_URL}/history`,
    `${BASE_URL}/history/`,
    `${BASE_URL}/history/list`,
    `${BASE_URL}/history/all`,
    `${BASE_URL}/snapshots`,
  ];
  
  for (const url of patternsToTest) {
    try {
      console.log(`\n   Testing: ${url}`);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      console.log(`   Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`   ✓ SUCCESS - Type: ${data.type || typeof data}`);
        if (Array.isArray(data)) {
          console.log(`   Array length: ${data.length}`);
          console.log(`   Sample: ${JSON.stringify(data[0]).substring(0, 200)}`);
        } else {
          console.log(`   Keys: ${Object.keys(data).join(', ')}`);
        }
      } else {
        console.log(`   Response: ${await response.text().catch(() => 'N/A')}`);
      }
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  // 4. Try specific historical snapshot
  console.log('\n4. Testing specific historical snapshot:');
  const testId = currentId - 86400; // Subtract ~1 day
  const historyUrl = `${BASE_URL}/history/${testId}`;
  console.log(`   Testing: ${historyUrl}`);
  
  try {
    const response = await fetch(historyUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log(`   Status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✓ SUCCESS - Retrieved historical snapshot`);
      console.log(`   Snapshot ID: ${data.id}`);
      console.log(`   Features: ${data.map?.features?.length || 'N/A'}`);
      
      // Save if valid
      if (data.map?.features) {
        const fileName = `./discovered_data/history_${testId}.json`;
        fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
        console.log(`   Saved to: ${fileName}`);
      }
    } else {
      console.log(`   Response: ${await response.text().catch(() => 'N/A')}`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('History API Test Complete');
  console.log('='.repeat(60));
}

testHistoryEndpoints().catch(console.error);
