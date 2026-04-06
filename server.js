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
