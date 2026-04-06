const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.post('/api/recognize-object', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.json({ success: false, error: 'No image' });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    console.log('🔍 Appel Claude Vision...');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64Data },
          },
          {
            type: 'text',
            text: `Tu es un expert mondial en estimation et valorisation d'objets. Tu as une connaissance approfondie de:
- MODE & SNEAKERS: prix StockX, GOAT, Vinted, eBay en temps réel
- ÉLECTRONIQUE: prix Back Market, Amazon, Fnac, Apple Store
- ANTIQUITÉS & BROCANTE: prix Catawiki, Drouot, maisons de ventes aux enchères
- IMMOBILIER: prix au m² par ville et quartier
- VÉHICULES: prix Argus, AutoScout24, cotes officielles
- ART & ŒUVRES: prix galeries, enchères, artistes connus
- MONTRES DE LUXE: prix Chrono24, WatchBox, marché secondaire

Analyse cette image et réponds UNIQUEMENT en JSON valide, sans texte avant ou après.
Sois EXTRÊMEMENT PRÉCIS sur les prix. Règles strictes:
1. Si tu identifies l'objet avec certitude: donne le VRAI prix du marché actuel (pas une estimation vague)
2. Pour sneakers: vérifie StockX/GOAT selon coloris et taille standard EU42
3. Pour électronique: prix Back Market grade A ou Amazon marketplace
4. Pour montres: prix Chrono24 ou WatchBox marché secondaire réel
5. Pour antiquités: prix Catawiki ou Drouot dernières ventes
6. Pour véhicules: cote Argus ou AutoScout24 selon année/km moyens
7. JAMAIS de prix ronds inventés — préfère une fourchette précise
8. Si objet inconnu ou image floue: confiance < 50 et prix conservateurs
Exemple bon prix: Nike Air Force 1 blanc EU42 = occasion 65-85 CHF selon état
Exemple mauvais prix: 100 CHF (trop rond, inventé)
Réponds UNIQUEMENT en JSON valide en CHF:
{
  "nom": "nom exact et complet (marque + modèle + année/référence si visible)",
  "marque": "marque exacte ou null",
  "modele": "modèle précis avec référence si connue",
  "categorie": "mode|antiquite|electronique|brocante|vehicule|art|maison|montre|immo|autre",
  "etat": "excellent|bon|moyen|mauvais",
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

    const content = response.content[0].text;
    console.log('✅ Claude response:', content);

    const result = JSON.parse(content.replace(/```json|```/g, '').trim());

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
async function getEbayToken() {
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
  return response.data.access_token;
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

app.listen(3000, () => console.log('✅ OBJEX Backend — Claude Vision actif!'));

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, objectContext } = req.body;
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `Tu es l'IA experte d'OBJEX. Objet: ${objectContext.nom} (${objectContext.marque}). Catégorie: ${objectContext.categorie}. État: ${objectContext.etat}. Prix neuf: ${objectContext.prixNeuf} CHF, occasion: ${objectContext.prixOccasion} CHF. Réponds en français, 2-3 phrases, expert, max 2 emojis.`
          },
          ...messages
        ],
        max_tokens: 200,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );
    const reply = response.data.choices?.[0]?.message?.content || 'Erreur IA.';
    res.json({ success: true, reply });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.json({ success: false, reply: 'Erreur serveur.' });
  }
});
