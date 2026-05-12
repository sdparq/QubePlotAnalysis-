/**
 * Qube Dubai class system — encodes the "Matrix of Classes" reference data.
 * Each class (A → G, "Most Luxurious" → "Economical") groups Dubai zones with
 * similar real-estate characteristics. Per class we know the typical typology
 * mix, average unit areas, prices, floor heights and parking standard.
 *
 * The defaults below are the seed values from the Excel matrix. They are
 * exposed read-only here; the runtime store layers an editable override on
 * top so the team can tweak the library without redeploying.
 */

export type ZoneClass = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type TypologyKey =
  | "studio"
  | "1BR"
  | "2BR"
  | "3BR"
  | "4BR"
  | "5BR"
  | "6BR"
  | "7BR"
  | "penthouse";

export const TYPOLOGY_KEYS: TypologyKey[] = [
  "studio", "1BR", "2BR", "3BR", "4BR", "5BR", "6BR", "7BR", "penthouse",
];

export const TYPOLOGY_LABELS: Record<TypologyKey, string> = {
  studio: "Studio",
  "1BR": "1 Bedroom",
  "2BR": "2 Bedrooms",
  "3BR": "3 Bedrooms",
  "4BR": "4 Bedrooms",
  "5BR": "5 Bedrooms",
  "6BR": "6 Bedrooms",
  "7BR": "7 Bedrooms",
  penthouse: "Penthouse",
};

export interface ZoneClassRow {
  letter: ZoneClass;
  /** Short tier name — e.g. "Most Luxurious", "Economical". */
  name: string;
  /** Human description of the location profile. */
  description: string;
  /** Dubai zones that fall in this class. */
  locations: string[];
  /** Typology mix — fractions of total units, should sum to ~1. */
  typologyMix: Record<TypologyKey, number>;
  /** Average sellable area per typology, [min, max] in SqFt. */
  avgAreaSqft: Record<TypologyKey, [number, number]>;
  /** Sale price AED per SqFt GSA, [min, max]. Empty range [0,0] = no data. */
  salePriceAedPerSqft: Record<TypologyKey, [number, number]>;
  /** Balconies as fraction of NSA. */
  balconyPctOfNsa: number;
  /** Parking area per car (SqFt) — DCD-style standard at this class. */
  parkingAreaPerCarSqft: number;
  /** Design fee, AED per SqFt of GFA. */
  designPriceAedPerSqftGfa: number;
  /** Floor-to-floor heights (m) per building section. */
  floorHeights: {
    basement: number;
    ground: number;
    podium: number;
    firstFloor: number;
    typical: number;
  };
  /** Construction price AED per SqFt BUA, by height tier. */
  constructionAedPerSqftBua: {
    lowRise: [number, number];          // up to 15 m
    midRise: [number, number];          // 15–23 m
    highRise: [number, number];         // 23–90 m
    superHigh: [number, number];        // > 90 m
    superHigh180: [number, number];     // > 180 m
    superHigh270: [number, number];     // > 270 m
    superHigh360min: number;            // > 360 m, minimum (open ended)
  };
}

const STUDIO: TypologyKey = "studio";

function r<T>(values: T[]): Record<ZoneClass, T> {
  return { A: values[0], B: values[1], C: values[2], D: values[3], E: values[4], F: values[5], G: values[6] };
}

/* ---------------- Locations per class ---------------- */

const LOCATIONS_A = [
  "Palm Jumeirah",
  "Bluewaters Island",
  "Jumeirah First",
  "Jumeirah Second",
  "Jumeirah Bay Island",
  "Pearl Jumeirah",
];
const LOCATIONS_B = [
  "Dubai Marina",
  "Downtown Dubai",
  "Dubai Creek Harbour",
  "Dubai Harbour",
  "City Walk",
  "Zaabeel First",
  "Jumeirah Beach Residence (JBR)",
  "Umm Suqeim Third",
  "La Mer",
  "DIFC",
];
const LOCATIONS_C = [
  "Meydan One",
  "Business Bay",
  "Dubai Hills Estate",
  "Jumeirah Lake Towers (JLT)",
  "Dubai Maritime City",
  "Al Mina",
  "Dubai Islands",
  "Ghaf Woods",
  "Al Jadaf",
  "Al Kifaf",
  "The Greens",
  "Culture Village",
  "District One",
  "Nad Al Shiba",
  "Al Sufouh",
  "Al Satwa",
  "The Old Town",
  "Dubai Healthcare City",
  "The Hills",
  "Al Barari",
  "Dubai Design District",
];
const LOCATIONS_D = [
  "Jumeirah Village Circle (JVC)",
  "Arjan",
  "Dubai Studio City",
  "Expo City",
  "Al Barshaa South Third",
  "Jumeirah Heights",
];
const LOCATIONS_E = [
  "Dubai South",
  "Al Furjan",
  "Dubai Sports City",
  "Jumeirah Village Triangle (JVT)",
  "Dubai Science Park (Dubiotech)",
  "Town Square",
  "Motorcity",
  "Damac Lagoons",
  "Damac Hills",
  "Haven by Aldar",
  "Remraam",
  "Mirdif",
  "District Eleven",
  "District Seven",
  "Jumeirah Golf Estates",
  "Barsha Heights",
  "Dubai Festival City",
  "Trade Center Second",
  "Muhaisanah First",
  "Mudon",
];
const LOCATIONS_F = [
  "Dubailand Residence Complex",
  "Dubai Production City (IMPZ)",
  "Dubai Silicon Oasis",
  "Majan",
  "Liwan",
  "City of Arabia",
  "Rukan",
  "Al Quoz Fourth",
  "Living Legends",
  "Green Community East",
  "Green Community West",
  "Al Barsha First",
  "Falcon City of Wonders",
];
const LOCATIONS_G = [
  "International City",
  "Jebel Ali",
  "Damac Hills 2",
  "Discovery Gardens",
  "Dubai Investment Park (DIP)",
  "Dubai Industrial City",
  "Dubai Waterfront",
];

/* ---------------- Per-class mix, areas, prices ---------------- */

const TYPOLOGY_MIX_BY_CLASS: Record<ZoneClass, Record<TypologyKey, number>> = {
  A: { studio: 0.0766, "1BR": 0.1966, "2BR": 0.4002, "3BR": 0.2379, "4BR": 0.0670, "5BR": 0.0156, "6BR": 0.0005, "7BR": 0.0005, penthouse: 0.0050 },
  B: { studio: 0.0468, "1BR": 0.3753, "2BR": 0.4044, "3BR": 0.1467, "4BR": 0.0227, "5BR": 0.0020, "6BR": 0.0003, "7BR": 0,      penthouse: 0.0016 },
  C: { studio: 0.1773, "1BR": 0.4451, "2BR": 0.2917, "3BR": 0.0766, "4BR": 0.0085, "5BR": 0.0006, "6BR": 0.0002, "7BR": 0,      penthouse: 0.0001 },
  D: { studio: 0.3161, "1BR": 0.5072, "2BR": 0.1564, "3BR": 0.0195, "4BR": 0.0006, "5BR": 0,      "6BR": 0,      "7BR": 0,      penthouse: 0.0002 },
  E: { studio: 0.2115, "1BR": 0.4607, "2BR": 0.2702, "3BR": 0.0551, "4BR": 0.0023, "5BR": 0.0001, "6BR": 0,      "7BR": 0,      penthouse: 0.0001 },
  F: { studio: 0.3885, "1BR": 0.4119, "2BR": 0.1798, "3BR": 0.0192, "4BR": 0.0003, "5BR": 0.0003, "6BR": 0,      "7BR": 0,      penthouse: 0      },
  G: { studio: 0.2629, "1BR": 0.5001, "2BR": 0.1983, "3BR": 0.0381, "4BR": 0.0005, "5BR": 0,      "6BR": 0,      "7BR": 0,      penthouse: 0      },
};

const AVG_AREA_BY_CLASS: Record<ZoneClass, Record<TypologyKey, [number, number]>> = {
  A: { studio: [450, 800], "1BR": [920, 1560], "2BR": [1450, 2050], "3BR": [2050, 3350], "4BR": [3750, 7150], "5BR": [8400, 15270], "6BR": [11300, 11300], "7BR": [17140, 17140], penthouse: [5280, 5280] },
  B: { studio: [480, 680], "1BR": [750, 1065], "2BR": [1175, 1465], "3BR": [1780, 2600], "4BR": [2950, 4950], "5BR": [6450, 9050],  "6BR": [8650, 16000], "7BR": [0, 0],         penthouse: [3200, 4250] },
  C: { studio: [300, 680], "1BR": [680, 1770], "2BR": [1100, 2920], "3BR": [1680, 4400], "4BR": [2110, 12220], "5BR": [3400, 10610], "6BR": [9120, 14330], "7BR": [0, 0],        penthouse: [3250, 4330] },
  D: { studio: [375, 440], "1BR": [690, 910],  "2BR": [1190, 2120], "3BR": [1585, 2620], "4BR": [4070, 4070], "5BR": [0, 0],        "6BR": [0, 0],        "7BR": [0, 0],         penthouse: [3590, 3590] },
  E: { studio: [340, 845], "1BR": [670, 1210], "2BR": [1050, 2090], "3BR": [1600, 3220], "4BR": [2320, 4985], "5BR": [8100, 8850],  "6BR": [0, 0],        "7BR": [0, 0],         penthouse: [1160, 1160] },
  F: { studio: [385, 610], "1BR": [615, 1095], "2BR": [975, 1755],  "3BR": [1480, 3105], "4BR": [4040, 5035], "5BR": [3770, 3770],  "6BR": [0, 0],        "7BR": [0, 0],         penthouse: [0, 0] },
  G: { studio: [390, 510], "1BR": [555, 920],  "2BR": [850, 1380],  "3BR": [1410, 2155], "4BR": [3515, 3515], "5BR": [0, 0],        "6BR": [0, 0],        "7BR": [0, 0],         penthouse: [0, 0] },
};

const SALE_PRICE_BY_CLASS: Record<ZoneClass, Record<TypologyKey, [number, number]>> = {
  A: { studio: [3376, 4680], "1BR": [1544, 7793], "2BR": [2949, 10209], "3BR": [3484, 11126], "4BR": [3391, 10303], "5BR": [3235, 12182], "6BR": [5751, 5751], "7BR": [6767, 6767], penthouse: [2142, 2142] },
  B: { studio: [2575, 2993], "1BR": [1972, 3999], "2BR": [1926, 4178],  "3BR": [1778, 4392],  "4BR": [2259, 4782],  "5BR": [2298, 5245],  "6BR": [3831, 5051], "7BR": [0, 0],       penthouse: [1650, 1838] },
  C: { studio: [1509, 2643], "1BR": [1455, 2876], "2BR": [1391, 2759],  "3BR": [1042, 3794],  "4BR": [866, 4046],   "5BR": [1011, 3968],  "6BR": [1745, 3700], "7BR": [0, 0],       penthouse: [831, 1508] },
  D: { studio: [1408, 1487], "1BR": [1166, 3079], "2BR": [1074, 2163],  "3BR": [899, 2024],   "4BR": [849, 849],    "5BR": [0, 0],        "6BR": [0, 0],       "7BR": [0, 0],       penthouse: [601, 601] },
  E: { studio: [875, 1648],  "1BR": [772, 1681],  "2BR": [752, 2774],   "3BR": [713, 1423],   "4BR": [814, 2495],   "5BR": [827, 1073],   "6BR": [0, 0],       "7BR": [0, 0],       penthouse: [566, 566] },
  F: { studio: [775, 1553],  "1BR": [732, 1289],  "2BR": [806, 1215],   "3BR": [634, 1033],   "4BR": [577, 808],    "5BR": [555, 555],    "6BR": [0, 0],       "7BR": [0, 0],       penthouse: [0, 0] },
  G: { studio: [643, 1449],  "1BR": [652, 1238],  "2BR": [578, 1233],   "3BR": [581, 1241],   "4BR": [645, 645],    "5BR": [0, 0],        "6BR": [0, 0],       "7BR": [0, 0],       penthouse: [0, 0] },
};

const BALCONY_PCT = r([0.18, 0.156, 0.144, 0.133, 0.121, 0.11, 0.10]);
const PARKING_SQFT = r([500, 500, 450, 450, 400, 400, 400]);
const DESIGN_AED = r([35.0, 28.43, 25.14, 21.86, 18.57, 15.29, 12.0]);

const FLOOR_HEIGHTS: Record<ZoneClass, ZoneClassRow["floorHeights"]> = {
  A: { basement: 4.0, ground: 6.0, podium: 3.6, firstFloor: 4.2, typical: 4.0 },
  B: { basement: 4.0, ground: 5.0, podium: 3.6, firstFloor: 4.2, typical: 3.8 },
  C: { basement: 4.0, ground: 4.5, podium: 3.6, firstFloor: 4.0, typical: 3.6 },
  D: { basement: 4.0, ground: 4.5, podium: 3.6, firstFloor: 4.0, typical: 3.6 },
  E: { basement: 4.0, ground: 4.0, podium: 3.6, firstFloor: 3.6, typical: 3.4 },
  F: { basement: 4.0, ground: 4.0, podium: 3.6, firstFloor: 3.6, typical: 3.4 },
  G: { basement: 4.0, ground: 4.0, podium: 3.6, firstFloor: 3.6, typical: 3.4 },
};

const CONSTRUCTION_PRICE: Record<ZoneClass, ZoneClassRow["constructionAedPerSqftBua"]> = {
  A: { lowRise: [450, 550], midRise: [450, 550], highRise: [500, 650], superHigh: [550, 680], superHigh180: [650, 800], superHigh270: [700, 850], superHigh360min: 750 },
  B: { lowRise: [450, 550], midRise: [450, 550], highRise: [500, 650], superHigh: [550, 680], superHigh180: [650, 800], superHigh270: [700, 850], superHigh360min: 750 },
  C: { lowRise: [450, 550], midRise: [450, 550], highRise: [500, 650], superHigh: [550, 680], superHigh180: [650, 800], superHigh270: [700, 850], superHigh360min: 750 },
  D: { lowRise: [370, 400], midRise: [380, 420], highRise: [420, 480], superHigh: [480, 520], superHigh180: [550, 650], superHigh270: [600, 700], superHigh360min: 650 },
  E: { lowRise: [370, 400], midRise: [380, 420], highRise: [420, 480], superHigh: [480, 520], superHigh180: [550, 650], superHigh270: [600, 700], superHigh360min: 650 },
  F: { lowRise: [370, 400], midRise: [380, 420], highRise: [420, 480], superHigh: [480, 520], superHigh180: [550, 650], superHigh270: [600, 700], superHigh360min: 650 },
  G: { lowRise: [370, 400], midRise: [400, 450], highRise: [440, 480], superHigh: [480, 550], superHigh180: [550, 650], superHigh270: [600, 700], superHigh360min: 650 },
};

const CLASS_NAMES: Record<ZoneClass, { name: string; description: string }> = {
  A: { name: "Most Luxurious", description: "Prime, high-demand areas — central business districts, upscale neighbourhoods, scenic views (beachfront, canal, city skyline)." },
  B: { name: "Premium", description: "Less exclusive than A but very well connected to major commercial hubs." },
  C: { name: "Upper mid-tier", description: "Moderate appeal, further away from commercial centres or near metro lines. Mostly newer infrastructure." },
  D: { name: "Mid-tier", description: "Moderate appeal, older infrastructure, further from the city core." },
  E: { name: "Lower mid-tier", description: "Less desirable locations, industrial nearby, away from central commercial hubs." },
  F: { name: "Affordable", description: "Industrial, declining property values, far from commercial cores." },
  G: { name: "Economical", description: "International / industrial / waterfront fringe — most affordable tier." },
};

const ALL_LOCATIONS: Record<ZoneClass, string[]> = {
  A: LOCATIONS_A, B: LOCATIONS_B, C: LOCATIONS_C, D: LOCATIONS_D, E: LOCATIONS_E, F: LOCATIONS_F, G: LOCATIONS_G,
};

export const ALL_CLASS_LETTERS: ZoneClass[] = ["A", "B", "C", "D", "E", "F", "G"];

export function buildDefaultClass(letter: ZoneClass): ZoneClassRow {
  return {
    letter,
    name: CLASS_NAMES[letter].name,
    description: CLASS_NAMES[letter].description,
    locations: ALL_LOCATIONS[letter],
    typologyMix: TYPOLOGY_MIX_BY_CLASS[letter],
    avgAreaSqft: AVG_AREA_BY_CLASS[letter],
    salePriceAedPerSqft: SALE_PRICE_BY_CLASS[letter],
    balconyPctOfNsa: BALCONY_PCT[letter],
    parkingAreaPerCarSqft: PARKING_SQFT[letter],
    designPriceAedPerSqftGfa: DESIGN_AED[letter],
    floorHeights: FLOOR_HEIGHTS[letter],
    constructionAedPerSqftBua: CONSTRUCTION_PRICE[letter],
  };
}

export const DEFAULT_ZONE_CLASSES: Record<ZoneClass, ZoneClassRow> = {
  A: buildDefaultClass("A"),
  B: buildDefaultClass("B"),
  C: buildDefaultClass("C"),
  D: buildDefaultClass("D"),
  E: buildDefaultClass("E"),
  F: buildDefaultClass("F"),
  G: buildDefaultClass("G"),
};

/** Find the class that contains the given zone name (case-insensitive, prefix match). */
export function classForZone(
  zoneName: string | undefined | null,
  library: Record<ZoneClass, ZoneClassRow> = DEFAULT_ZONE_CLASSES,
): ZoneClass | null {
  if (!zoneName) return null;
  const target = zoneName.trim().toLowerCase();
  if (!target) return null;
  for (const letter of ALL_CLASS_LETTERS) {
    const locs = library[letter].locations;
    for (const loc of locs) {
      const a = loc.toLowerCase();
      // exact or one-side-prefix match (zone may be "Dubai Marina" or "Dubai Marina (water view)")
      if (a === target || a.startsWith(target) || target.startsWith(a)) {
        return letter;
      }
    }
  }
  return null;
}

/** Combined list of every zone known to the library, deduplicated. */
export function allZoneNames(library: Record<ZoneClass, ZoneClassRow> = DEFAULT_ZONE_CLASSES): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const letter of ALL_CLASS_LETTERS) {
    for (const loc of library[letter].locations) {
      if (!seen.has(loc)) { seen.add(loc); out.push(loc); }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
