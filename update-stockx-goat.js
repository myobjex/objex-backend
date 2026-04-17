const fs = require('fs');
const content = fs.readFileSync('./server.js', 'utf-8');

// Replace StockX endpoint
const stockxOld = `app.post('/api/stockx-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching StockX prices for:', query);
    
    // Fallback if API fails
    res.json({
      success: true,
      prixMoyen: 950,
      prixBas: 800,
      prixHaut: 1300,
      count: 42,
      items: [],
      source: 'stockx'
    });
  } catch (error) {
    console.error('StockX API error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

const stockxNew = `app.post('/api/stockx-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching StockX prices for:', query);
    
    try {
      const axios = require('axios');
      const response = await axios.get('https://sneaker-database-stockx.p.rapidapi.com/search', {
        params: { query: query },
        headers: {
          'x-rapidapi-host': 'sneaker-database-stockx.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY
        },
        timeout: 5000
      });
      
      const items = response.data?.results || [];
      const prices = items.map(item => item.price).filter(p => p && !isNaN(p));
      
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
        items: items.slice(0, 5),
        source: 'stockx'
      });
    } catch (apiError) {
      console.warn('StockX API failed, using fallback:', apiError.message);
      res.json({
        success: false,
        prixMoyen: null,
        prixBas: null,
        prixHaut: null,
        count: 0,
        source: 'stockx'
      });
    }
  } catch (error) {
    console.error('StockX endpoint error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

let updated = content.replace(stockxOld, stockxNew);

// Replace GOAT endpoint
const goatOld = `app.post('/api/goat-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching GOAT prices for:', query);
    
    // Fallback if API fails
    res.json({
      success: true,
      prixMoyen: 920,
      prixBas: 750,
      prixHaut: 1250,
      count: 38,
      items: [],
      source: 'goat'
    });
  } catch (error) {
    console.error('GOAT API error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

const goatNew = `app.post('/api/goat-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching GOAT prices for:', query);
    
    try {
      const axios = require('axios');
      const response = await axios.get('https://sneaker-database-stockx.p.rapidapi.com/search', {
        params: { query: query, source: 'goat' },
        headers: {
          'x-rapidapi-host': 'sneaker-database-stockx.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY
        },
        timeout: 5000
      });
      
      const items = response.data?.results || [];
      const prices = items.map(item => item.price).filter(p => p && !isNaN(p));
      
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
        items: items.slice(0, 5),
        source: 'goat'
      });
    } catch (apiError) {
      console.warn('GOAT API failed, using fallback:', apiError.message);
      res.json({
        success: false,
        prixMoyen: null,
        prixBas: null,
        prixHaut: null,
        count: 0,
        source: 'goat'
      });
    }
  } catch (error) {
    console.error('GOAT endpoint error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

updated = updated.replace(goatOld, goatNew);

fs.writeFileSync('./server.js', updated);
console.log('✅ StockX and GOAT endpoints updated with RapidAPI!');
