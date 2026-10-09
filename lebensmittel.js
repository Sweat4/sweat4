/* =====================================================================
   SWEAT4 – Lebensmittel-Datenbank
   Nährwerte pro 100 g (Richtwerte nach üblichen deutschen Nährwerttabellen –
   die Angabe auf der Packung hat immer Vorrang).
   Felder: id, n (Name), k (Kategorie), p (Eiweiß), c (Kohlenhydrate), f (Fett), fi (Ballaststoffe),
           u (optional: Portionseinheit { l: Bezeichnung, g: Gramm }), fix (Gemüse: feste Standardmenge in g)
   Kategorien: p = Eiweiß · c = Kohlenhydrate · v = Gemüse & Obst (Ballaststoffe) · f = Fett
   Neues Lebensmittel: einfach eine Zeile ergänzen.
   ===================================================================== */
window.SW_FOOD_CATS = [
  { k: 'p', l: 'Eiweiß' },
  { k: 'c', l: 'Kohlenhydrate' },
  { k: 'v', l: 'Gemüse & Obst' },
  { k: 'f', l: 'Fett' },
];
window.SW_FOODS = [
  /* ---------- Eiweiß ---------- */
  { id: 'haehnchen', n: 'Hähnchenbrust (roh)', k: 'p', p: 23.5, c: 0, f: 1.2, fi: 0 },
  { id: 'pute', n: 'Putenbrust (roh)', k: 'p', p: 24, c: 0, f: 1, fi: 0 },
  { id: 'rinderhack', n: 'Rinderhack 5 % Fett (roh)', k: 'p', p: 21, c: 0, f: 5, fi: 0 },
  { id: 'rindersteak', n: 'Rindersteak, Hüfte (roh)', k: 'p', p: 22, c: 0, f: 4, fi: 0 },
  { id: 'schweinefilet', n: 'Schweinefilet (roh)', k: 'p', p: 22, c: 0, f: 2, fi: 0 },
  { id: 'lachs', n: 'Lachs (roh)', k: 'p', p: 20, c: 0, f: 13, fi: 0 },
  { id: 'thunfisch', n: 'Thunfisch im eigenen Saft (abgetropft)', k: 'p', p: 26, c: 0, f: 1, fi: 0 },
  { id: 'kabeljau', n: 'Kabeljau / Seelachs (roh)', k: 'p', p: 18, c: 0, f: 0.8, fi: 0 },
  { id: 'garnelen', n: 'Garnelen (roh)', k: 'p', p: 20, c: 0, f: 1, fi: 0 },
  { id: 'ei', n: 'Eier', k: 'p', p: 13, c: 0.7, f: 11, fi: 0, u: { l: 'Ei (M)', g: 60 } },
  { id: 'eiklar', n: 'Eiklar', k: 'p', p: 11, c: 0.7, f: 0.2, fi: 0 },
  { id: 'magerquark', n: 'Magerquark', k: 'p', p: 12, c: 4, f: 0.3, fi: 0 },
  { id: 'skyr', n: 'Skyr / High-Protein-Quark', k: 'p', p: 11, c: 4, f: 0.2, fi: 0 },
  { id: 'huettenkaese', n: 'Körniger Frischkäse', k: 'p', p: 12, c: 3, f: 4, fi: 0 },
  { id: 'griech-joghurt', n: 'Griechischer Joghurt 2 %', k: 'p', p: 9, c: 4, f: 2, fi: 0 },
  { id: 'harzer', n: 'Harzer Käse', k: 'p', p: 27, c: 0, f: 0.5, fi: 0 },
  { id: 'gouda-light', n: 'Käse, light (z. B. Gouda 30 %)', k: 'p', p: 30, c: 0, f: 16, fi: 0, u: { l: 'Scheibe', g: 20 } },
  { id: 'mozzarella-light', n: 'Mozzarella light', k: 'p', p: 19, c: 1, f: 9, fi: 0 },
  { id: 'feta', n: 'Feta', k: 'p', p: 17, c: 1, f: 21, fi: 0 },
  { id: 'haehnchen-aufschnitt', n: 'Hähnchen- / Putenaufschnitt', k: 'p', p: 20, c: 1, f: 2, fi: 0, u: { l: 'Scheibe', g: 15 } },
  { id: 'tofu', n: 'Tofu natur', k: 'p', p: 15, c: 2, f: 8, fi: 1 },
  { id: 'tempeh', n: 'Tempeh', k: 'p', p: 19, c: 9, f: 11, fi: 5 },
  { id: 'seitan', n: 'Seitan', k: 'p', p: 25, c: 4, f: 2, fi: 1 },
  { id: 'whey', n: 'Whey-Protein (Pulver)', k: 'p', p: 78, c: 7, f: 6, fi: 0, u: { l: 'Messlöffel', g: 30 } },
  { id: 'vegan-protein', n: 'Veganes Proteinpulver', k: 'p', p: 75, c: 5, f: 7, fi: 2, u: { l: 'Messlöffel', g: 30 } },

  /* ---------- Kohlenhydrate ---------- */
  { id: 'reis', n: 'Reis (gekocht)', k: 'c', p: 2.7, c: 28, f: 0.3, fi: 0.4 },
  { id: 'vollkornreis', n: 'Vollkornreis (gekocht)', k: 'c', p: 2.6, c: 23, f: 0.9, fi: 1.8 },
  { id: 'nudeln', n: 'Nudeln (gekocht)', k: 'c', p: 5, c: 30, f: 0.9, fi: 1.5 },
  { id: 'vollkornnudeln', n: 'Vollkornnudeln (gekocht)', k: 'c', p: 5.5, c: 26, f: 1, fi: 4 },
  { id: 'kartoffeln', n: 'Kartoffeln (gekocht)', k: 'c', p: 2, c: 17, f: 0.1, fi: 2 },
  { id: 'suesskartoffel', n: 'Süßkartoffel (gekocht)', k: 'c', p: 1.6, c: 20, f: 0.1, fi: 3 },
  { id: 'haferflocken', n: 'Haferflocken', k: 'c', p: 13.5, c: 59, f: 7, fi: 10 },
  { id: 'vollkornbrot', n: 'Vollkornbrot', k: 'c', p: 7, c: 40, f: 1.5, fi: 7, u: { l: 'Scheibe', g: 50 } },
  { id: 'broetchen', n: 'Brötchen (Weizen)', k: 'c', p: 8, c: 51, f: 1.5, fi: 3, u: { l: 'Brötchen', g: 55 } },
  { id: 'vollkorntoast', n: 'Vollkorntoast', k: 'c', p: 9, c: 42, f: 4, fi: 6, u: { l: 'Scheibe', g: 28 } },
  { id: 'reiswaffeln', n: 'Reiswaffeln', k: 'c', p: 8, c: 81, f: 3, fi: 3, u: { l: 'Waffel', g: 8 } },
  { id: 'quinoa', n: 'Quinoa (gekocht)', k: 'c', p: 4.4, c: 21, f: 1.9, fi: 2.8 },
  { id: 'couscous', n: 'Couscous (gekocht)', k: 'c', p: 3.8, c: 23, f: 0.2, fi: 1.4 },
  { id: 'wrap', n: 'Weizen-Wrap', k: 'c', p: 8, c: 50, f: 7, fi: 3, u: { l: 'Wrap', g: 60 } },
  { id: 'linsen', n: 'Linsen (gekocht)', k: 'c', p: 9, c: 17, f: 0.4, fi: 8 },
  { id: 'kichererbsen', n: 'Kichererbsen (Dose, abgetropft)', k: 'c', p: 7, c: 14, f: 2.5, fi: 6 },
  { id: 'kidneybohnen', n: 'Kidneybohnen (Dose, abgetropft)', k: 'c', p: 7, c: 13, f: 0.5, fi: 6 },
  { id: 'honig', n: 'Honig', k: 'c', p: 0.4, c: 80, f: 0, fi: 0, u: { l: 'TL', g: 8 } },

  /* ---------- Gemüse & Obst (Ballaststoffe) ---------- */
  { id: 'brokkoli', n: 'Brokkoli', k: 'v', p: 3, c: 3, f: 0.4, fi: 3, fix: 150 },
  { id: 'gurke', n: 'Gurke', k: 'v', p: 0.6, c: 2, f: 0.2, fi: 0.5, fix: 100 },
  { id: 'tomate', n: 'Tomaten', k: 'v', p: 1, c: 3, f: 0.2, fi: 1.2, fix: 100 },
  { id: 'paprika', n: 'Paprika', k: 'v', p: 1, c: 5, f: 0.3, fi: 2, fix: 100 },
  { id: 'spinat', n: 'Spinat', k: 'v', p: 2.5, c: 1, f: 0.4, fi: 2.6, fix: 150 },
  { id: 'salat', n: 'Blattsalat', k: 'v', p: 1.3, c: 1.5, f: 0.2, fi: 1.3, fix: 80 },
  { id: 'zucchini', n: 'Zucchini', k: 'v', p: 1.5, c: 2, f: 0.3, fi: 1, fix: 150 },
  { id: 'champignons', n: 'Champignons', k: 'v', p: 3, c: 0.5, f: 0.3, fi: 2, fix: 100 },
  { id: 'moehren', n: 'Möhren', k: 'v', p: 1, c: 7, f: 0.2, fi: 3, fix: 100 },
  { id: 'gruene-bohnen', n: 'Grüne Bohnen', k: 'v', p: 2, c: 5, f: 0.2, fi: 2.5, fix: 150 },
  { id: 'blumenkohl', n: 'Blumenkohl', k: 'v', p: 2, c: 2.5, f: 0.3, fi: 3, fix: 150 },
  { id: 'banane', n: 'Banane', k: 'v', p: 1.1, c: 21, f: 0.3, fi: 2, u: { l: 'Banane', g: 120 }, fix: 120 },
  { id: 'apfel', n: 'Apfel', k: 'v', p: 0.3, c: 12, f: 0.2, fi: 2.4, u: { l: 'Apfel', g: 150 }, fix: 150 },
  { id: 'beeren', n: 'Beeren (gemischt)', k: 'v', p: 1, c: 10, f: 0.5, fi: 4, fix: 100 },
  { id: 'orange', n: 'Orange', k: 'v', p: 1, c: 9, f: 0.2, fi: 2, u: { l: 'Orange', g: 150 }, fix: 150 },

  /* ---------- Fett ---------- */
  { id: 'olivenoel', n: 'Olivenöl', k: 'f', p: 0, c: 0, f: 100, fi: 0, u: { l: 'EL', g: 10 } },
  { id: 'rapsoel', n: 'Rapsöl', k: 'f', p: 0, c: 0, f: 100, fi: 0, u: { l: 'EL', g: 10 } },
  { id: 'butter', n: 'Butter', k: 'f', p: 0.7, c: 0.6, f: 83, fi: 0, u: { l: 'TL', g: 5 } },
  { id: 'avocado', n: 'Avocado', k: 'f', p: 2, c: 2, f: 15, fi: 6 },
  { id: 'mandeln', n: 'Mandeln', k: 'f', p: 21, c: 6, f: 53, fi: 12 },
  { id: 'walnuesse', n: 'Walnüsse', k: 'f', p: 15, c: 10, f: 65, fi: 6 },
  { id: 'cashews', n: 'Cashewkerne', k: 'f', p: 18, c: 30, f: 44, fi: 3 },
  { id: 'erdnussbutter', n: 'Erdnussbutter', k: 'f', p: 25, c: 12, f: 50, fi: 6, u: { l: 'EL', g: 15 } },
  { id: 'leinsamen', n: 'Leinsamen (geschrotet)', k: 'f', p: 24, c: 2, f: 31, fi: 35, u: { l: 'EL', g: 10 } },
  { id: 'chiasamen', n: 'Chiasamen', k: 'f', p: 17, c: 5, f: 31, fi: 34, u: { l: 'EL', g: 12 } },
];

/* Mahlzeit-Beispiele: werden auf die Ziele der jeweiligen Mahlzeit umgerechnet */
window.SW_MEAL_EXAMPLES = [
  { id: 'fruehstueck-ei', n: 'Eier, Frischkäse & Brot', when: 'morgens', items: ['ei', 'huettenkaese', 'gouda-light', 'vollkornbrot', 'gurke', 'tomate', 'banane'] },
  { id: 'quark-bowl', n: 'Quark-Bowl mit Haferflocken', when: 'morgens', items: ['magerquark', 'haferflocken', 'beeren', 'mandeln'] },
  { id: 'haehnchen-reis', n: 'Hähnchen, Reis & Brokkoli', when: 'mittags', items: ['haehnchen', 'reis', 'brokkoli', 'olivenoel'] },
  { id: 'lachs-kartoffel', n: 'Lachs, Kartoffeln & Spinat', when: 'abends', items: ['lachs', 'kartoffeln', 'spinat'] },
  { id: 'pute-nudeln', n: 'Pute, Vollkornnudeln & Gemüse', when: 'mittags', items: ['pute', 'vollkornnudeln', 'paprika', 'zucchini', 'olivenoel'] },
  { id: 'rind-suesskartoffel', n: 'Rinderhack, Süßkartoffel & Bohnen', when: 'abends', items: ['rinderhack', 'suesskartoffel', 'gruene-bohnen'] },
  { id: 'tofu-reis', n: 'Tofu, Reis & Gemüse (vegan)', when: 'mittags', items: ['tofu', 'vollkornreis', 'brokkoli', 'paprika'] },
  { id: 'shake', n: 'Shake nach dem Training', when: 'nach dem Training', items: ['whey', 'haferflocken', 'banane'] },
];
