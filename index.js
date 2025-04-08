const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// 🧠 Cache für eine Stunde (3600000 ms)
let mealPlanCache = {
  data: null,
  timestamp: null
};

// ⚙️ Konfiguration für den XML-Parser
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_"
});

// 📊 Parst die Nährwertinformationen aus dem String
function parseNutrition(nutritionStr) {
  if (!nutritionStr) {
    console.log('No nutrition string provided');
    return {
      calories: '0',
      protein: '0.0',
      carbs: '0.0',
      fat: '0.0'
    };
  }

  // Debug log für den Eingabestring
  console.log('Raw nutrition string:', nutritionStr);

  // Bereinige den String von zusätzlichen Leerzeichen
  const cleanStr = nutritionStr.trim();

  // Extrahiere die Werte mit Regex-Patterns für beide Sprachen
  const kcalMatch = 
    cleanStr.match(/Brennwert=(\d+)\s*kJ\s*\((\d+)\s*kcal\)/) ||
    cleanStr.match(/Energy=(\d+)\s*kJ\s*\((\d+)\s*kcal\)/);

  const proteinMatch = 
    cleanStr.match(/Eiweiß=(\d+[,.]?\d*)\s*g/) ||
    cleanStr.match(/Protein=(\d+[,.]?\d*)\s*g/);

  const carbsMatch = 
    cleanStr.match(/Kohlenhydrate=(\d+[,.]?\d*)\s*g/) ||
    cleanStr.match(/Carbohydrates=(\d+[,.]?\d*)\s*g/);

  const fatMatch = 
    cleanStr.match(/Fett=(\d+[,.]?\d*)\s*g/) ||
    cleanStr.match(/Fat=(\d+[,.]?\d*)\s*g/);

  // Debug-Logs für die Matches
  console.log('Matches found:', {
    kcal: kcalMatch ? kcalMatch[2] : null,
    protein: proteinMatch ? proteinMatch[1] : null,
    carbs: carbsMatch ? carbsMatch[1] : null,
    fat: fatMatch ? fatMatch[1] : null
  });

  // Extrahiere die Werte und ersetze Kommas durch Punkte
  const calories = kcalMatch ? kcalMatch[2] : '0';
  const protein = proteinMatch ? proteinMatch[1].replace(',', '.') : '0.0';
  const carbs = carbsMatch ? carbsMatch[1].replace(',', '.') : '0.0';
  const fat = fatMatch ? fatMatch[1].replace(',', '.') : '0.0';

  const result = {
    calories,
    protein,
    carbs,
    fat
  };

  // Debug log für das Endergebnis
  console.log('Parsed nutrition values:', result);

  return result;
}

// 🔄 Holt und parsed die XML-Daten
async function fetchMealPlans() {
  try {
    console.log('📡 Starte Abruf der Speisepläne...');
    
    // Feste URLs für die XML-Dateien
    const MEAL_PLAN_URL = 'https://www.studentenwerk-hannover.de/fileadmin/user_upload/Speiseplan/SP-UTF8.xml';
    
    // Hole Speiseplan-Daten
    console.log('🌐 Hole Speiseplan von:', MEAL_PLAN_URL);
    const mealPlanResponse = await axios.get(MEAL_PLAN_URL, {
      timeout: 10000,
      headers: {
        'Accept': 'application/xml',
        'User-Agent': 'MensaApp/1.0'
      }
    });
    
    if (!mealPlanResponse.data) {
      throw new Error('Keine Daten im Speiseplan-Response erhalten');
    }
    
    console.log('📥 XML-Datei erfolgreich abgerufen');

    // Parse XML-Datei
    const mealPlanData = parser.parse(mealPlanResponse.data);
    console.log('📊 XML-Daten erfolgreich geparst');

    const meals = [];
    const mealPlanRows = mealPlanData.DATAPACKET?.ROWDATA?.ROW || [];

    console.log('Anzahl gefundener Speisen:', mealPlanRows.length);

    // Verarbeite Speiseplan-Daten
    mealPlanRows.forEach((row, index) => {
      const mensa = row['@_MENSA'] || '';

      // Definiere die erlaubten Standorte
      const allowedLocations = ["Mensa Campus Linden", "Hauptmensa", "Contine"];

      // Filter: Verarbeite nur Einträge von erlaubten Standorten
      if (!allowedLocations.includes(mensa)) {
        // console.log(`ℹ️ Überspringe Eintrag für Standort: ${mensa}`); // Optional: Log skipped locations
        return; 
      }

      // Prüfe, ob es ein valider Eintrag ist (hat einen Namen)
      const mealName = row['@_BESCHREIBUNG'];
      if (!mealName) {
          console.warn(`⚠️ Überspringe Eintrag ${index + 1} für ${mensa}: Fehlender Name.`);
          return; // Überspringe Einträge ohne Namen
      }
      
      const nutritionStr = row['@_NAEHRWERTE'];

      console.log(`\n🍽️ Verarbeite Speise ${index + 1}/${mealPlanRows.length}`);
      console.log('Name:', mealName);
      console.log('Nährwerte (raw):', nutritionStr);

      const studentPrice = row['@_PREIS_STUDENT']?.replace(',', '.') || '0';
      const employeePrice = row['@_PREIS_BEDIENSTETER']?.replace(',', '.') || '0';
      const guestPrice = row['@_PREIS_GAST']?.replace(',', '.') || '0';

      // Extrahiere Nährwerte
      const nutrition = parseNutrition(nutritionStr);

      // Validiere die extrahierten Nährwerte
      if (nutrition.calories === '0' && nutrition.protein === '0.0' && 
          nutrition.carbs === '0.0' && nutrition.fat === '0.0') {
        console.warn(`⚠️ Keine Nährwerte gefunden für: ${mealName}`);
      } else {
        console.log('✅ Nährwerte erfolgreich extrahiert:', nutrition);
      }

      meals.push({
        date: row['@_DATUM'],
        location: mensa,
        name: mealName,
        price: {
          student: parseFloat(studentPrice).toFixed(2),
          employee: parseFloat(employeePrice).toFixed(2),
          guest: parseFloat(guestPrice).toFixed(2)
        },
        nutrition: nutrition,
        allergens: (row['@_KENNZEICHNUNG'] || '').split(',').map(a => a.trim()).filter(Boolean),
        co2Rating: row['@_EXTINFO_CO2_BEWERTUNG'] || '',
        co2Value: parseFloat(row['@_EXTINFO_CO2_WERT']) || 0,
        isClimateFriendly: parseFloat(row['@_EXTINFO_CO2_EINSPARUNG'] || '0') > 0
      });
    });

    console.log(`\n✅ Verarbeitung abgeschlossen. ${meals.length} Mahlzeiten gefunden.`);
    return meals;
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Speisepläne:', error);
    throw error;
  }
}

// 📥 API-Route zum Abrufen der Mensadaten
app.get('/api/mensa', async (req, res) => {
  console.log('📥 API-Anfrage empfangen');

  const now = Date.now();
  const cacheValid = mealPlanCache.data && (now - mealPlanCache.timestamp < 3600000);

  if (cacheValid) {
    console.log('✅ Sende Daten aus Cache');
    return res.json(mealPlanCache.data);
  }

  try {
    console.log('⏳ Cache abgelaufen – lade neue Daten');
    const meals = await fetchMealPlans();

    mealPlanCache = {
      data: meals,
      timestamp: now
    };

    console.log('✅ Neue Daten gesendet');
    res.json(meals);
  } catch (error) {
    console.error('❌ Fehler beim Laden der Daten:', error);
    res.status(500).json({ 
      error: 'Fehler beim Laden des Speiseplans',
      details: error.message 
    });
  }
});

// Hilfsfunktionen für Validierung
function validatePrice(price, defaultValue) {
  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0) {
    console.warn(`⚠️ Ungültiger Preis: ${price}, verwende Standardwert: ${defaultValue}€`);
    return defaultValue;
  }
  return Math.round(parsedPrice * 100) / 100; // Runde auf 2 Dezimalstellen
}

function validateNumber(value, defaultValue) {
  const parsedValue = parseFloat(value);
  return isNaN(parsedValue) ? defaultValue : parsedValue;
}

// 🚀 Starte Server
app.listen(port, () => {
  console.log(`🚀 Server läuft auf http://localhost:${port}`);
});
