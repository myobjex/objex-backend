const fs = require('fs');
const content = fs.readFileSync('./server.js', 'utf-8');

// Replace LeBonCoin
const leboncoinOld = `app.post('/api/leboncoin-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching LeBonCoin prices for:', query);
    
    // Fallback if API fails
    res.json({
      success: true,
      prixMoyen: 450,
      prixBas: 200,
      prixHaut: 1200,
      count: 25,
      items: [],
      source: 'leboncoin'
    });
  } catch (error) {
    console.error('LeBonCoin API error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

const leboncoinNew = `app.post('/api/leboncoin-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching LeBonCoin prices for:', query);
    
    try {
      const axios = require('axios');
      const url = \`https://www.leboncoin.fr/recherche?text=\${encodeURIComponent(query)}\`;
      
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      
      // Simple regex to extract prices from HTML
      const priceRegex = /data-listing-price="([0-9]+)"/g;
      const prices = [];
      let match;
      while ((match = priceRegex.exec(response.data)) !== null) {
        prices.push(parseInt(match[1]));
      }
      
      if (prices.length === 0) {
        return res.json({ success: false, prixMoyen: null, prixBas: null, prixHaut: null, count: 0 });
      }
      
      const prixMoyen = Math.round(prices.reduce((a,b) => a+b) / prices.length);
      
      res.json({
        success: true,
        prixMoyen: prixMoyen,
        prixBas: Math.min(...prices),
        prixHaut: Math.max(...prices),
        count: prices.length,
        items: [],
        source: 'leboncoin'
      });
    } catch (apiError) {
      console.warn('LeBonCoin scraping failed, using fallback:', apiError.message);
      res.json({
        success: false,
        prixMoyen: null,
        prixBas: null,
        prixHaut: null,
        count: 0,
        source: 'leboncoin'
      });
    }
  } catch (error) {
    console.error('LeBonCoin endpoint error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

let updated = content.replace(leboncoinOld, leboncoinNew);

// Replace Ricardo
const ricardoOld = `app.post('/api/ricardo-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching Ricardo prices for:', query);
    
    // Fallback if API fails
    res.json({
      success: true,
      prixMoyen: 480,
      prixBas: 250,
      prixHaut: 1400,
      count: 18,
      items: [],
      source: 'ricardo'
    });
  } catch (error) {
    console.error('Ricardo API error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

const ricardoNew = `app.post('/api/ricardo-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching Ricardo prices for:', query);
    
    try {
      const axios = require('axios');
      const url = \`https://www.ricardo.ch/de/s/\${encodeURIComponent(query)}\`;
      
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      
      // Simple regex to extract prices from HTML
      const priceRegex = /CHF ([0-9]+[.,][0-9]+)/g;
      const prices = [];
      let match;
      while ((match = priceRegex.exec(response.data)) !== null) {
        prices.push(parseInt(match[1].replace(/[.,]/, '')));
      }
      
      if (prices.length === 0) {
        return res.json({ success: false, prixMoyen: null, prixBas: null, prixHaut: null, count: 0 });
      }
      
      const prixMoyen = Math.round(prices.reduce((a,b) => a+b) / prices.length);
      
      res.json({
        success: true,
        prixMoyen: prixMoyen,
        prixBas: Math.min(...prices),
        prixHaut: Math.max(...prices),
        count: prices.length,
        items: [],
        source: 'ricardo'
      });
    } catch (apiError) {
      console.warn('Ricardo scraping failed, using fallback:', apiError.message);
      res.json({
        success: false,
        prixMoyen: null,
        prixBas: null,
        prixHaut: null,
        count: 0,
        source: 'ricardo'
      });
    }
  } catch (error) {
    console.error('Ricardo endpoint error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

updated = updated.replace(ricardoOld, ricardoNew);

fs.writeFileSync('./server.js', updated);
console.log('✅ LeBonCoin and Ricardo endpoints updated with web scraping!');
