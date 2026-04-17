const fs = require('fs');
const content = fs.readFileSync('./server.js', 'utf-8');

// Find and replace catawiki endpoint
const catawikiOld = `app.post('/api/catawiki-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    console.log('🔍 Fetching Catawiki prices for:', query);

    const response = await axios.get(
      \`https://api.catawiki.com/v1/search?q=\${encodeURIComponent(query)}\`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      }
    );

    const items = response.data.results || [];
    if (items.length === 0) {
      return res.json({ success: false, error: 'No items found' });
    }

    const prices = items
      .map(item => parseFloat(item.estimate_price_max || item.hammer_price || item.current_bid || 0))
      .filter(p => p > 0);

    const prixMoyen = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const prixBas = prices.length > 0 ? Math.round(Math.min(...prices)) : 0;
    const prixHaut = prices.length > 0 ? Math.round(Math.max(...prices)) : 0;

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: items.length,
      items: items.slice(0, 5),
    });

  } catch (error) {
    console.error('Catawiki API error:', error.response?.data || error.message);
    res.json({ success: false, error: error.message });
  }
});`;

const catawikiNew = `app.post('/api/catawiki-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching Catawiki prices for:', query);

    try {
      const response = await axios.get(
        'https://catawiki-scraping.p.rapidapi.com/search',
        {
          params: {
            query: query,
            language: 'en'
          },
          headers: {
            'x-rapidapi-host': 'catawiki-scraping.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_KEY
          },
          timeout: 5000
        }
      );

      const items = response.data?.results || response.data?.items || [];
      if (items.length === 0) {
        return res.json({ success: false, prixMoyen: null, prixBas: null, prixHaut: null, count: 0 });
      }

      const prices = items
        .map(item => {
          const price = item.price || item.current_bid || item.estimate_price_max || 0;
          return parseFloat(price);
        })
        .filter(p => p > 0);

      if (prices.length === 0) {
        return res.json({ success: false, prixMoyen: null, prixBas: null, prixHaut: null, count: 0 });
      }

      const prixMoyen = Math.round(prices.reduce((a, b) => a + b) / prices.length);

      res.json({
        success: true,
        prixMoyen: prixMoyen,
        prixBas: Math.min(...prices),
        prixHaut: Math.max(...prices),
        count: prices.length,
        items: items.slice(0, 5),
        source: 'catawiki'
      });
    } catch (apiError) {
      console.warn('Catawiki API failed, using fallback:', apiError.message);
      res.json({
        success: false,
        prixMoyen: null,
        prixBas: null,
        prixHaut: null,
        count: 0,
        source: 'catawiki'
      });
    }

  } catch (error) {
    console.error('Catawiki endpoint error:', error.message);
    res.json({ success: false, error: error.message, prixMoyen: null, count: 0 });
  }
});`;

const updated = content.replace(catawikiOld, catawikiNew);
fs.writeFileSync('./server.js', updated);
console.log('✅ Catawiki updated with RapidAPI!');
