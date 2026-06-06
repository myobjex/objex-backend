const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Groq = require('groq-sdk');
require('dotenv').config();
const pRetry = require("p-retry");
const cheerio = require("cheerio");
const NodeCache = require("node-cache");

const EBAY_MARKETPLACE = {
  CH: 'EBAY_CH',
  FR: 'EBAY_FR',
  DE: 'EBAY_DE',
  GB: 'EBAY_GB',
  US: 'EBAY_US',
  IT: 'EBAY_IT',
  ES: 'EBAY_ES',
  BE: 'EBAY_BE',
  NL: 'EBAY_NL',
  AT: 'EBAY_AT',
  AU: 'EBAY_AU',
  CA: 'EBAY_CA',
};

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});
// ===== CACHE & RETRY HELPERS =====
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const retryOptions = {
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 5000,
  onFailedAttempt: (err) => {
    console.log(`⚠️ Retry ${err.attemptNumber}/3: ${err.message}`);
  }
};

async function fetchWithRetry(url, config = {}) {
  return pRetry(
    () => axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' }, ...config }),
    retryOptions
  );
}

function parsePrice(text) {
  const match = text.match(/[\$£€د]\s*([\d,\.]+)|([0-9,\.]+)\s*(?:CHF|EUR|USD|GBP|MAD|DH|AED|SEK|NOK|DKK|CAD|AUD|SGD|JPY|ZAR|NGN|DZD|TND|BRL|MXN|PLN|TRY|ILS|KWD|SAR|QAR|INR|MYR|THB|IDR|PHP|KES|XOF|XAF|CLP|COP|PEN|ARS)/i);
  if (!match) return null;
  return Math.round(parseFloat((match[1] || match[2] || '0').replace(/,/g, '.')));
}



// Middleware authentification
const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.ARIZ_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Rate limiting
const requestCounts = {};
const rateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!requestCounts[ip]) requestCounts[ip] = [];
  requestCounts[ip] = requestCounts[ip].filter(t => now - t < 60000);
  if (requestCounts[ip].length >= 30) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  requestCounts[ip].push(now);
  next();
};
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.2.0', timestamp: new Date().toISOString() });
});

app.post('/api/recognize-object', authenticateRequest, rateLimit, async (req, res) => {
  try {
    const { imageBase64, countryCode = 'CH' } = req.body;

    const COUNTRIES = {
      CH: { currency: 'CHF', platforms: 'Ricardo.ch, Tutti.ch, Anibis.ch', context: 'Tu es en Suisse. Prix en CHF. Marché premium (+15% vs France).' },
      FR: { currency: 'EUR', platforms: 'LeBonCoin, Vinted, eBay.fr', context: 'Tu es en France. Prix en euros.' },
      DE: { currency: 'EUR', platforms: 'Kleinanzeigen, eBay.de, Rebuy', context: 'Du bist in Deutschland. Preise in Euro.' },
      BE: { currency: 'EUR', platforms: '2ememain.be, Vinted BE', context: 'Tu es en Belgique. Prix en euros.' },
      GB: { currency: 'GBP', platforms: 'Gumtree, eBay UK, Depop', context: 'You are in the UK. Prices in GBP.' },
      US: { currency: 'USD', platforms: 'eBay, StockX, GOAT, Poshmark', context: 'You are in the US. Prices in USD.' },
      MA: { currency: 'MAD', platforms: 'Avito.ma, Jumia.ma, Moteur.ma, Wandaloo.ma, Facebook Marketplace Maroc', context: 'Tu es au Maroc. IMPORTANT: Tous les prix DOIVENT etre en MAD (dirhams marocains). Taux: 1 EUR = 10.8 MAD, 1 USD = 9.9 MAD, 1 CHF = 11.2 MAD. Exemple: iPhone 13 = 8500 MAD, MacBook Pro = 18000 MAD, Nike Air Force = 900 MAD. Ne jamais donner de prix en EUR ou CHF.' },
      ES: { currency: 'EUR', platforms: 'Wallapop, Milanuncios, eBay.es', context: 'Estás en España. Precios en euros.' },
      IT: { currency: 'EUR', platforms: 'Subito.it, eBay.it', context: 'Sei in Italia. Prezzi in euro.' },
      NL: { currency: 'EUR', platforms: 'Marktplaats, Vinted NL', context: 'Je bent in Nederland. Prijzen in euro.' },
      PT: { currency: 'EUR', platforms: 'OLX.pt, CustoJusto', context: 'Estás em Portugal. Preços em euros.' },
      SE: { currency: 'SEK', platforms: 'Blocket, Tradera', context: 'Du är i Sverige. Priser i SEK.' },
      AU: { currency: 'AUD', platforms: 'Gumtree AU, eBay AU', context: 'You are in Australia. Prices in AUD.' },
      CA: { currency: 'CAD', platforms: 'Kijiji, Facebook Marketplace', context: 'You are in Canada. Prices in CAD.' },
      JP: { currency: 'JPY', platforms: 'Mercari JP, Yahoo Auctions', context: 'You are in Japan. Prices in JPY.' },
      SG: { currency: 'SGD', platforms: 'Carousell, Lazada', context: 'You are in Singapore. Prices in SGD.' },
      ZA: { currency: 'ZAR', platforms: 'Gumtree ZA, OLX ZA', context: 'You are in South Africa. Prices in ZAR.' },
      NG: { currency: 'NGN', platforms: 'Jiji.ng, Jumia NG', context: 'You are in Nigeria. Prices in NGN.' },
      DZ: { currency: 'DZD', platforms: 'Ouedkniss, Facebook Marketplace', context: 'Tu es en Algérie. Prix en DZD.' },
      TN: { currency: 'TND', platforms: 'Tayara.tn, Afrikha', context: 'Tu es en Tunisie. Prix en TND.' },
      BR: { currency: 'BRL', platforms: 'Mercado Livre, OLX BR', context: 'Você está no Brasil. Preços em BRL.' },
      MX: { currency: 'MXN', platforms: 'Mercado Libre, Facebook Marketplace', context: 'Estás en México. Precios en MXN.' },
    };
    const country = COUNTRIES[countryCode] || COUNTRIES['CH'];
    const currency = country.currency;
    const localPlatforms = country.platforms;
    const localContext = country.context;
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
          content: `Tu es un expert en identification d'objets physiques. Tu analyses des images et retournes UNIQUEMENT un JSON valide, sans aucun texte avant ou après. Pas de markdown, pas d'explication. SEULEMENT le JSON brut. Tu identifies avec précision maximale: marque exacte, modèle exact, année, référence. Pour l'électronique Apple: distingue MacBook Air vs Pro, identifie la génération (M1/M2/M3/Intel), la taille d'écran (13, 14, 15, 16 pouces - regarde la proportion du clavier et de l'écran dans l'image pour estimer la taille). IMPORTANT: un MacBook Pro 16 pouces est notablement plus grand qu'un 13 pouces, le ratio écran/clavier est différent. En cas de doute sur la taille exact mets le dans la description mais ne te trompe pas de gamme (Air vs Pro). Pour les sneakers: marque + modèle + coloris exact. Confiance = 0-100 selon certitude d'identification.`
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
            text: `${localContext}

Tu es un expert mondial en IDENTIFICATION d'objets. Ton seul rôle est d'IDENTIFIER avec précision maximale. Les prix réels viennent d'APIs externes — tu estimes les prix uniquement comme référence indicative.

Tu identifies TOUT:
- MODE & SNEAKERS: marque, modèle exact, coloris, année, référence
- ELECTRONIQUE: marque, modèle, génération, capacité, couleur
- MONTRES: marque, référence exacte, mouvement, matériaux
- VEHICULES: marque, modèle, année, finition
- ANTIQUITÉS & BROCANTE: époque précise (ex: "Art Déco 1920-1930"), style (Louis XVI, Napoléon III, Bauhaus...), matériaux (porcelaine de Limoges, faïence, bronze, laiton...), origine probable (France, Allemagne, Asie...), poinçons si visibles, état conservation. Prix brocante française: vide-grenier 5-50€, antiquaire 50-500€, Catawiki 100-2000€+
- ART: artiste si signature visible, technique (huile sur toile, aquarelle, lithographie, sculpture bronze...), période, école artistique, dimensions approximatives si visibles, authenticité probable
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
8. Pour ANTIQUITÉS/BROCANTE: sois très précis sur l'époque et le style. Une commode Louis XVI authentique vaut 800-3000€, une reproduction 50-200€. Indique toujours si c'est original ou reproduction probable.
9. Pour ART: si signature visible, identifie l'artiste. Une lithographie signée numérotée vaut 200-2000€. Une peinture originale inconnue 50-500€. Une reproduction sans valeur.
10. Pour BROCANTE générale: vaisselle ancienne 5-50€, luminaires vintage 20-200€, mobilier 50-800€, bibelots 2-30€

Réponds UNIQUEMENT en JSON valide:
{
  "nom": "nom exact et complet (marque + modèle) — NE PAS écrire la string null, utiliser null JSON si inconnu",
  "marque": "marque exacte (string) ou null (JSON null si inconnue)",
  "modele": "modèle précis avec référence si connue (null si inconnu)",
  "categorie": "mode|antiquite|electronique|brocante|vehicule|art|maison|montre|immo|plante|champignon|animal|mineral|gastronomie|sport|luminaire|autre",
  "etat": "excellent|bon|moyen|mauvais|sauvage|cultivé|domestique",
  "epoque": "période, décennie ou année exacte si connue",
  "description": "description experte en français (max 25 mots)",
  "prix_neuf": prix CHF estimation valeur neuf ou référence (nombre entier ou null),
  "prix_occasion": prix CHF marché occasion actuel (nombre entier),
  IMPORTANT: TOUJOURS remplir prix_neuf ET prix_occasion, meme pour antiquites/art/brocante. Pour antiquites: prix_neuf = estimation neuf du meme objet aujourd'hui, prix_occasion = prix marche actuel (Catawiki, eBay, LeBonCoin).
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
    console.error('❌ Groq Error:', error.message);
    
    // Fallback Claude Haiku si Groq rate limité
    if (error.message.includes('429') || error.message.includes('rate') || error.message.includes('limit')) {
      try {
        console.log('🔄 Fallback vers Claude Haiku...');
        const { imageBase64 } = req.body;
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const mimeType = imageBase64.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
        
        const fallbackResponse = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.1-8b-instant',
            max_tokens: 512,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
                { type: 'text', text: 'Identifie cet objet. Réponds UNIQUEMENT en JSON: {"nom":null,"marque":null,"modele":null,"categorie":"autre","etat":null,"epoque":null,"description":"description courte","prix_neuf":null,"prix_occasion":null,"prix_bas":null,"prix_haut":null,"confiance":50,"plateformes":[],"prix_plateformes":{}}' }
              ]
            }]
          },
          { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        const rawText = fallbackResponse.data.choices[0].message.content;
        const start = rawText.indexOf('{');
        const end = rawText.lastIndexOf('}');
        const result = JSON.parse(rawText.substring(start, end + 1));
        
        return res.json({
          success: true,
          object: {
            nom: result.nom, marque: result.marque, modele: result.modele,
            categorie: result.categorie, etat: result.etat, epoque: result.epoque,
            description: result.description, prixNeuf: result.prix_neuf,
            prixOccasion: result.prix_occasion, confiance: result.confiance,
            plateformes: result.plateformes || [], prixBas: result.prix_bas,
            prixHaut: result.prix_haut, prixPlateformes: result.prix_plateformes || {},
          },
          fallback: 'groq-8b'
        });
      } catch (fallbackError) {
        console.error('❌ Fallback error:', fallbackError.message);
      }
    }
    
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/search-prices', authenticateRequest, async (req, res) => {
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
    brocante: [
      { site: 'LeBonCoin', url: `https://www.leboncoin.fr/recherche?text=${encode(productName)}` },
      { site: 'Catawiki', url: `https://www.catawiki.com/fr/l?q=${encode(productName)}` },
      { site: 'Ricardo', url: `https://www.ricardo.ch/fr/s/${encode(productName)}/` },
      { site: 'eBay', url: `https://www.ebay.fr/sch/i.html?_nkw=${encode(productName)}` },
    ],
    maison: [
      { site: 'LeBonCoin', url: `https://www.leboncoin.fr/recherche?text=${encode(productName)}` },
      { site: 'Vinted', url: `https://www.vinted.fr/catalog?search_text=${encode(productName)}` },
      { site: 'eBay', url: `https://www.ebay.fr/sch/i.html?_nkw=${encode(productName)}` },
      { site: 'Ricardo', url: `https://www.ricardo.ch/fr/s/${encode(productName)}/` },
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

app.post('/api/ebay-prices', authenticateRequest, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const token = await getEbayToken();

    // Tous les marchés Europe + Maghreb
    const marketplaces = [
      'EBAY_FR', 'EBAY_DE', 'EBAY_IT', 'EBAY_ES',
      'EBAY_GB', 'EBAY_CH', 'EBAY_BE', 'EBAY_NL',
      'EBAY_AT', 'EBAY_US'
    ];

    const results = await Promise.allSettled(
      marketplaces.map(marketplace =>
        axios.get(
          `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=10&filter=buyingOptions:{FIXED_PRICE},conditions:{USED}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-EBAY-C-MARKETPLACE-ID': marketplace,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          }
        ).then(r => ({ marketplace, items: r.data.itemSummaries || [] }))
      )
    );

    // Agréger tous les items
    const allItems = [];
    const byMarketplace = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { marketplace, items } = r.value;
        byMarketplace[marketplace] = items.length;
        allItems.push(...items);
      }
    }

    if (allItems.length === 0) {
      return res.json({ success: true, prix: null, count: 0, items: [], byMarketplace });
    }

    const prices = allItems
      .map(i => parseFloat(i.price?.value || 0))
      .filter(p => p > 0);

    const prixMoyen = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = Math.round(Math.min(...prices));
    const prixHaut = Math.round(Math.max(...prices));

    const topItems = allItems.slice(0, 10).map(i => ({
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
      count: allItems.length,
      items: topItems,
      byMarketplace,
    });

  } catch (error) {
    console.error('eBay API error:', error.response?.data || error.message);
    res.json({ success: false, error: error.message });
  }
});


app.post('/api/amazon-prices', authenticateRequest, async (req, res) => {
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
          product_condition: 'USED',
          sort_by: 'PRICE_LOW_TO_HIGH',
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

    // Correction: si prix > 10000, probablement en centimes
    const fixPrice = p => p > 10000 ? Math.round(p / 100) : Math.round(p);
    const prixMoyen = fixPrice(prices.reduce((a, b) => a + b, 0) / prices.length);
    const prixBas = fixPrice(Math.min(...prices));
    const prixHaut = fixPrice(Math.max(...prices));

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


app.post('/api/autoscout-prices', authenticateRequest, async (req, res) => {
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


app.post('/api/vinted-prices', authenticateRequest, async (req, res) => {
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


app.post('/api/etsy-prices', authenticateRequest, async (req, res) => {
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


app.post('/api/chrono24-prices', authenticateRequest, async (req, res) => {
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


app.post('/api/catawiki-prices', authenticateRequest, async (req, res) => {
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

app.post('/api/chat', authenticateRequest, rateLimit, async (req, res) => {
  try {
    const { messages, objectContext, userPlan } = req.body;

    const systemPrompt = `Tu es l'IA experte de MYOBJEX, spécialisée UNIQUEMENT dans l'évaluation d'objets et le marché de revente.
Objet analysé: ${objectContext.nom} (${objectContext.marque}). Catégorie: ${objectContext.categorie}. État: ${objectContext.etat}. Prix neuf: ${objectContext.prixNeuf} CHF, occasion: ${objectContext.prixOccasion} CHF.
Tu réponds UNIQUEMENT aux questions sur la valeur, le prix, l'authenticité, où vendre/acheter, les tendances marché.
Si hors sujet, réponds: "Je suis spécialisé uniquement dans l'évaluation d'objets. Scannez un objet pour que je vous aide ! 📷"
Réponds en français, 2-3 phrases max, expert et concis, max 2 emojis.`;

    let reply, modelUsed;

    if (userPlan === 'pro') {
      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        max_tokens: 400,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role === 'bot' ? 'assistant' : m.role, content: m.content || m.text })),
      });
      reply = response.content[0]?.text || 'Erreur IA.';
      modelUsed = 'groq-haiku';
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
app.post('/api/leboncoin-prices', authenticateRequest, async (req, res) => {
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
app.post('/api/ricardo-prices', authenticateRequest, async (req, res) => {
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
app.post('/api/stockx-prices', authenticateRequest, async (req, res) => {
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
app.post('/api/goat-prices', authenticateRequest, async (req, res) => {
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
app.post('/api/pricecharting-prices', authenticateRequest, async (req, res) => {
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
app.post('/api/worthpoint-prices', authenticateRequest, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, error: 'No query' });

    const apiKey = process.env.WORTHPOINT_API_KEY;
    if (!apiKey) {
      // Sans clé: utilise eBay sold listings comme proxy antiquités
      const token = await getEbayToken();
      const response = await axios.get(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query + ' antique vintage')}&limit=20&filter=buyingOptions:{FIXED_PRICE},conditions:{USED}`,
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


// ============================================
// AVITO MAROC
// ============================================
app.post('/api/avito-prices', authenticateRequest, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });
    const url = `https://www.avito.ma/fr/maroc/${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 6000
    });
    const priceRegex = /data-price="([0-9]+)"|"price":([0-9]+)|([0-9]{2,6})\s*(?:DH|MAD)/g;
    const prices = [];
    let match;
    while ((match = priceRegex.exec(response.data)) !== null) {
      const p = parseInt(match[1] || match[2] || match[3]);
      if (p > 50 && p < 500000) prices.push(Math.round(p)); // garder en MAD
    }
    if (!prices.length) return res.json({ success: false, prixMoyen: null, count: 0, source: 'avito' });
    const prixMoyen = Math.round(prices.reduce((a,b) => a+b) / prices.length);
    res.json({ success: true, prixMoyen, prixBas: Math.min(...prices), prixHaut: Math.max(...prices), count: prices.length, source: 'avito' });
  } catch (e) {
    res.json({ success: false, prixMoyen: null, count: 0, source: 'avito' });
  }
});

// ============================================
// KLEINANZEIGEN (Allemagne)
// ============================================
app.post('/api/kleinanzeigen-prices', authenticateRequest, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });
    const url = `https://www.kleinanzeigen.de/s-${encodeURIComponent(query)}/k0`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 6000
    });
    const priceRegex = /data-price="([0-9]+(?:\.[0-9]+)?)"|"([0-9]+(?:,[0-9]+)?)\s*€"/g;
    const prices = [];
    let match;
    while ((match = priceRegex.exec(response.data)) !== null) {
      const p = parseFloat((match[1] || match[2] || '0').replace(',', '.'));
      if (p > 1 && p < 100000) prices.push(Math.round(p));
    }
    if (!prices.length) return res.json({ success: false, prixMoyen: null, count: 0, source: 'kleinanzeigen' });
    const prixMoyen = Math.round(prices.reduce((a,b) => a+b) / prices.length);
    res.json({ success: true, prixMoyen, prixBas: Math.min(...prices), prixHaut: Math.max(...prices), count: prices.length, source: 'kleinanzeigen' });
  } catch (e) {
    res.json({ success: false, prixMoyen: null, count: 0, source: 'kleinanzeigen' });
  }
});

// ============================================
// WALLAPOP (Espagne)
// ============================================
app.post('/api/wallapop-prices', authenticateRequest, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });
    const url = `https://api.wallapop.com/api/v3/general/search?keywords=${encodeURIComponent(query)}&filters_source=search_box&order_by=most_relevance`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 6000
    });
    const items = response.data?.search_objects || [];
    const prices = items.map(i => parseFloat(i.content?.price || 0)).filter(p => p > 0);
    if (!prices.length) return res.json({ success: false, prixMoyen: null, count: 0, source: 'wallapop' });
    const prixMoyen = Math.round(prices.reduce((a,b) => a+b) / prices.length);
    res.json({ success: true, prixMoyen, prixBas: Math.min(...prices), prixHaut: Math.max(...prices), count: prices.length, source: 'wallapop' });
  } catch (e) {
    res.json({ success: false, prixMoyen: null, count: 0, source: 'wallapop' });
  }
});

// ============================================
// TUTTI.CH (Suisse)
// ============================================
app.post('/api/tutti-prices', authenticateRequest, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.json({ success: false, prixMoyen: null, count: 0 });
    const url = `https://www.tutti.ch/fr/q?query=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 6000
    });
    const priceRegex = /CHF\s*([0-9]+(?:[.,][0-9]+)?)|([0-9]+(?:[.,][0-9]+)?)\s*CHF/g;
    const prices = [];
    let match;
    while ((match = priceRegex.exec(response.data)) !== null) {
      const p = parseFloat((match[1] || match[2] || '0').replace(',', '.'));
      if (p > 1 && p < 100000) prices.push(Math.round(p));
    }
    if (!prices.length) return res.json({ success: false, prixMoyen: null, count: 0, source: 'tutti' });
    const prixMoyen = Math.round(prices.reduce((a,b) => a+b) / prices.length);
    res.json({ success: true, prixMoyen, prixBas: Math.min(...prices), prixHaut: Math.max(...prices), count: prices.length, source: 'tutti' });
  } catch (e) {
    res.json({ success: false, prixMoyen: null, count: 0, source: 'tutti' });
  }
});


// ============================================
// PRIX PAR PAYS - endpoint intelligent
// ============================================
app.post('/api/prices-by-country', authenticateRequest, async (req, res) => {
  try {
    const { query, countryCode = 'CH' } = req.body;
    if (!query) return res.json({ success: false, results: [] });

    const countryEndpoints = {
      CH: ['ebay', 'ricardo', 'tutti'],
      FR: ['ebay', 'leboncoin', 'vinted'],
      DE: ['ebay', 'kleinanzeigen'],
      ES: ['ebay', 'wallapop'],
      MA: ['avito'],
      DZ: [],
      TN: [],
      IT: ['ebay'],
      GB: ['ebay'],
      BE: ['ebay', 'vinted'],
      NL: ['ebay'],
      default: ['ebay']
    };

    const endpoints = countryEndpoints[countryCode] || countryEndpoints.default;
    const token = await getEbayToken();

    const results = {};

    await Promise.allSettled(endpoints.map(async (site) => {
      try {
        if (site === 'ebay') {
          const marketMap = { CH: 'EBAY_CH', FR: 'EBAY_FR', DE: 'EBAY_DE', ES: 'EBAY_ES', IT: 'EBAY_IT', GB: 'EBAY_GB', BE: 'EBAY_BE', NL: 'EBAY_NL' };
          const marketplace = marketMap[countryCode] || 'EBAY_FR';
          const r = await axios.get(
            `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=10&filter=buyingOptions:{FIXED_PRICE},conditions:{USED}`,
            { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplace }, timeout: 5000 }
          );
          const items = r.data.itemSummaries || [];
          const prices = items.map(i => parseFloat(i.price?.value || 0)).filter(p => p > 0);
          if (prices.length) results.ebay = Math.round(prices.reduce((a,b) => a+b) / prices.length);
        }
        if (site === 'avito') {
          const r = await axios.get(`https://www.avito.ma/fr/maroc/${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
          const m = r.data.match(/([0-9]{2,6})\s*(?:DH|MAD)/g);
          if (m && m.length) {
            const prices = m.map(p => parseInt(p.replace(/[^0-9]/g, ''))).filter(p => p > 50 && p < 500000);
            if (prices.length) results.avito = Math.round(prices.reduce((a,b) => a+b) / prices.length);
          }
        }
      } catch(e) {}
    }));

    res.json({ success: true, results, countryCode });
  } catch(e) {
    res.json({ success: false, results: {}, error: e.message });
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
}, 10 * 60 * 1000);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));


// 4 NOUVEAUX SCRAPERS
async function scrapeGalaxus(q) {
  try {
    const r = await fetch(`https://www.galaxus.ch/en/search?q=${encodeURIComponent(q)}`);
    const m = (await r.text()).match(/CHF\s*([\d,\.]+)/i);
    return m ? { success: true, platform: 'Galaxus.ch', price: parseInt(m[1].replace(/[.,]/g, '')) } : { success: false };
  } catch(e) { return { success: false }; }
}

async function scrapeDigitec(q) {
  try {
    const r = await fetch(`https://www.digitec.ch/en/search?q=${encodeURIComponent(q)}`);
    const m = (await r.text()).match(/CHF\s*([\d,\.]+)/i);
    return m ? { success: true, platform: 'Digitec.ch', price: parseInt(m[1].replace(/[.,]/g, '')) } : { success: false };
  } catch(e) { return { success: false }; }
}

async function scrapeGrailed(q) {
  try {
    const r = await fetch(`https://www.grailed.com/search?query=${encodeURIComponent(q)}`);
    const m = (await r.text()).match(/\$([\d,\.]+)/);
    return m ? { success: true, platform: 'Grailed', price: Math.round(parseInt(m[1].replace(/[.,]/g, '')) * 0.92) } : { success: false };
  } catch(e) { return { success: false }; }
}

async function scrapeDepop(q) {
  try {
    const r = await fetch(`https://www.depop.com/search/?q=${encodeURIComponent(q)}`);
    const h = await r.text();
    const m = h.match(/[£$]\s*([\d,\.]+)/);
    if (!m) return { success: false };
    let p = parseInt(m[1].replace(/[.,]/g, ''));
    p = h.includes('£') ? Math.round(p * 1.18) : Math.round(p * 0.92);
    return { success: true, platform: 'Depop', price: p };
  } catch(e) { return { success: false }; }
}



app.post('/api/galaxus-prices', async (req, res) => {
  res.json(await scrapeGalaxus(req.body.query));
});

app.post('/api/digitec-prices', async (req, res) => {
  res.json(await scrapeDigitec(req.body.query));
});

app.post('/api/grailed-prices', async (req, res) => {
  res.json(await scrapeGrailed(req.body.query));
});

app.post('/api/depop-prices', async (req, res) => {
  res.json(await scrapeDepop(req.body.query));
});


app.listen(3000, () => console.log('✅ OBJEX Backend — Claude Vision actif!'));
// deploy trigger sam.  6 juin 2026 22:40:48 +01
