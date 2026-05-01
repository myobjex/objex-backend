const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

});
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.2.0', timestamp: new Date().toISOString() });
});

app.post('/api/recognize-object', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.json({ success: false, error: 'No image' });

    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    console.log('🔍 Appel Groq Vision...');

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `Tu es un expert en identification d'objets physiques. Tu analyses des images et retournes UNIQUEMENT un JSON valide, sans aucun texte avant ou après. Pas de markdown, pas d'explication. SEULEMENT le JSON brut. Tu identifies avec précision maximale: marque exacte, modèle exact, année, référence. Pour l'électronique Apple: distingue MacBook Air vs Pro, identifie la génération (M1/M2/M3/Intel), la taille d'écran. Pour les sneakers: marque + modèle + coloris exact. Confiance = 0-100 selon certitude d'identification.`
        },
        {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Data}` },
          },
          {
            type: 'text',
            text: `Tu es un expert mondial en IDENTIFICATION d'objets. Ton seul rôle est d'IDENTIFIER avec précision maximale. Les prix réels viennent d'APIs externes — tu estimes les prix uniquement comme référence indicative.

Tu identifies TOUT:
- MODE & SNEAKERS: marque, modèle exact, coloris, année, référence
- ELECTRONIQUE: marque, modèle, génération, capacité, couleur
- MONTRES: marque, référence exacte, mouvement, matériaux
- VEHICULES: marque, modèle, année, finition
- ANTIQUITÉS: époque, style, matériaux, origine probable
- ART: artiste si connu, technique, période
- NATURE: espèce exacte (nom latin), variété, comestibilité si champignon
- SPORT: marque, modèle, sport concerné
- GASTRONOMIE: produit, appellation, millésime si visible

RÈGLES IDENTIFICATION:
1. Utilise le web search pour confirmer le modèle exact si nécessaire
2. Sois TRÈS précis: pas "sneaker Nike" mais "Nike Air Force 1 Low '07 White EU42"
3. Si image floue/objet non identifiable: confiance < 40
4. Pour espèces protégées: indique ESPÈCE PROTÉGÉE dans description
5. Pour les VEHICULES: utilise les vraies cotes argus suisses/françaises. Ex: Audi A4 2016 diesel occasion = 18000-25000 CHF selon km. Sois très précis sur l'année et la finition.
6. Pour l'ELECTRONIQUE: prix basés sur les vrais marchés eBay/Back Market actuels
7. Estime les prix en CHF comme référence du marché actuel 2025-2026

Réponds UNIQUEMENT en JSON valide:
{
  "nom": "nom exact et complet (marque + modèle + année/référence si visible)",
  "marque": "marque exacte ou null",
  "modele": "modèle précis avec référence si connue",
  "categorie": "mode|antiquite|electronique|brocante|vehicule|art|maison|montre|immo|plante|champignon|animal|mineral|gastronomie|sport|autre",
  "etat": "excellent|bon|moyen|mauvais|sauvage|cultivé|domestique",
  "epoque": "période, décennie ou année exacte si connue",
  "description": "description experte en français (max 25 mots)",
  "prix_neuf": prix CHF neuf ou valeur de référence (nombre entier),
  "prix_occasion": prix CHF marché occasion actuel (nombre entier),
  "prix_bas": estimation basse du marché (nombre entier),
  "prix_haut": estimation haute du marché (nombre entier),
  "confiance": niveau de confiance 0-100,
  "plateformes": ["meilleures plateformes spécifiques à cet objet pour vendre"],
  "prix_plateformes": {
    "Vinted": prix estimé occasion sur Vinted en CHF (nombre entier ou null),
    "eBay": prix estimé occasion sur eBay en CHF (nombre entier ou null),
    "Amazon": prix estimé neuf/occasion sur Amazon en CHF (nombre entier ou null),
    "Back Market": prix estimé reconditionné sur Back Market en CHF (nombre entier ou null),
    "StockX": prix estimé sur StockX en CHF (nombre entier ou null si pas applicable),
    "GOAT": prix estimé sur GOAT en CHF (nombre entier ou null si pas applicable),
    "LeBonCoin": prix estimé sur LeBonCoin en CHF (nombre entier ou null),
    "Vestiaire Collectif": prix estimé sur Vestiaire Collectif en CHF (nombre entier ou null si pas applicable),
    "Catawiki": prix estimé sur Catawiki en CHF (nombre entier ou null si pas applicable),
    "Chrono24": prix estimé sur Chrono24 en CHF (nombre entier ou null si pas applicable)
  }
}`
          }
        ]
      }]
    });

    // Avec web search, Claude retourne plusieurs blocs - on prend le dernier text
    const rawText = response.choices[0].message.content;
    console.log('✅ Groq response:', rawText.substring(0, 300));

    // Extraction robuste du JSON
    let jsonStr = rawText;
    // Cherche un bloc ```json ... ```
    const codeMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    if (codeMatch) {
      jsonStr = codeMatch[1].trim();
    } else {
      // Cherche le premier { jusqu'au dernier }
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        jsonStr = rawText.substring(start, end + 1);
      }
    }
    const result = JSON.parse(jsonStr);

    res.json({
      success: true,
      object: {
        nom: result.nom,
        marque: result.marque,
        modele: result.modele,
        categorie: result.categorie,
        etat: result.etat,
        epoque: result.epoque,
        description: result.description,
        prixNeuf: result.prix_neuf,
        prixOccasion: result.prix_occasion,
        confiance: result.confiance,
        plateformes: result.plateformes || [],
        prixBas: result.prix_bas,
        prixHaut: result.prix_haut,
        prixPlateformes: result.prix_plateformes || {},
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/search-prices', async (req, res) => {
  const { productName, categorie, prixNeuf, prixOccasion } = req.body;

  const encode = (s) => encodeURIComponent(s);

  const allPlatforms = {
    mode: [
      { site: 'Vinted', url: `https://www.vinted.fr/catalog?search_text=${encode(productName)}` },
      { site: 'Vestiaire Collectif', url: `https://www.vestiairecollective.com/search/?q=${encode(productName)}` },
      { site: 'Depop', url: `https://www.depop.com/search/?q=${encode(productName)}` },
      { site: 'eBay', url: `https://www.ebay.fr/sch/i.html?_nkw=${encode(productName)}` },
    ],
    electronique: [
      { site: 'Back Market', url: `https://www.backmarket.fr/fr-fr/search?q=${encode(productName)}` },
      { site: 'eBay', url: `https://www.ebay.fr/sch/i.html?_nkw=${encode(productName)}` },
      { site: 'Amazon', url: `https://www.amazon.fr/s?k=${encode(productName)}` },
      { site: 'Fnac', url: `https://www.fnac.com/SearchResult/ResultSet.aspx?SCat=0&Search=${encode(productName)}` },
    ],
    antiquite: [
      { site: 'Catawiki', url: `https://www.catawiki.com/fr/l?q=${encode(productName)}` },
      { site: 'LeBonCoin', url: `https://www.leboncoin.fr/recherche?text=${encode(productName)}` },
      { site: 'Etsy', url: `https://www.etsy.com/fr/search?q=${encode(productName)}` },
      { site: 'eBay', url: `https://www.ebay.fr/sch/i.html?_nkw=${encode(productName)}` },
    ],
    vehicule: [
      { site: 'AutoScout24', url: `https://www.autoscout24.fr/lst?q=${encode(productName)}` },
      { site: 'LaCentrale', url: `https://www.lacentrale.fr/listing?q=${encode(productName)}` },
      { site: 'LeBonCoin', url: `https://www.leboncoin.fr/recherche?text=${encode(productName)}&category=2` },
      { site: 'Argus', url: `https://www.largus.fr/voiture-occasion/` },
    ],
    art: [
      { site: '1stDibs', url: `https://www.1stdibs.com/search/?q=${encode(productName)}` },
      { site: 'Catawiki', url: `https://www.catawiki.com/fr/l?q=${encode(productName)}` },
      { site: 'eBay Art', url: `https://www.ebay.fr/sch/i.html?_nkw=${encode(productName)}&_sacat=550` },
      { site: 'LeBonCoin', url: `https://www.leboncoin.fr/recherche?text=${encode(productName)}` },
    ],
    default: [
      { site: 'LeBonCoin', url: `https://www.leboncoin.fr/recherche?text=${encode(productName)}` },
      { site: 'eBay', url: `https://www.ebay.fr/sch/i.html?_nkw=${encode(productName)}` },
      { site: 'Amazon', url: `https://www.amazon.fr/s?k=${encode(productName)}` },
      { site: 'Vinted', url: `https://www.vinted.fr/catalog?search_text=${encode(productName)}` },
    ],
  };

  const platforms = allPlatforms[categorie] || allPlatforms.default;

  const baseOccasion = prixOccasion || Math.floor((prixNeuf || 100) * 0.6);
  const results = platforms.map((p, i) => ({
    site: p.site,
    price: Math.floor(baseOccasion * (0.85 + i * 0.1)),
    url: p.url,
  }));

  res.json({ success: true, results, productName });
});


// eBay Browse API - Vrais prix live
let _ebayToken = null;
let _ebayTokenExpiry = 0;

async function getEbayToken() {
  if (_ebayToken && Date.now() < _ebayTokenExpiry) return _ebayToken;
  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`
  ).toString('base64');
  
  const response = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    }
  );
  _ebayToken = response.data.access_token;
  _ebayTokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return _ebayToken;
}

app.post('/api/ebay-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const token = await getEbayToken();
    
    const response = await axios.get(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=10&filter=buyingOptions:{FIXED_PRICE}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_FR',
          'Content-Type': 'application/json',
        }
      }
    );

    const items = response.data.itemSummaries || [];
    
    if (items.length === 0) {
      return res.json({ success: true, prix: null, count: 0, items: [] });
    }

    const prices = items
      .map(i => parseFloat(i.price?.value || 0))
      .filter(p => p > 0);
    
    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    const topItems = items.slice(0, 5).map(i => ({
      titre: i.title,
      prix: parseFloat(i.price?.value || 0),
      devise: i.price?.currency || 'EUR',
      url: i.itemWebUrl,
      image: i.image?.imageUrl || null,
      etat: i.condition || 'Non précisé',
    }));

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: items.length,
      items: topItems,
    });

  } catch (error) {
    console.error('eBay API error:', error.response?.data || error.message);
    res.json({ success: false, error: error.message });
  }
});


app.post('/api/amazon-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const response = await axios.get(
      'https://real-time-amazon-data.p.rapidapi.com/search',
      {
        params: {
          query: query,
          page: '1',
          country: 'FR',
          sort_by: 'RELEVANCE',
          product_condition: 'ALL',
        },
        headers: {
          'x-rapidapi-host': 'real-time-amazon-data.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        }
      }
    );

    const products = response.data?.data?.products || [];
    if (products.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prices = products
      .map(p => parseFloat(p.product_price?.replace(/[^0-9.]/g, '') || 0))
      .filter(p => p > 0);

    if (prices.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    const topItems = products.slice(0, 5).map(p => ({
      titre: p.product_title,
      prix: parseFloat(p.product_price?.replace(/[^0-9.]/g, '') || 0),
      url: p.product_url,
      image: p.product_photo,
      note: p.product_star_rating,
    }));

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: products.length,
      items: topItems,
    });

  } catch (error) {
    console.error('Amazon API error:', error.message);
    res.json({ success: false, error: error.message });
  }
});


app.post('/api/autoscout-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const response = await axios.get(
      'https://autoscout24-api.p.rapidapi.com/automotive/search',
      {
        params: {
          query: query,
          country: 'fr',
          limit: '10',
        },
        headers: {
          'x-rapidapi-host': 'autoscout24-api.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        }
      }
    );

    const listings = response.data?.listings || response.data?.results || [];
    if (listings.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prices = listings
      .map(p => parseFloat(p.price || p.prix || 0))
      .filter(p => p > 0);

    if (prices.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    const topItems = listings.slice(0, 5).map(p => ({
      titre: p.title || p.name || query,
      prix: parseFloat(p.price || 0),
      url: p.url || p.link || '',
      annee: p.year || null,
      km: p.mileage || null,
    }));

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: listings.length,
      items: topItems,
    });

  } catch (error) {
    console.error('AutoScout API error:', error.message);
    res.json({ success: false, error: error.message });
  }
});


app.post('/api/vinted-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const response = await axios.get(
      'https://vinted-api3.p.rapidapi.com/search/v2',
      {
        params: {
          query: query,
          country: 'fr',
          limit: '10',
        },
        headers: {
          'x-rapidapi-host': 'vinted-api3.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
          'Content-Type': 'application/json',
        }
      }
    );

    const items = response.data?.items || response.data?.results || [];
    if (items.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prices = items
      .map(p => parseFloat(p.price || p.total_item_price?.amount || 0))
      .filter(p => p > 0);

    if (prices.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    const topItems = items.slice(0, 5).map(p => ({
      titre: p.title || query,
      prix: parseFloat(p.price || 0),
      url: p.url || '',
      image: p.photo?.url || null,
      etat: p.status || null,
    }));

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: items.length,
      items: topItems,
    });

  } catch (error) {
    console.error('Vinted API error:', error.message);
    res.json({ success: false, error: error.message });
  }
});


app.post('/api/etsy-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const response = await axios.get(
      'https://etsy-api2.p.rapidapi.com/product/search',
      {
        params: {
          query: query,
          page: '1',
          currency: 'EUR',
          language: 'fr',
          country: 'FR',
          orderBy: 'mostRelevant',
        },
        headers: {
          'x-rapidapi-host': 'etsy-api2.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
          'Content-Type': 'application/json',
        }
      }
    );

    const items = response.data?.results || response.data?.data || [];
    if (items.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prices = items
      .map(p => parseFloat(p.price || p.listing_price?.amount || 0))
      .filter(p => p > 0);

    if (prices.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: items.length,
    });

  } catch (error) {
    console.error('Etsy API error:', error.message);
    res.json({ success: false, error: error.message });
  }
});


app.post('/api/chrono24-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const response = await axios.get(
      'https://chrono24.p.rapidapi.com/scraper/chrono24/search',
      {
        params: { query: query },
        headers: {
          'x-rapidapi-host': 'chrono24.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
          'Content-Type': 'application/json',
        }
      }
    );

    const items = response.data?.results || response.data?.data || [];
    if (items.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prices = items
      .map(p => parseFloat(p.price?.replace(/[^0-9.]/g, '') || p.priceValue || 0))
      .filter(p => p > 0);

    if (prices.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: items.length,
    });

  } catch (error) {
    console.error('Chrono24 API error:', error.message);
    res.json({ success: false, error: error.message });
  }
});


app.post('/api/catawiki-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const response = await axios.get(
      'https://catawiki-scraping.p.rapidapi.com/lots/search',
      {
        params: {
          language: 'fr',
          page: '1',
          query: query,
        },
        headers: {
          'x-rapidapi-host': 'catawiki-scraping.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
          'Content-Type': 'application/json',
        }
      }
    );

    const items = response.data?.lots || response.data?.results || [];
    if (items.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prices = items
      .map(p => parseFloat(p.current_bid || p.estimate_low || p.price || 0))
      .filter(p => p > 0);

    if (prices.length === 0) return res.json({ success: true, prix: null, count: 0 });

    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    res.json({
      success: true,
      prixMoyen,
      prixBas,
      prixHaut,
      count: items.length,
    });

  } catch (error) {
    console.error('Catawiki API error:', error.message);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, objectContext, userPlan } = req.body;

    const systemPrompt = `Tu es l'IA experte de MYOBJEX, spécialisée UNIQUEMENT dans l'évaluation d'objets et le marché de revente.
Objet analysé: ${objectContext.nom} (${objectContext.marque}). Catégorie: ${objectContext.categorie}. État: ${objectContext.etat}. Prix neuf: ${objectContext.prixNeuf} CHF, occasion: ${objectContext.prixOccasion} CHF.
Tu réponds UNIQUEMENT aux questions sur la valeur, le prix, l'authenticité, où vendre/acheter, les tendances marché.
Si hors sujet, réponds: "Je suis spécialisé uniquement dans l'évaluation d'objets. Scannez un objet pour que je vous aide ! 📷"
Réponds en français, 2-3 phrases max, expert et concis, max 2 emojis.`;

    let reply, modelUsed;

    if (userPlan === 'pro') {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role === 'bot' ? 'assistant' : m.role, content: m.content || m.text })),
      });
      reply = response.content[0]?.text || 'Erreur IA.';
      modelUsed = 'claude-haiku';
    } else if (userPlan === 'standard') {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: 300 },
        { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
      );
      reply = response.data.choices?.[0]?.message?.content || 'Erreur IA.';
      modelUsed = 'groq-70b';
    } else {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.1-8b-instant', messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: 200 },
        { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
      );
      reply = response.data.choices?.[0]?.message?.content || 'Erreur IA.';
      modelUsed = 'groq-8b';
    }

    res.json({ success: true, reply, model: modelUsed });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.json({ success: false, reply: 'Erreur serveur.' });
  }
});

// ========== LEBONCOIN ==========
app.post('/api/leboncoin-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching LeBonCoin prices for:', query);
    
    try {
      const axios = require('axios');
      const url = `https://www.leboncoin.fr/recherche?text=${encodeURIComponent(query)}`;
      
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
});

// ========== RICARDO ==========
app.post('/api/ricardo-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });

    console.log('🔍 Fetching Ricardo prices for:', query);
    
    try {
      const axios = require('axios');
      const url = `https://www.ricardo.ch/de/s/${encodeURIComponent(query)}`;
      
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
});

// ========== STOCKX ==========
app.post('/api/stockx-prices', async (req, res) => {
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
});

// ========== GOAT ==========
app.post('/api/goat-prices', async (req, res) => {
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
});

// ============================================
// PRICECHARTING - Jeux vidéo, cartes, retro
// ============================================
app.post('/api/pricecharting-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const apiKey = process.env.PRICECHARTING_API_KEY;
    if (!apiKey) {
      // Fallback: scraping public endpoint
      const response = await axios.get(
        `https://www.pricecharting.com/api/product?id=${encodeURIComponent(query)}&status=used`,
        { headers: { 'User-Agent': 'MYOBJEX/1.0' }, timeout: 8000 }
      );
      const data = response.data;
      if (!data || data.status === 'error') return res.json({ success: false, prixMoyen: null, count: 0 });

      const loose = Math.round((data['loose-price'] || 0) / 100);
      const complete = Math.round((data['complete-price'] || 0) / 100);
      const graded = Math.round((data['graded-price'] || 0) / 100);

      return res.json({
        success: true,
        prixMoyen: loose || complete || null,
        prixBas: loose ? Math.round(loose * 0.8) : null,
        prixHaut: graded || complete || null,
        loose, complete, graded,
        count: loose ? 1 : 0,
        source: 'pricecharting'
      });
    }

    const response = await axios.get(
      `https://www.pricecharting.com/api/products?q=${encodeURIComponent(query)}&api-key=${apiKey}`,
      { timeout: 8000 }
    );
    const products = response.data?.products || [];
    if (!products.length) return res.json({ success: false, prixMoyen: null, count: 0, source: 'pricecharting' });

    const top = products[0];
    const loose = Math.round((top['loose-price'] || 0) / 100);
    const complete = Math.round((top['complete-price'] || 0) / 100);
    const graded = Math.round((top['graded-price'] || 0) / 100);

    res.json({
      success: true,
      prixMoyen: loose || complete || null,
      prixBas: loose ? Math.round(loose * 0.8) : null,
      prixHaut: graded || complete || (loose ? Math.round(loose * 1.3) : null),
      loose, complete, graded,
      productName: top['product-name'],
      count: products.length,
      source: 'pricecharting'
    });
  } catch (error) {
    console.error('PriceCharting error:', error.message);
    res.json({ success: false, prixMoyen: null, count: 0, source: 'pricecharting' });
  }
});

// ============================================
// WORTHPOINT - Antiquités & objets de collection
// ============================================
app.post('/api/worthpoint-prices', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const apiKey = process.env.WORTHPOINT_API_KEY;
    if (!apiKey) {
      // Sans clé: utilise eBay sold listings comme proxy antiquités
      const token = await getEbayToken();
      const response = await axios.get(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query + ' antique vintage')}&limit=10&filter=buyingOptions:{FIXED_PRICE}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_FR',
          }
        }
      );
      const items = response.data.itemSummaries || [];
      if (!items.length) return res.json({ success: false, prixMoyen: null, count: 0, source: 'worthpoint-fallback' });

      const prices = items.map(i => parseFloat(i.price?.value || 0)).filter(p => p > 0);
      const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

      return res.json({
        success: true,
        prixMoyen,
        prixBas: Math.round(Math.min(...prices)),
        prixHaut: Math.round(Math.max(...prices)),
        count: prices.length,
        source: 'worthpoint-fallback'
      });
    }

    const response = await axios.get(
      `https://api.worthpoint.com/v1/search?query=${encodeURIComponent(query)}&api_key=${apiKey}&limit=10`,
      { timeout: 8000 }
    );
    const items = response.data?.results || [];
    if (!items.length) return res.json({ success: false, prixMoyen: null, count: 0, source: 'worthpoint' });

    const prices = items.map(i => parseFloat(i.price || 0)).filter(p => p > 0);
    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

    res.json({
      success: true,
      prixMoyen,
      prixBas: Math.round(Math.min(...prices)),
      prixHaut: Math.round(Math.max(...prices)),
      count: prices.length,
      source: 'worthpoint'
    });
  } catch (error) {
    console.error('WorthPoint error:', error.message);
    res.json({ success: false, prixMoyen: null, count: 0, source: 'worthpoint' });
  }
});

// Keep-alive ping toutes les 14 minutes (Render free tier)
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://objex-backend.onrender.com';
setInterval(async () => {
  try {
    const http = require('https');
    http.get(SELF_URL + '/health', (res) => {
      console.log('🏓 Keep-alive ping OK:', res.statusCode);
    }).on('error', () => {});
  } catch(e) {}
}, 14 * 60 * 1000);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(3000, () => console.log('✅ OBJEX Backend — Claude Vision actif!'));
