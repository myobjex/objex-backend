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
      model: 'claude-sonnet-4-5',
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
            text: `Tu es un expert en estimation d'objets (antiquités, mode, art, électronique, véhicules, brocante).

Analyse cette image et réponds UNIQUEMENT en JSON valide, sans texte avant ou après:
{
  "nom": "nom exact et précis du produit (ex: Nike Air Force 1 Low White 2022)",
  "marque": "marque si visible sinon null",
  "modele": "modèle précis si connu sinon null",
  "categorie": "mode|antiquite|electronique|brocante|vehicule|art|maison|autre",
  "etat": "excellent|bon|moyen|mauvais",
  "epoque": "période ou année si connue sinon null",
  "description": "description courte en français (max 20 mots)",
  "prix_neuf": prix en euros (nombre entier) ou null,
  "prix_occasion": prix en euros (nombre entier) ou null,
  "confiance": niveau de confiance entre 0 et 100,
  "plateformes": ["liste", "des", "meilleures", "plateformes", "pour", "vendre", "cet", "objet"]
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
